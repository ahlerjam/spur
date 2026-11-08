import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { ObjectId, schalterAttrappe, testDatenbank } from './hilfen/datenbank.mjs'
import { fehlerVon } from './hilfen/fehler.mjs'

let Beschaffung
let datenbank
let m

const projectId = new ObjectId()
const userId = new ObjectId()
const META = {
  gefunden: true,
  titel: 'Sleep and Memory',
  autoren: [{ family: 'Smith', given: 'Alice' }],
  jahr: 2024,
  journal: 'Journal of Sleep Research',
  seiten: '345-352',
}

beforeAll(async () => {
  datenbank = await testDatenbank()
})
afterAll(async () => await datenbank.schliessen())

beforeEach(async () => {
  await datenbank.leeren()
  const quellen = () => datenbank.db.collection('spurSources')
  m = {
    Aufnahme: {
      doiNormal: doi => doi.trim().toLowerCase(),
      metadaten: vi.fn(async doi => ({ meta: doi.startsWith('10.9999') ? { gefunden: false } : META })),
    },
    QuellenManager: {
      alle: vi.fn(async pid => await quellen().find({ projectId: pid }).toArray()),
      holen: vi.fn(async (pid, id) => {
        const q = await quellen().findOne({ _id: new ObjectId(id), projectId: pid })
        if (!q) throw Object.assign(new Error('Diese Quelle gibt es nicht mehr.'), { status: 404 })
        return q
      }),
    },
    ZitatManager: { bibSicherstellen: vi.fn(async () => 'smith2024') },
    PruefManager: { dokumente: vi.fn(async () => []) },
  }
  vi.resetModules()
  vi.doMock('../../../../app/src/infrastructure/mongodb.mjs', () => datenbank.mongodbModul)
  vi.doMock('../../app/src/schalter.mjs', () => schalterAttrappe().modul)
  vi.doMock('../../app/src/recherche/Aufnahme.mjs', () => m.Aufnahme)
  vi.doMock('../../app/src/QuellenManager.mjs', () => m.QuellenManager)
  vi.doMock('../../app/src/ZitatManager.mjs', () => m.ZitatManager)
  vi.doMock('../../app/src/pruefung/PruefManager.mjs', () => m.PruefManager)
  Beschaffung = await import('../../app/src/recherche/Beschaffung.mjs')
})

const hinzufuegen = doi => Beschaffung.hinzufuegen({ projectId, userId, doi })
const quelleAnlegen = async (felder = {}) => {
  const quelle = { _id: new ObjectId(), projectId, key: 'smith2024', dateiname: 'smith2024.pdf', doi: null, meta: null, ...felder }
  await datenbank.db.collection('spurSources').insertOne(quelle)
  return quelle
}

describe('Beschaffungsliste', () => {
  it('setzt eine DOI mit Metadaten als „offen“ auf die Liste', async () => {
    const eintrag = await hinzufuegen('10.5555/SPUR.2024.001')
    expect(eintrag).toMatchObject({ doi: '10.5555/spur.2024.001', status: 'offen', meta: META })
    const { eintraege, offen, beschafft } = await Beschaffung.liste(projectId)
    expect(eintraege.map(e => e.doi)).toEqual(['10.5555/spur.2024.001'])
    expect([offen, beschafft]).toEqual([1, 0])
  })

  it('meldet eine DOI, die schon auf der Liste oder als Quelle da ist', async () => {
    await hinzufuegen('10.5555/spur.2024.001')
    expect(await fehlerVon(hinzufuegen('10.5555/spur.2024.001'))).toMatchObject({ status: 409, typ: 'beschaffung_vorhanden' })
    await quelleAnlegen({ doi: '10.1038/nrn2762' })
    expect(await fehlerVon(hinzufuegen('10.1038/nrn2762'))).toMatchObject({ status: 409, typ: 'quelle_vorhanden' })
  })

  it('meldet eine unbekannte DOI', async () => {
    expect(await fehlerVon(hinzufuegen('10.9999/nix'))).toMatchObject({ status: 404, message: 'DOI nicht gefunden' })
  })

  it('baut den Bibliothekslink aus der Vorlage der Person, Standard doi.org', async () => {
    expect(await Beschaffung.vorlage(userId)).toBe('https://doi.org/{doi}')
    await Beschaffung.vorlageSetzen(userId, 'https://bibliothek.example/?doi={doi}')
    expect(Beschaffung.link(await Beschaffung.vorlage(userId), '10.5555/spur 1')).toBe(
      'https://bibliothek.example/?doi=10.5555/spur%201'
    )
  })

  it('lehnt Vorlagen ohne {doi} oder ohne http(s) ab', async () => {
    expect(await fehlerVon(Beschaffung.vorlageSetzen(userId, 'https://bibliothek.example/'))).toMatchObject({ status: 400 })
    expect(await fehlerVon(Beschaffung.vorlageSetzen(userId, 'javascript:alert({doi})'))).toMatchObject({ status: 400 })
  })

  it('exportiert .bib, .ris und CSV mit denselben DOIs', async () => {
    await hinzufuegen('10.5555/spur.2024.001')
    await hinzufuegen('10.1038/nrn2762')
    const bib = await Beschaffung.exportieren(projectId, 'bib')
    const ris = await Beschaffung.exportieren(projectId, 'ris')
    const csv = await Beschaffung.exportieren(projectId, 'csv')
    const dois = text => [...text.matchAll(/10\.\d{4}\/[^\s},"]+/g)].map(t => t[0]).sort()
    expect(dois(bib.inhalt)).toEqual(['10.1038/nrn2762', '10.5555/spur.2024.001'])
    expect(dois(ris.inhalt)).toEqual(dois(bib.inhalt))
    expect(dois(csv.inhalt)).toEqual(dois(bib.inhalt))
    expect(bib.inhalt).toContain('@article{smith2024,')
    expect(ris.inhalt).toContain('TY  - JOUR\nTI  - Sleep and Memory\nAU  - Smith, Alice\nPY  - 2024')
    expect(csv.inhalt.split('\n')[0]).toBe('DOI,Titel,Autoren,Jahr,Status')
    expect([bib.dateiname, ris.dateiname, csv.dateiname]).toEqual([
      'beschaffungsliste.bib',
      'beschaffungsliste.ris',
      'beschaffungsliste.csv',
    ])
  })

  it('ordnet ein hochgeladenes PDF per DOI zu und meldet „beschafft“', async () => {
    const eintrag = await hinzufuegen('10.5555/spur.2024.001')
    const quelle = await quelleAnlegen({ doi: '10.5555/SPUR.2024.001' })
    const zugeordnet = await Beschaffung.perDoiZuordnen(projectId, quelle, userId)
    expect(zugeordnet).toMatchObject({ _id: eintrag._id, status: 'beschafft', quelleId: quelle._id })
    expect(m.ZitatManager.bibSicherstellen).toHaveBeenCalled()
    const { offen, beschafft } = await Beschaffung.liste(projectId)
    expect([offen, beschafft]).toEqual([0, 1])
  })

  it('lässt ein PDF ohne passende DOI offen', async () => {
    await hinzufuegen('10.5555/spur.2024.001')
    expect(await Beschaffung.perDoiZuordnen(projectId, await quelleAnlegen(), userId)).toBeNull()
  })

  it('ordnet per Hand zu und übernimmt DOI und Metadaten in die Quelle', async () => {
    const eintrag = await hinzufuegen('10.5555/spur.2024.001')
    const quelle = await quelleAnlegen()
    await Beschaffung.zuordnen(projectId, String(eintrag._id), String(quelle._id), userId)
    const neu = await datenbank.db.collection('spurSources').findOne({ _id: quelle._id })
    expect(neu).toMatchObject({ doi: '10.5555/spur.2024.001', meta: META })
    const fehler = await fehlerVon(Beschaffung.zuordnen(projectId, String(eintrag._id), String(quelle._id), userId))
    expect(fehler).toMatchObject({ status: 409, typ: 'schon_beschafft' })
  })

  it('kennt nur Einträge des eigenen Projekts', async () => {
    const eintrag = await hinzufuegen('10.5555/spur.2024.001')
    const fremd = await fehlerVon(Beschaffung.zuordnen(new ObjectId(), String(eintrag._id), String(new ObjectId()), userId))
    expect(fremd).toMatchObject({ status: 404, typ: 'beschaffung_fehlt' })
  })
})
