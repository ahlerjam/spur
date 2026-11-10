import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { ObjectId, testDatenbank } from './hilfen/datenbank.mjs'
import { fehlerVon } from './hilfen/fehler.mjs'

let datenbank
let Grenzen
let Speicher
let blobBytes
const anna = new ObjectId()
const ben = new ObjectId()
const GB = 1024 ** 3

beforeAll(async () => {
  datenbank = await testDatenbank()
})
afterAll(async () => await datenbank.schliessen())

beforeEach(async () => {
  await datenbank.leeren()
  blobBytes = 0
  vi.resetModules()
  vi.doMock('../../../../app/src/infrastructure/mongodb.mjs', () => datenbank.mongodbModul)
  vi.doMock('../../../../app/src/Features/History/HistoryManager.mjs', () => ({
    default: { promises: { getBlobStats: async () => ({ totalBytes: blobBytes }) } },
  }))
  Grenzen = await import('../../app/src/grenzen/Grenzen.mjs')
  Speicher = await import('../../app/src/Speicher.mjs')
})

async function projekte(owner, anzahl, felder = {}) {
  for (let i = 0; i < anzahl; i++) {
    await datenbank.db.collection('projects').insertOne({
      owner_ref: owner,
      name: `P${i}`,
      overleaf: { history: { id: `h${i}` } },
      rootFolder: [{ docs: [], fileRefs: [{ _id: new ObjectId(), name: 'a.png', hash: 'a'.repeat(40) }], folders: [] }],
      ...felder,
    })
  }
}

describe('Werte', () => {
  it('liest Zahlen mit Komma, leer heißt unbegrenzt bzw. Standard', () => {
    expect(Grenzen.wertLesen('3', 'projekte')).toBe(3)
    expect(Grenzen.wertLesen('0,01', 'speicherGb')).toBe(0.01)
    expect(Grenzen.wertLesen('', 'projekte')).toBe(null)
    expect(Grenzen.wertLesen(null, 'projekte')).toBe(null)
  })

  it('lehnt Negatives, Text und Brüche bei Projekten ab', async () => {
    for (const [wert, feld] of [['-1', 'projekte'], ['abc', 'speicherGb'], ['1,5', 'projekte'], ['-0,5', 'speicherGb']]) {
      expect(() => Grenzen.wertLesen(wert, feld), `${feld}=${wert}`).toThrow()
    }
  })

  it('formatiert GB in der Sprache der Installation', () => {
    expect(Grenzen.gbText(0.01 * GB)).toMatch(/^0[,.]01$/)
    expect(Grenzen.gbText(1.02 * GB)).toMatch(/^1[,.]02$/)
  })
})

describe('Standard und Ausnahmen', () => {
  it('ist ohne Einstellung unbegrenzt', async () => {
    expect(await Grenzen.standard()).toEqual({ projekte: null, speicherGb: null, texPaketeAus: false })
    expect(await Grenzen.projektGrenze(anna)).toBe(null)
  })

  it('Ausnahme: fehlt = Standard, null = unbegrenzt, Zahl (auch 0) = Zahl', async () => {
    await Grenzen.standardSetzen({ projekte: 3, speicherGb: 0.01, texPaketeAus: false })
    expect(await Grenzen.projektGrenze(anna)).toBe(3)
    await Grenzen.ausnahmeSetzen(anna, { projekte: 5, speicherGb: undefined })
    expect(await Grenzen.projektGrenze(anna)).toBe(5)
    expect(await Grenzen.speicherGrenzeBytes(anna)).toBe(Math.round(0.01 * GB))
    await Grenzen.ausnahmeSetzen(anna, { projekte: null, speicherGb: 0 })
    expect(await Grenzen.projektGrenze(anna)).toBe(null)
    expect(await Grenzen.speicherGrenzeBytes(anna)).toBe(0)
    await Grenzen.ausnahmeSetzen(anna, { projekte: undefined, speicherGb: undefined })
    expect(await Grenzen.ausnahme(anna)).toEqual({})
  })
})

describe('Projekt-Grenze', () => {
  it('zählt alle eigenen Projekte, auch archivierte und im Papierkorb, keine fremden', async () => {
    await Grenzen.standardSetzen({ projekte: 3, speicherGb: null })
    await projekte(anna, 2)
    await projekte(anna, 1, { archived: [anna], trashed: [anna] })
    await projekte(ben, 4, { collaberator_refs: [anna] })
    expect(await Grenzen.projektStand(anna)).toEqual({ anzahl: 3, grenze: 3 })
    const fehler = await fehlerVon(Grenzen.projektAnlegenPruefen(anna))
    expect(fehler).toMatchObject({ status: 403, typ: 'projekte_voll', spurGrenze: 'projekte_voll' })
    expect(fehler.message).toMatch(/3 von 3|3 of 3/)
  })

  it('lässt unter der Grenze und ohne Grenze anlegen', async () => {
    await projekte(anna, 2)
    await Grenzen.projektAnlegenPruefen(anna)
    await Grenzen.standardSetzen({ projekte: 3, speicherGb: null })
    await Grenzen.projektAnlegenPruefen(anna)
  })
})

describe('Speicher', () => {
  let projektId
  beforeEach(async () => {
    await projekte(anna, 1)
    projektId = (await datenbank.db.collection('projects').findOne({ owner_ref: anna }))._id
  })

  it('zählt Dateien und Quellen des Projekts', async () => {
    blobBytes = 1000
    await datenbank.db.collection('spurSources').insertOne({ projectId: projektId, key: 'a', groesse: 234 })
    expect(await Speicher.stand(projektId)).toBe(1234)
  })

  it('reserviert ohne Grenze immer', async () => {
    const freigeben = await Speicher.reservieren(projektId, 10 * GB)
    await freigeben()
  })

  it('lehnt einen Upload über der Grenze mit Stand und Grenze ab', async () => {
    await Grenzen.standardSetzen({ projekte: null, speicherGb: 0.01 })
    blobBytes = 6 * 1024 * 1024
    const fehler = await fehlerVon(Speicher.reservieren(projektId, 6 * 1024 * 1024))
    expect(fehler).toMatchObject({ status: 403, typ: 'speicher_voll' })
    expect(fehler.message).toMatch(/0[,.]01 GB/)
  })

  it('nimmt von zwei gleichzeitigen Uploads, die zusammen zu groß sind, nur einen an', async () => {
    await Grenzen.standardSetzen({ projekte: null, speicherGb: 0.01 })
    const MB6 = 6 * 1024 * 1024
    const ergebnisse = await Promise.allSettled([Speicher.reservieren(projektId, MB6), Speicher.reservieren(projektId, MB6)])
    expect(ergebnisse.filter(e => e.status === 'fulfilled')).toHaveLength(1)
    await ergebnisse.find(e => e.status === 'fulfilled').value()
    const danach = await Speicher.reservieren(projektId, MB6)
    await danach()
  })

  it('gilt die Ausnahme des Eigentümers für seine Projekte', async () => {
    await Grenzen.standardSetzen({ projekte: null, speicherGb: 0.01 })
    await Grenzen.ausnahmeSetzen(anna, { projekte: undefined, speicherGb: null })
    const freigeben = await Speicher.reservieren(projektId, GB)
    await freigeben()
  })

  it('meldet „voll“ erst, wenn der Stand die Grenze erreicht', async () => {
    await Grenzen.standardSetzen({ projekte: null, speicherGb: 0.01 })
    blobBytes = 1024
    expect(await Speicher.voll(projektId)).toBe(false)
    blobBytes = 0.02 * GB
    expect(await Speicher.voll(projektId)).toBe(true)
  })
})
