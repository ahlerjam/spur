import { copyFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { ObjectId } from './hilfen/datenbank.mjs'
import { Antwort, anfrage } from './hilfen/express.mjs'
import { fixture } from './hilfen/quellen.mjs'
import { meldung } from '../../app/src/meldungen.mjs'

let C
let m
// Nach vi.resetModules() aus derselben Modulinstanz wie der Controller, sonst greift instanceof nicht.
let Problem
const projectId = new ObjectId()
const menschId = new ObjectId()
const ordner = mkdtempSync(join(tmpdir(), 'spur-upload-'))
afterAll(() => rmSync(ordner, { recursive: true, force: true }))

const REPORT = {
  titel: 'AI at Work',
  autoren: 'Meyer, Jana; Okafor, Chidi',
  jahr: '2023',
  art: 'report',
  institution: 'OECD',
}

beforeEach(async () => {
  m = {
    UploadLink: { verbrauchen: vi.fn(async () => ({ projectId, menschId, botId: new ObjectId() })) },
    rechte: { rolleFuerClaude: vi.fn(async () => 'owner') },
    QuellenManager: {
      alle: vi.fn(async () => []),
      aufnehmen: vi.fn(async eingabe => ({ _id: new ObjectId(), ...eingabe, key: eingabe.key ?? 'aus-dateiname' })),
    },
    sammlungen: { quellen: async () => ({ findOne: vi.fn(async () => m.vorhanden) }) },
    Aufnahme: {
      metadaten: vi.fn(async () => ({ meta: { gefunden: true, titel: 'Publisher walls around open articles' } })),
      neuerKey: vi.fn(async () => ({ key: 'meyer2023', docs: [] })),
      mitBibEintrag: vi.fn(async (_pid, _docs, quelle) => quelle),
    },
    Beschaffung: { perDoiZuordnen: vi.fn(async () => null) },
    pdf: { titelFeld: vi.fn(async () => null) },
    LaufManager: { laufFuerSchreiben: vi.fn(async () => ({})), angelegtMerken: vi.fn(async () => {}) },
    vorhanden: null,
  }
  vi.resetModules()
  vi.doMock('../../app/src/hochladen/UploadLink.mjs', () => m.UploadLink)
  vi.doMock('../../app/src/rechte.mjs', () => m.rechte)
  vi.doMock('../../app/src/QuellenManager.mjs', () => m.QuellenManager)
  vi.doMock('../../app/src/sammlungen.mjs', () => m.sammlungen)
  vi.doMock('../../app/src/recherche/Aufnahme.mjs', () => m.Aufnahme)
  vi.doMock('../../app/src/recherche/Beschaffung.mjs', () => m.Beschaffung)
  vi.doMock('../../app/src/schreiben/LaufManager.mjs', () => m.LaufManager)
  vi.doMock('../../app/src/pdf.mjs', () => m.pdf)
  vi.doMock('../../app/src/schalter.mjs', () => ({ jetzt: () => new Date('2026-11-16T10:00:00Z') }))
  C = await import('../../app/src/hochladen/UploadLinkController.mjs')
  ;({ Problem } = await import('../../app/src/probleme.mjs'))
})

// Lädt eine Kopie des Fixtures hoch; der Controller löscht die Datei danach wie die von multer.
async function hochladen(body, datei = 'report.pdf') {
  const pfad = join(ordner, `${Math.random().toString(16).slice(2)}.pdf`)
  copyFileSync(fixture(datei), pfad)
  const res = new Antwort()
  const next = vi.fn()
  await C.hochladen(anfrage({ params: { token: 'x' }, body, file: { path: pfad, size: 1234, originalname: datei } }), res, next)
  expect(existsSync(pfad)).toBe(false)
  return { res, next }
}

describe('Upload über den Einmal-Link', () => {
  it('legt eine Quelle ohne DOI mit Autoren, Jahr, Art und Institution an, mit Key und .bib-Eintrag', async () => {
    const { res } = await hochladen(REPORT)
    expect(m.QuellenManager.aufnehmen).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId,
        userId: menschId,
        dateiname: 'report.pdf',
        key: 'meyer2023',
        meta: {
          titel: 'AI at Work',
          autoren: [
            { family: 'Meyer', given: 'Jana' },
            { family: 'Okafor', given: 'Chidi' },
          ],
          jahr: 2023,
          art: 'report',
          institution: 'OECD',
          abschluss: null,
          url: null,
        },
      })
    )
    expect(m.Aufnahme.mitBibEintrag).toHaveBeenCalled()
    expect(res.body).toMatchObject({ datei: 'report.pdf', status: 'angelegt', key: 'meyer2023' })
  })

  it('setzt das Abrufdatum, wenn eine Adresse angegeben ist', async () => {
    await hochladen({ ...REPORT, url: 'https://oecd.example/ai-at-work' })
    expect(m.QuellenManager.aufnehmen.mock.calls[0][0].meta).toMatchObject({ url: 'https://oecd.example/ai-at-work', abgerufenAm: new Date('2026-11-16T10:00:00Z') })
  })

  it('lehnt ungültige Angaben ohne DOI mit dem Feldnamen ab', async () => {
    const { res } = await hochladen({ ...REPORT, art: 'roman' })
    expect(res.body).toEqual({ datei: 'report.pdf', status: 'abgelehnt', grund: meldung('spur_fehler_eingabe_feld', { feld: 'metadaten.art' }) })
    expect(m.QuellenManager.aufnehmen).not.toHaveBeenCalled()
  })

  it('legt mit nur einem Titel einen @misc-Eintrag mit Key aus dem Dateinamen an (P13)', async () => {
    const { res } = await hochladen({ titel: 'Testbericht' })
    expect(m.Aufnahme.neuerKey).toHaveBeenCalledWith(projectId, [], { titel: 'report' })
    expect(m.QuellenManager.aufnehmen.mock.calls[0][0]).toMatchObject({ meta: { titel: 'Testbericht', art: 'misc' }, metadaten: 'unvollstaendig' })
    expect(m.Aufnahme.mitBibEintrag).toHaveBeenCalledTimes(1)
    expect(res.body).toMatchObject({ status: 'angelegt', metadaten: 'unvollstaendig', metadaten_hinweis: meldung('spur_hinweis_metadaten_ohne_doi') })
  })

  it('nimmt ohne alle Angaben den Titel aus den PDF-Metadaten, sonst den Dateinamen', async () => {
    m.pdf.titelFeld.mockResolvedValueOnce('Field notes 2023')
    await hochladen({}, 'notizen.pdf')
    await hochladen({}, 'report.pdf')
    expect(m.QuellenManager.aufnehmen.mock.calls.map(([e]) => e.meta)).toEqual([
      { titel: 'Field notes 2023', art: 'misc' },
      { titel: 'report', art: 'misc' },
    ])
  })

  it('holt mit DOI deren Metadaten für den Titelabgleich und meldet eine Abweichung', async () => {
    m.QuellenManager.aufnehmen.mockImplementation(async eingabe => ({ _id: new ObjectId(), ...eingabe, key: 'stein2023', titelabgleich: 'abweichend' }))
    const { res } = await hochladen({ doi: '10.5555/spur.bot.001' })
    expect(m.Aufnahme.metadaten).toHaveBeenCalledWith('10.5555/spur.bot.001')
    expect(m.QuellenManager.aufnehmen.mock.calls[0][0]).toMatchObject({ doi: '10.5555/spur.bot.001', meta: { titel: 'Publisher walls around open articles' } })
    expect(res.body).toMatchObject({ status: 'angelegt', titelabgleich: 'abweichend', hinweis: meldung('spur_hinweis_titel_abweichend') })
  })

  it('legt mit bekannter DOI den vollständigen Eintrag mit Key aus Nachname und Jahr an', async () => {
    const meta = { gefunden: true, titel: 'Dynamic capabilities', autoren: [{ family: 'Oldemeyer', given: 'Lena' }], jahr: 2025, band: '35' }
    m.Aufnahme.metadaten.mockResolvedValueOnce({ meta })
    m.Aufnahme.neuerKey.mockResolvedValueOnce({ key: 'oldemeyer2025', docs: [{ pfad: 'references.bib' }] })
    const { res } = await hochladen({ doi: '10.5555/spur.heft.001' }, 'mikalef.pdf')
    expect(m.Aufnahme.neuerKey).toHaveBeenCalledWith(projectId, [], meta)
    expect(m.QuellenManager.aufnehmen.mock.calls[0][0]).toMatchObject({ key: 'oldemeyer2025', doi: '10.5555/spur.heft.001', meta })
    expect(m.QuellenManager.aufnehmen.mock.calls[0][0]).not.toHaveProperty('metadaten')
    expect(m.Aufnahme.mitBibEintrag.mock.calls[0][1]).toEqual([{ pfad: 'references.bib' }])
    expect(res.body).toMatchObject({ status: 'angelegt', key: 'oldemeyer2025' })
    expect(res.body).not.toHaveProperty('metadaten')
  })

  it('nimmt mit DOI auch auf, wenn Crossref die DOI nicht kennt oder nicht antwortet, und sagt welches', async () => {
    m.Aufnahme.metadaten.mockResolvedValueOnce({ meta: { gefunden: false } })
    const unbekannt = await hochladen({ doi: '10.9999/nirgends.1' }, 'unbekannt.pdf')
    m.Aufnahme.metadaten.mockRejectedValueOnce(new Problem(502, 'dienst_fehlt', 'spur_fehler_crossref_nicht_erreichbar'))
    const weg = await hochladen({ doi: '10.5555/spur.bot.001' })
    expect(m.QuellenManager.aufnehmen.mock.calls.map(([e]) => [e.doi, e.meta, e.metadaten])).toEqual([
      ['10.9999/nirgends.1', { titel: 'unbekannt', art: 'misc' }, 'unvollstaendig'],
      ['10.5555/spur.bot.001', { titel: 'report', art: 'misc' }, 'unvollstaendig'],
    ])
    expect(unbekannt.res.body.metadaten_hinweis).toBe(meldung('spur_hinweis_doi_nicht_gefunden', { doi: '10.9999/nirgends.1' }))
    expect(weg.res.body.metadaten_hinweis).toBe(meldung('spur_hinweis_doi_crossref_fehlt'))
  })

  it('meldet eine Datei mit einer DOI, die im Projekt schon eine Quelle hat, als vorhanden', async () => {
    const alt = { _id: new ObjectId(), dateiname: 'anders.pdf', doi: '10.5555/Spur.Heft.001' }
    m.QuellenManager.alle.mockResolvedValue([alt])
    const { res } = await hochladen({ doi: '10.5555/spur.heft.001' })
    expect(res.body).toEqual({ datei: 'report.pdf', status: 'vorhanden', quelle_id: String(alt._id) })
    expect(m.QuellenManager.aufnehmen).not.toHaveBeenCalled()
  })

  it('meldet dieselbe Datei ohne DOI als vorhanden, auch wenn ein paralleler Upload sie gerade angelegt hat', async () => {
    m.vorhanden = { _id: new ObjectId(), dateiname: 'report.pdf' }
    m.QuellenManager.aufnehmen.mockRejectedValueOnce(new Problem(409, 'quelle_vorhanden', 'spur_fehler_quelle_vorhanden'))
    const { res } = await hochladen(REPORT)
    expect(res.body).toEqual({ datei: 'report.pdf', status: 'vorhanden', quelle_id: String(m.vorhanden._id) })
  })

  it('meldet eine Datei, die im Projekt schon unter diesem Namen liegt, ohne sie erneut aufzunehmen', async () => {
    const alt = { _id: new ObjectId(), dateiname: 'report.pdf' }
    m.QuellenManager.alle.mockResolvedValue([alt])
    const { res } = await hochladen(REPORT)
    expect(res.body).toEqual({ datei: 'report.pdf', status: 'vorhanden', quelle_id: String(alt._id) })
    expect(m.QuellenManager.aufnehmen).not.toHaveBeenCalled()
  })

  it('verweigert Konten ohne Schreibrecht', async () => {
    m.rechte.rolleFuerClaude.mockResolvedValue('readOnly')
    const { res } = await hochladen(REPORT)
    expect(res.statusCode).toBe(403)
    expect(m.QuellenManager.aufnehmen).not.toHaveBeenCalled()
  })
})
