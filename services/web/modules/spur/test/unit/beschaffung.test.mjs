import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { ObjectId, schalterAttrappe, testDatenbank } from './hilfen/datenbank.mjs'
import { fehlerVon } from './hilfen/fehler.mjs'
import { meldung } from '../../app/src/meldungen.mjs'

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
      perDoi: vi.fn(),
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
    Suchprotokoll: { aufnahmeFehlerMerken: vi.fn(async () => {}) },
  }
  vi.resetModules()
  vi.doMock('../../../../app/src/infrastructure/mongodb.mjs', () => datenbank.mongodbModul)
  vi.doMock('../../app/src/schalter.mjs', () => schalterAttrappe().modul)
  vi.doMock('../../app/src/recherche/Aufnahme.mjs', () => m.Aufnahme)
  vi.doMock('../../app/src/QuellenManager.mjs', () => m.QuellenManager)
  vi.doMock('../../app/src/ZitatManager.mjs', () => m.ZitatManager)
  vi.doMock('../../app/src/pruefung/PruefManager.mjs', () => m.PruefManager)
  vi.doMock('../../app/src/recherche/Suchprotokoll.mjs', () => m.Suchprotokoll)
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
    expect(await fehlerVon(hinzufuegen('10.9999/nix'))).toMatchObject({ status: 404, message: meldung('spur_fehler_doi_nicht_gefunden') })
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

  it('überschreibt keine Quelle, die schon eine andere DOI trägt, und lässt den Eintrag offen', async () => {
    const eintrag = await hinzufuegen('10.5555/spur.2024.001')
    const quelle = await quelleAnlegen({ doi: '10.1038/nrn2762' })
    const fehler = await fehlerVon(Beschaffung.zuordnen(projectId, String(eintrag._id), String(quelle._id), userId))
    expect(fehler).toMatchObject({ status: 409, typ: 'andere_doi' })
    expect((await Beschaffung.liste(projectId)).offen).toBe(1)
  })

  it('lässt den Eintrag offen, wenn die .bib nicht ergänzt werden kann', async () => {
    const eintrag = await hinzufuegen('10.5555/spur.2024.001')
    m.ZitatManager.bibSicherstellen.mockRejectedValueOnce(new Error('Editor weg'))
    await fehlerVon(Beschaffung.zuordnen(projectId, String(eintrag._id), String((await quelleAnlegen())._id), userId))
    expect((await Beschaffung.liste(projectId)).offen).toBe(1)
  })

  it('kennt nur Einträge des eigenen Projekts', async () => {
    const eintrag = await hinzufuegen('10.5555/spur.2024.001')
    const fremd = await fehlerVon(Beschaffung.zuordnen(new ObjectId(), String(eintrag._id), String(new ObjectId()), userId))
    expect(fremd).toMatchObject({ status: 404, typ: 'beschaffung_fehlt' })
  })
})

describe('aufnehmenOderVormerken', () => {
  const DOI = '10.5555/spur.bot.001'
  const VERSUCHT = [{ url: 'https://verlag.example/a.pdf', host: 'verlag.example', art: 'publisher', ergebnis: '403' }]
  const aufnehmen = () => Beschaffung.aufnehmenOderVormerken({ projectId, userId, doi: DOI })
  const scheitert = (status, typ, zusatz) => m.Aufnahme.perDoi.mockRejectedValue(Object.assign(new Error(typ), { status, typ, zusatz }))
  const eintraege = async () => (await Beschaffung.liste(projectId)).eintraege

  it('gibt die Quelle zurück, wenn die Aufnahme gelingt, und legt nichts auf die Liste', async () => {
    m.Aufnahme.perDoi.mockResolvedValue({ _id: 'q1', key: 'stein2023' })
    expect(await aufnehmen()).toEqual({ _id: 'q1', key: 'stein2023' })
    expect(m.Aufnahme.perDoi).toHaveBeenCalledWith({ projectId, userId, doi: DOI })
    expect(await eintraege()).toEqual([])
  })

  it('setzt bei bot_schutz die DOI mit Grund und bester Adresse auf die Liste und meldet den Fehler weiter', async () => {
    scheitert(502, 'bot_schutz', { versucht: VERSUCHT, adresse: 'https://verlag.example/artikel' })
    const fehler = await fehlerVon(aufnehmen())
    expect(fehler).toMatchObject({
      status: 502,
      typ: 'bot_schutz',
      message: meldung('spur_fehler_bot_schutz_vorgemerkt'),
      zusatz: { versucht: VERSUCHT, adresse: 'https://verlag.example/artikel' },
    })
    expect(await eintraege()).toMatchObject([{ doi: DOI, status: 'offen', grund: 'bot_schutz', adresse: 'https://verlag.example/artikel', meta: META, angelegtVon: userId }])
  })

  it('setzt bei nicht_frei die DOI mit Grund auf die Liste', async () => {
    scheitert(409, 'nicht_frei')
    expect(await fehlerVon(aufnehmen())).toMatchObject({ status: 409, typ: 'nicht_frei', message: meldung('spur_fehler_nicht_frei_vorgemerkt') })
    expect(await eintraege()).toMatchObject([{ doi: DOI, grund: 'nicht_frei', adresse: null }])
  })

  it('legt beim zweiten Versuch keinen zweiten Eintrag an', async () => {
    scheitert(502, 'bot_schutz', { versucht: VERSUCHT, adresse: 'https://verlag.example/artikel' })
    await fehlerVon(aufnehmen())
    await fehlerVon(aufnehmen())
    expect(await eintraege()).toHaveLength(1)
  })

  it('ergänzt den Grund an einem Eintrag, der schon von Hand auf der Liste steht', async () => {
    await hinzufuegen(DOI)
    scheitert(409, 'nicht_frei')
    await fehlerVon(aufnehmen())
    expect(await eintraege()).toMatchObject([{ doi: DOI, grund: 'nicht_frei' }])
  })

  it('lässt die Liste bei pdf_fehlt und anderen Fehlern in Ruhe', async () => {
    scheitert(502, 'pdf_fehlt', { versucht: VERSUCHT })
    expect(await fehlerVon(aufnehmen())).toMatchObject({ typ: 'pdf_fehlt', zusatz: { versucht: VERSUCHT } })
    expect(await eintraege()).toEqual([])
  })

  it('vermerkt pdf_fehlt im Suchprotokoll und meldet den Fehler samt versucht, auch wenn das Vermerken scheitert', async () => {
    scheitert(502, 'pdf_fehlt', { versucht: VERSUCHT })
    await fehlerVon(aufnehmen())
    expect(m.Suchprotokoll.aufnahmeFehlerMerken).toHaveBeenCalledWith(projectId, DOI, 'pdf_fehlt')
    m.Suchprotokoll.aufnahmeFehlerMerken.mockRejectedValue(new Error('Mongo weg'))
    expect(await fehlerVon(aufnehmen())).toMatchObject({ status: 502, typ: 'pdf_fehlt', zusatz: { versucht: VERSUCHT } })
  })

  it('meldet den ursprünglichen Fehler, wenn der Eintrag nicht angelegt werden kann', async () => {
    scheitert(409, 'nicht_frei')
    m.Aufnahme.metadaten.mockRejectedValue(new Error('Crossref weg'))
    expect(await fehlerVon(aufnehmen())).toMatchObject({ typ: 'nicht_frei', message: 'nicht_frei' })
    expect(await eintraege()).toEqual([])
  })
})

