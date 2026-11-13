import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { ObjectId, schalterAttrappe, testDatenbank } from './hilfen/datenbank.mjs'
import { fehlerVon } from './hilfen/fehler.mjs'

let datenbank
let LaufManager
let schalter
let flushProject
let fetchJson
const bot = new ObjectId()
const projekt = new ObjectId()

beforeAll(async () => {
  datenbank = await testDatenbank()
})
afterAll(async () => await datenbank.schliessen())

beforeEach(async () => {
  await datenbank.leeren()
  schalter = schalterAttrappe()
  flushProject = vi.fn(async () => {})
  fetchJson = vi.fn(async url => (url.endsWith('/version') ? { version: 42 } : {}))
  vi.resetModules()
  vi.doMock('../../../../app/src/infrastructure/mongodb.mjs', () => datenbank.mongodbModul)
  vi.doMock('../../app/src/schalter.mjs', () => schalter.modul)
  vi.doMock('@overleaf/fetch-utils', () => ({ fetchJson }))
  vi.doMock('@overleaf/settings', () => ({ default: { apis: { project_history: { url: 'http://history' } } } }))
  vi.doMock('../../../../app/src/Features/History/HistoryManager.mjs', () => ({
    default: { promises: { flushProject } },
  }))
  LaufManager = await import('../../app/src/schreiben/LaufManager.mjs')
})

describe('laufFuerSchreiben', () => {
  it('legt beim ersten Schreiben einen offenen Lauf an und setzt vorher ein History-Label', async () => {
    const lauf = await LaufManager.laufFuerSchreiben(projekt, bot)
    expect(lauf).toMatchObject({ projectId: projekt, botId: bot, status: 'offen', docs: [], aenderungen: 0, rot: [] })
    expect(flushProject).toHaveBeenCalledWith(projekt)
    expect(fetchJson).toHaveBeenCalledWith(`http://history/project/${projekt}/labels`, {
      method: 'POST',
      json: { comment: 'Claude: Lauf', version: 42, user_id: String(bot) },
    })
    expect(await datenbank.db.collection('spurRuns').countDocuments()).toBe(1)
  })

  it('nimmt den offenen Lauf wieder auf, ohne ein zweites Label zu setzen', async () => {
    const erster = await LaufManager.laufFuerSchreiben(projekt, bot)
    fetchJson.mockClear()
    const zweiter = await LaufManager.laufFuerSchreiben(projekt, bot)
    expect(zweiter._id).toEqual(erster._id)
    expect(fetchJson).not.toHaveBeenCalled()
  })

  it('legt bei gleichzeitigen Aufrufen nur einen Lauf an', async () => {
    const [a, b] = await Promise.all([
      LaufManager.laufFuerSchreiben(projekt, bot),
      LaufManager.laufFuerSchreiben(projekt, bot),
    ])
    expect(a._id).toEqual(b._id)
    expect(await datenbank.db.collection('spurRuns').countDocuments()).toBe(1)
  })

  it('beginnt nach einem beendeten Lauf einen neuen', async () => {
    const erster = await LaufManager.laufFuerSchreiben(projekt, bot)
    await LaufManager.beenden(erster, 'fertig')
    const zweiter = await LaufManager.laufFuerSchreiben(projekt, bot)
    expect(zweiter._id).not.toEqual(erster._id)
  })

  it('legt keinen Lauf an, wenn das Label scheitert', async () => {
    fetchJson.mockRejectedValueOnce(new Error('History weg'))
    expect((await fehlerVon(LaufManager.laufFuerSchreiben(projekt, bot))).message).toBe('History weg')
    expect(await datenbank.db.collection('spurRuns').countDocuments()).toBe(0)
  })
})

describe('Lauf weiterführen', () => {
  it('aenderungMerken zählt Änderungen, sammelt Dokumente einmal und Rotmarken', async () => {
    const lauf = await LaufManager.laufFuerSchreiben(projekt, bot)
    const doc = new ObjectId()
    await LaufManager.aenderungMerken(lauf, { docId: doc, rot: [] })
    await LaufManager.aenderungMerken(lauf, { docId: doc, rot: [{ grund: 'nicht_pruefbar', auszug: 'X' }] })
    const gespeichert = await LaufManager.offenerLauf(projekt, bot)
    expect(gespeichert).toMatchObject({ aenderungen: 2, docs: [doc], rot: [{ grund: 'nicht_pruefbar', auszug: 'X' }] })
  })

  it('aenderungMerken sammelt Zahlen ohne Beleg für die Lauf-Karte', async () => {
    const lauf = await LaufManager.laufFuerSchreiben(projekt, bot)
    await LaufManager.aenderungMerken(lauf, { docId: new ObjectId(), rot: [], zahlen: [{ zahl: '412', pfad: 'main.tex' }] })
    const gespeichert = await LaufManager.offenerLauf(projekt, bot)
    expect(LaufManager.laufFuerClient(gespeichert).zahlen).toEqual([{ zahl: '412', pfad: 'main.tex' }])
  })

  it('beenden schließt den Lauf mit Zusammenfassung und Zeit; offenerLauf findet ihn dann nicht mehr', async () => {
    const lauf = await LaufManager.laufFuerSchreiben(projekt, bot)
    schalter.zeit = new Date('2026-11-07T11:00:00Z')
    await LaufManager.beenden(lauf, 'Zwei Absätze geglättet.')
    expect(await LaufManager.offenerLauf(projekt, bot)).toBeNull()
    expect(await LaufManager.letzterLauf(projekt, bot)).toMatchObject({
      status: 'fertig',
      zusammenfassung: 'Zwei Absätze geglättet.',
      beendet: new Date('2026-11-07T11:00:00Z'),
    })
  })

  it('letzterLauf liefert den neuesten Lauf des Projekts und Bots, sonst nichts', async () => {
    expect(await LaufManager.letzterLauf(projekt, bot)).toBeNull()
    const erster = await LaufManager.laufFuerSchreiben(projekt, bot)
    await LaufManager.beenden(erster, 'a')
    const zweiter = await LaufManager.laufFuerSchreiben(projekt, bot)
    expect((await LaufManager.letzterLauf(projekt, bot))._id).toEqual(zweiter._id)
    expect(await LaufManager.letzterLauf(new ObjectId(), bot)).toBeNull()
  })
})

describe('laufFuerClient', () => {
  it('gibt null für keinen Lauf zurück', () => {
    expect(LaufManager.laufFuerClient(null)).toBeNull()
  })

  it('zeigt Zustand, Dateizahl und Zusammenfassung ohne interne Felder', async () => {
    const lauf = await LaufManager.laufFuerSchreiben(projekt, bot)
    await LaufManager.aenderungMerken(lauf, { docId: new ObjectId(), rot: [] })
    const gespeichert = await LaufManager.letzterLauf(projekt, bot)
    expect(LaufManager.laufFuerClient(gespeichert)).toEqual({
      id: lauf._id,
      status: 'offen',
      gestartet: schalter.zeit,
      beendet: null,
      dateien: 1,
      aenderungen: 1,
      rot: [],
      zahlen: [],
      zusammenfassung: null,
      angelegt: [],
      rotAenderungen: [],
      automatisch: [],
    })
  })

  it('listet angelegte Dateien, Ordner und Quellen ohne interne Felder', async () => {
    const lauf = await LaufManager.laufFuerSchreiben(projekt, bot)
    await LaufManager.angelegtMerken(lauf, [{ art: 'ordner', pfad: 'tex-pakete/foo', paket: 'foo', bytes: 12 }])
    await LaufManager.angelegtMerken(lauf, [{ art: 'quelle', name: 'smith2024.pdf', quelleId: new ObjectId() }])
    const { angelegt } = LaufManager.laufFuerClient(await LaufManager.letzterLauf(projekt, bot))
    expect(angelegt).toEqual([
      { art: 'ordner', pfad: 'tex-pakete/foo', name: undefined },
      { art: 'quelle', pfad: undefined, name: 'smith2024.pdf' },
    ])
  })
})

describe('laeufeListe', () => {
  it('liefert die letzten 20 Läufe des Bots, neueste zuerst, und lädt ältere in Schritten von 20', async () => {
    const sammlung = datenbank.db.collection('spurRuns')
    const ids = []
    for (let i = 0; i < 45; i++) ids.push((await sammlung.insertOne({ projectId: projekt, botId: bot, status: 'fertig', nr: i })).insertedId)
    await sammlung.insertOne({ projectId: projekt, botId: new ObjectId(), status: 'fertig', nr: 99 })
    const erste = await LaufManager.laeufeListe(projekt, bot, {})
    expect(erste.laeufe.map(l => l.nr)).toEqual(Array.from({ length: 20 }, (_, i) => 44 - i))
    expect(erste.weitere).toBe(true)
    const zweite = await LaufManager.laeufeListe(projekt, bot, { vor: String(erste.laeufe.at(-1)._id) })
    expect(zweite.laeufe[0].nr).toBe(24)
    const dritte = await LaufManager.laeufeListe(projekt, bot, { vor: String(zweite.laeufe.at(-1)._id) })
    expect(dritte.laeufe.map(l => l.nr)).toEqual([4, 3, 2, 1, 0])
    expect(dritte.weitere).toBe(false)
    expect((await LaufManager.laeufeListe(projekt, bot, { vor: 'kaputt' })).laeufe).toHaveLength(20)
  })

  it('laufFuerClient nennt automatisch Angenommenes und rote Changes', () => {
    const lauf = { _id: 'l', status: 'offen', docs: [], aenderungen: 2, rot: [], rotAenderungen: ['r'],
      angenommen: [{ automatisch: true, pfad: 'main.tex', zeile: 3, op: { p: 1, i: 'Von 240 Befragten' } }, { op: { p: 1, d: 'x' } }] }
    expect(LaufManager.laufFuerClient(lauf)).toMatchObject({
      rotAenderungen: ['r'],
      automatisch: [{ pfad: 'main.tex', zeile: 3, art: 'einfuegung', text: 'Von 240 Befragten' }],
    })
  })
})

