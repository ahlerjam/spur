import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { berechtigung } from './hilfen/berechtigung.mjs'
import { ObjectId, testDatenbank } from './hilfen/datenbank.mjs'
import { fehlerVon } from './hilfen/fehler.mjs'
import { meldung } from '../../app/src/meldungen.mjs'

let datenbank
let WERKZEUGE
let recht
let m
const anna = new ObjectId()
const admin = new ObjectId()
const bot = new ObjectId()
const projekt = String(new ObjectId())
const kontext = { menschId: anna, botId: bot }
const STAND = { aenderungen: { gesamt: 3, automatisch_angenommen: 2, offen: 1, rot: 1 }, hinweis: 'Zwei Änderungen stehen bereits im Text.' }

beforeAll(async () => {
  datenbank = await testDatenbank()
})
afterAll(async () => await datenbank.schliessen())

beforeEach(async () => {
  await datenbank.leeren()
  recht = berechtigung()
  m = {
    PruefManager: { dokumente: vi.fn(async () => []), bericht: vi.fn() },
    QuellenManager: { alle: vi.fn(async () => []), suchen: vi.fn(), holen: vi.fn(), seite: vi.fn(), seitenBildFuerClaude: vi.fn(async () => Buffer.from('PNG')) },
    ZitatManager: { markieren: vi.fn() },
    SchreibManager: { docEdit: vi.fn(async () => ({ aenderung: true })), docCreate: vi.fn(async () => ({ aenderung: true })) },
    LaufManager: {
      letzterLauf: vi.fn(async () => ({ _id: 'l1', status: 'offen' })),
      offenerLauf: vi.fn(async () => ({ _id: 'l1' })),
      beenden: vi.fn(async () => {}),
      laufFuerClient: vi.fn(l => l && { id: l._id, status: l.status }),
    },
    LaufAktionen: { nachLaufende: vi.fn(async () => {}), stand: vi.fn(async () => STAND) },
    Inbox: {
      warteAufEreignis: vi.fn(),
      seit: vi.fn(),
      letzterCursor: vi.fn(async () => 'c9'),
      standardWarteSekunden: () => 100,
      antwortSpeichern: vi.fn(async () => ({ _id: 'n1' })),
    },
    Crossref: { pruefen: vi.fn() },
    Beschaffung: {
      hinzufuegen: vi.fn(async () => ({ _id: 'b1', doi: '10.1/x', meta: { titel: 'T' }, status: 'offen' })),
      aufnehmenOderVormerken: vi.fn(async () => ({ _id: 'q1', key: 'keller2014', dateiname: 'keller2014.pdf', doi: '10.1/x' })),
    },
    Literatur: { vorschlagen: vi.fn(async () => ({ quelle_id: 'q', spalte: 'Methode' })) },
    Kompilieren: {
      starten: vi.fn(async () => ({ job_id: 'j1', status: 'laeuft' })),
      seitenBild: vi.fn(async () => Buffer.from('PNG')),
      log: vi.fn(),
      status: vi.fn(),
    },
    TexPakete: { hinzufuegen: vi.fn(async () => ({ paket: 'xfrac', dateien: [], fehlende_abhaengigkeiten: [] })) },
    UploadLink: { GUELTIG_MINUTEN: 15, MAX_DATEIEN: 50, MAX_PROJEKTDATEIEN: 20, erzeugen: vi.fn(async () => ({ link: 'https://x/spur/hochladen/t' })) },
    Projektdatei: { abbildungAusQuelle: vi.fn(async ({ pfad }) => ({ pfad, lizenz: 'cc-by', quellenangabe: 'Aus \\textcite{offen2023}, S. 3, Lizenz CC BY.' })) },
    Aufnahme: {
      perDoi: vi.fn(async () => ({ _id: 'q1', key: 'keller2014', dateiname: 'keller2014.pdf', doi: '10.1/x' })),
      perUrl: vi.fn(async () => ({ _id: 'q2', key: 'virtanen2024', dateiname: 'virtanen2024.pdf', doi: null, titelabgleich: 'passt' })),
    },
    Erwaehnung: { imThreadAntworten: vi.fn(async () => ({ nachricht_id: 'm1' })) },
    Vorschlaege: { ARTEN: ['compile_fehler', 'belegloses_argument'], vorschlagen: vi.fn(async () => ({ vorschlag_id: 'v1' })) },
    Recherche: { doiPruefen: d => d.toLowerCase(), suchen: vi.fn(async () => ({ treffer: [], fehler: [] })), zitationen: vi.fn(async () => ({ treffer: [] })) },
    Suchprotokoll: {
      SEITE: 50,
      liste: vi.fn(async () => ({ eintraege: [{ anfrage: 'sleep', seite: 0 }], gesamt: 1, weiter: false })),
      prisma: vi.fn(async () => ({ identifiziert: 9, dubletten: 2, gesichtet: 7 })),
      ausschliessen: vi.fn(async ({ doi, grund }) => ({ doi, titel: 'T', grund })),
    },
  }
  vi.resetModules()
  vi.doMock('../../../../app/src/infrastructure/mongodb.mjs', () => datenbank.mongodbModul)
  recht.anmelden(vi)
  vi.doMock('../../app/src/pruefung/PruefManager.mjs', () => m.PruefManager)
  vi.doMock('../../app/src/recherche/Suchprotokoll.mjs', () => m.Suchprotokoll)
  vi.doMock('../../app/src/QuellenManager.mjs', () => m.QuellenManager)
  vi.doMock('../../app/src/ZitatManager.mjs', () => m.ZitatManager)
  vi.doMock('../../app/src/schreiben/SchreibManager.mjs', () => m.SchreibManager)
  vi.doMock('../../app/src/schreiben/LaufManager.mjs', () => m.LaufManager)
  vi.doMock('../../app/src/schreiben/LaufAktionen.mjs', () => m.LaufAktionen)
  vi.doMock('../../app/src/Inbox.mjs', () => m.Inbox)
  vi.doMock('../../app/src/Crossref.mjs', () => m.Crossref)
  vi.doMock('../../app/src/recherche/Recherche.mjs', () => m.Recherche)
  vi.doMock('../../app/src/recherche/Aufnahme.mjs', () => m.Aufnahme)
  vi.doMock('../../app/src/kompilieren/Kompilieren.mjs', () => m.Kompilieren)
  vi.doMock('../../app/src/kompilieren/TexPakete.mjs', () => m.TexPakete)
  vi.doMock('../../app/src/hochladen/UploadLink.mjs', () => m.UploadLink)
  vi.doMock('../../app/src/hochladen/Projektdatei.mjs', () => m.Projektdatei)
  vi.doMock('../../app/src/literatur/Literatur.mjs', () => m.Literatur)
  vi.doMock('../../app/src/recherche/Beschaffung.mjs', () => m.Beschaffung)
  vi.doMock('../../app/src/erwaehnung/Erwaehnung.mjs', () => m.Erwaehnung)
  vi.doMock('../../app/src/vorschlaege/Vorschlaege.mjs', () => m.Vorschlaege)
  ;({ WERKZEUGE } = await import('../../app/src/mcp/werkzeuge.mjs'))
  recht.vergeben(anna, projekt, { stufe: 'owner' })
})

const aufruf = (name, args = {}, k = kontext, ctx) => WERKZEUGE[name].ausfuehren(args, k, ctx)
const mitStufe = stufe => recht.vergeben(anna, projekt, { stufe })

describe('Rechte der Werkzeuge', () => {
  const alleLesen = [
    ['doc_list', {}],
    ['doc_read', { pfad: 'a.tex' }],
    ['sources_list', {}],
    ['source_search', { query: 'x' }],
    ['source_read', { source_id: 'q', pdf_seite: 1 }],
    ['check_report', {}],
    ['bib_list', {}],
    ['reply', { text: 'Hallo' }],
    ['suggest', { art: 'compile_fehler', titel: 'Fehler in Zeile 4', text: 'x' }],
    ['run_status', {}],
    ['paper_search', { anfrage: 'sleep' }],
    ['search_log', {}],
    ['compile', {}],
    ['compile_log', {}],
    ['page_image', { seite: 1 }],
    ['source_page_image', { quelle_id: 'q', pdf_seite: 1 }],
  ]

  it.each(alleLesen)('%s verweigert Nutzern ohne Zugriff mit keine_rechte', async (name, args) => {
    recht.projektOhneRechte(projekt)
    const fremd = new ObjectId()
    const fehler = await fehlerVon(aufruf(name, { project_id: projekt, ...args }, { menschId: fremd, botId: bot }))
    expect(fehler).toMatchObject({ code: 'keine_rechte' })
    expect(m.PruefManager.dokumente).not.toHaveBeenCalled()
  })

  it('meldet ein unbekanntes Projekt auch mit Admin-Token als keine_rechte', async () => {
    recht.stand.admins.add(String(admin))
    const unbekannt = String(new ObjectId())
    for (const [name, args] of [...alleLesen, ['doc_edit', { alt: '', neu: 'x', idempotenz_schluessel: 'schluessel-0001' }], ['quote_mark', { source_id: 'q', pdf_seite: 1, text: 'x' }]]) {
      const fehler = await fehlerVon(aufruf(name, { project_id: unbekannt, ...args }, { menschId: admin, botId: bot }))
      expect(fehler, name).toMatchObject({ code: 'keine_rechte' })
    }
  })

  it('gibt einem Admin in einem fremden Projekt keine Rechte', async () => {
    recht.stand.admins.add(String(admin))
    recht.projektOhneRechte(projekt)
    expect(await fehlerVon(aufruf('doc_list', { project_id: projekt }, { menschId: admin, botId: bot }))).toMatchObject({ code: 'keine_rechte' })
  })

  it('lässt Lesende lesen und antworten, aber nicht schreiben', async () => {
    mitStufe('readOnly')
    await aufruf('doc_list', { project_id: projekt })
    await aufruf('reply', { project_id: projekt, text: 'Frage' })
    for (const [name, args] of [
      ['doc_edit', { alt: '', neu: 'x', idempotenz_schluessel: 'schluessel-0001' }],
      ['doc_create', { pfad: 'a.tex', inhalt: '', idempotenz_schluessel: 'schluessel-0001' }],
      ['quote_mark', { source_id: 'q', pdf_seite: 1, text: 'x' }],
      ['run_finish', { zusammenfassung: 'fertig' }],
    ]) {
      expect(await fehlerVon(aufruf(name, { project_id: projekt, ...args })), name).toMatchObject({ code: 'keine_rechte' })
    }
    expect(m.SchreibManager.docEdit).not.toHaveBeenCalled()
  })

  it('lässt Prüfende Änderungen und Läufe beenden, aber keine Dateien anlegen oder Zitate markieren', async () => {
    mitStufe('review')
    await aufruf('doc_edit', { project_id: projekt, alt: '', neu: 'x', idempotenz_schluessel: 'schluessel-0001' })
    await aufruf('run_finish', { project_id: projekt, zusammenfassung: 'fertig' })
    for (const [name, args] of [
      ['doc_create', { pfad: 'a.tex', inhalt: '', idempotenz_schluessel: 'schluessel-0001' }],
      ['quote_mark', { source_id: 'q', pdf_seite: 1, text: 'x' }],
    ]) {
      expect(await fehlerVon(aufruf(name, { project_id: projekt, ...args })), name).toMatchObject({ code: 'keine_rechte' })
    }
  })

  it('verweigert einem reinen Leselink jeden Zugriff', async () => {
    recht.vergeben(anna, projekt, { stufe: 'readOnly', tokenMember: true, invited: false })
    expect(await fehlerVon(aufruf('doc_list', { project_id: projekt }))).toMatchObject({ code: 'keine_rechte' })
  })
})

describe('project_list', () => {
  const projekte = () => datenbank.db.collection('projects')

  it('listet Projekte des Menschen alphabetisch mit Rolle nach MCP-Vertrag', async () => {
    const a = new ObjectId()
    const b = new ObjectId()
    const c = new ObjectId()
    await projekte().insertMany([
      { _id: b, name: 'Beta', collaberator_refs: [anna] },
      { _id: a, name: 'Alpha', owner_ref: anna },
      { _id: c, name: 'Gamma', readOnly_refs: [anna] },
      { _id: new ObjectId(), name: 'Fremd', owner_ref: new ObjectId() },
      { _id: new ObjectId(), name: 'Papierkorb', owner_ref: anna, trashed: [anna] },
    ])
    recht.vergeben(anna, a, { stufe: 'owner' })
    recht.vergeben(anna, b, { stufe: 'readAndWrite' })
    recht.vergeben(anna, c, { stufe: 'readOnly' })
    expect(await aufruf('project_list')).toEqual({
      eintraege: [
        { id: a, name: 'Alpha', rolle: 'owner' },
        { id: b, name: 'Beta', rolle: 'write' },
        { id: c, name: 'Gamma', rolle: 'read' },
      ],
      naechster_cursor: null,
    })
  })

  it('zeigt keine Rolle, wo Claude nichts darf (Leselink)', async () => {
    const id = new ObjectId()
    await projekte().insertOne({ _id: id, name: 'Link', tokenAccessReadAndWrite_refs: [anna] })
    recht.vergeben(anna, id, { stufe: 'readOnly', tokenMember: true, invited: false })
    expect((await aufruf('project_list')).eintraege[0].rolle).toBeNull()
  })

  it('blättert in 50er-Seiten', async () => {
    await projekte().insertMany(Array.from({ length: 60 }, (_, i) => ({ _id: new ObjectId(), name: `P${String(i).padStart(2, '0')}`, owner_ref: anna })))
    const erste = await aufruf('project_list')
    expect(erste.eintraege).toHaveLength(50)
    expect(erste.naechster_cursor).toBe('50')
    const zweite = await aufruf('project_list', { cursor: '50' })
    expect(zweite.eintraege).toHaveLength(10)
    expect(zweite.naechster_cursor).toBeNull()
    expect((await aufruf('project_list', { cursor: 'kaputt' })).eintraege).toHaveLength(50)
    expect((await aufruf('project_list', { cursor: '-5' })).eintraege).toHaveLength(50)
  })
})

describe('Lesen im Projekt', () => {
  const docs = [
    { pfad: 'main.tex', docId: 'd1', text: 'Zeile 1\nZeile 2\nZeile 3' },
    { pfad: 'lit.bib', docId: 'd2', text: '@article{a, doi={10.1/a}}\n@article{b, title={x}}\n@article{c, doi={10.1/c}}\n@article{d, doi={10.1/d}}' },
  ]
  beforeEach(() => m.PruefManager.dokumente.mockResolvedValue(docs))

  it('doc_list nennt ID, Pfad und Länge', async () => {
    expect(await aufruf('doc_list', { project_id: projekt })).toEqual({
      eintraege: [{ id: 'd1', pfad: 'main.tex', zeichen: 23 }, { id: 'd2', pfad: 'lit.bib', zeichen: docs[1].text.length }],
      naechster_cursor: null,
    })
  })

  it('doc_read liest über Pfad oder ID, ab einer Zeile', async () => {
    const ergebnis = await aufruf('doc_read', { project_id: projekt, pfad: 'main.tex', ab_zeile: 2 })
    expect(ergebnis).toEqual({ id: 'd1', pfad: 'main.tex', ab_zeile: 2, text: 'Zeile 2\nZeile 3', gekuerzt: false })
    expect((await aufruf('doc_read', { project_id: projekt, doc_id: 'd2' })).pfad).toBe('lit.bib')
  })

  it('doc_read kürzt auf 40000 Zeichen und meldet das', async () => {
    m.PruefManager.dokumente.mockResolvedValue([{ pfad: 'gross.tex', docId: 'd9', text: 'x'.repeat(40001) }])
    const ergebnis = await aufruf('doc_read', { project_id: projekt, pfad: 'gross.tex' })
    expect(ergebnis.text).toHaveLength(40000)
    expect(ergebnis.gekuerzt).toBe(true)
  })

  it('doc_read meldet doc_fehlt', async () => {
    expect(await fehlerVon(aufruf('doc_read', { project_id: projekt, pfad: 'nope.tex' }))).toMatchObject({ code: 'doc_fehlt' })
  })

  it('sources_list zeigt Status und Titel ohne Text', async () => {
    m.QuellenManager.alle.mockResolvedValue([
      { _id: 'q1', dateiname: 'a.pdf', key: 'a', doi: '10.1/a', seitenzahl: 8, status: 'text', fassung: '', meta: { titel: 'A & B', geheim: 1 } },
    ])
    expect(await aufruf('sources_list', { project_id: projekt })).toEqual({
      eintraege: [{ id: 'q1', dateiname: 'a.pdf', key: 'a', doi: '10.1/a', titel: 'A & B', seiten: 8, status: 'text', fassung: '' }],
      naechster_cursor: null,
    })
  })

  it('sources_list nennt den Titelabgleich und warnt bei einem abweichenden PDF', async () => {
    const quelle = (id, titelabgleich) => ({ _id: id, dateiname: `${id}.pdf`, key: id, doi: null, seitenzahl: 2, status: 'text', fassung: '', titelabgleich })
    m.QuellenManager.alle.mockResolvedValue([quelle('a', 'passt'), quelle('b', 'abweichend'), quelle('c', 'nicht_pruefbar')])
    const { eintraege } = await aufruf('sources_list', { project_id: projekt })
    expect(eintraege.map(e => [e.titelabgleich, e.hinweis])).toEqual([
      ['passt', undefined],
      ['abweichend', meldung('spur_hinweis_titel_abweichend')],
      ['nicht_pruefbar', undefined],
    ])
  })

  it('sources_list nennt Autorenabgleich und unvollständige Metadaten; nur abweichend ist ein Hinweis (P13)', async () => {
    const quelle = (id, felder) => ({ _id: id, dateiname: `${id}.pdf`, key: id, doi: null, seitenzahl: 2, status: 'text', fassung: '', ...felder })
    m.QuellenManager.alle.mockResolvedValue([quelle('a', { autoren: 'aus_pdf' }), quelle('b', { autoren: 'abweichend' }), quelle('c', { metadaten: 'unvollstaendig' }), quelle('d')])
    const { eintraege } = await aufruf('sources_list', { project_id: projekt })
    expect(eintraege.map(e => [e.autoren, e.autoren_hinweis, e.metadaten])).toEqual([
      ['aus_pdf', undefined, undefined],
      ['abweichend', meldung('spur_hinweis_autoren_abweichend'), undefined],
      [undefined, undefined, 'unvollstaendig'],
      [undefined, undefined, undefined],
    ])
  })

  it('source_search nennt gedruckte Seite, PDF-Seite und Position, keinen Absatz', async () => {
    m.QuellenManager.suchen.mockResolvedValue([
      { quelleId: 'q1', dateiname: 'a.pdf', seite: 3, label: '347', position: 12, auszug: 'geheim' },
      { quelleId: 'q2', dateiname: 'b.vtt', seite: 2, label: null, position: 0 },
    ])
    expect(await aufruf('source_search', { project_id: projekt, query: 'x' })).toEqual({
      treffer: [
        { quelle_id: 'q1', dateiname: 'a.pdf', seite: '347', pdf_seite: 3, position: 12 },
        { quelle_id: 'q2', dateiname: 'b.vtt', seite: 2, pdf_seite: 2, position: 0 },
      ],
    })
    expect(m.QuellenManager.suchen).toHaveBeenCalledWith(new ObjectId(projekt), 'x')
  })

  it('source_read kürzt auf max_zeichen', async () => {
    m.QuellenManager.holen.mockResolvedValue({ _id: 'q1' })
    m.QuellenManager.seite.mockResolvedValue({ seite: 3, label: null, text: 'abcdefghij' })
    expect(await aufruf('source_read', { project_id: projekt, source_id: 'q1', pdf_seite: 3, max_zeichen: 4 })).toEqual({
      quelle_id: 'q1',
      seite: 3,
      text: 'abcd',
      ab_zeichen: 0,
      bis_zeichen: 4,
      zeichen_gesamt: 10,
      gekuerzt: true,
    })
    expect((await aufruf('source_read', { project_id: projekt, source_id: 'q1', pdf_seite: 3 })).gekuerzt).toBe(false)
  })

  describe('source_read ab einer Stelle', () => {
    // Echter Fall: Treffer von source_search an Position 4858 und 6037 lagen hinter Zeichen 4000.
    const text = `${'x'.repeat(6037)}The effect persisted after twelve weeks.${'y'.repeat(9500 - 6037 - 40)}`
    const lesen = args => aufruf('source_read', { project_id: projekt, source_id: 'q1', pdf_seite: 2, ...args })
    beforeEach(() => {
      m.QuellenManager.holen.mockResolvedValue({ _id: 'q1' })
      m.QuellenManager.seite.mockResolvedValue({ seite: 2, label: null, text })
    })

    it('liest ab ab_zeichen bis zum Seitenende', async () => {
      const r = await lesen({ ab_zeichen: 6000 })
      expect(r.text).toContain('The effect persisted after twelve weeks.')
      expect(r).toMatchObject({ ab_zeichen: 6000, bis_zeichen: 9500, zeichen_gesamt: 9500, gekuerzt: false })
    })

    it('liest ab 4858 höchstens 4000 Zeichen', async () => {
      expect(await lesen({ ab_zeichen: 4858 })).toMatchObject({ ab_zeichen: 4858, bis_zeichen: 8858, gekuerzt: true })
    })

    it('liefert ohne ab_zeichen die ersten 4000 Zeichen und die Gesamtzahl', async () => {
      const r = await lesen({})
      expect(r.text).toHaveLength(4000)
      expect(r).toMatchObject({ ab_zeichen: 0, bis_zeichen: 4000, zeichen_gesamt: 9500, gekuerzt: true })
    })

    it('liefert hinter dem Seitenende leeren Text statt eines Fehlers', async () => {
      expect(await lesen({ ab_zeichen: 20000 })).toMatchObject({ text: '', zeichen_gesamt: 9500, gekuerzt: false })
    })

    it('lehnt negatives ab_zeichen mit eingabe_ungueltig ab', async () => {
      const fehler = await fehlerVon(lesen({ ab_zeichen: -1 }))
      expect(fehler).toMatchObject({ status: 422, typ: 'eingabe_ungueltig', zusatz: { feld: 'ab_zeichen' } })
      expect(WERKZEUGE.source_read.inputSchema.safeParse({ project_id: projekt, source_id: projekt, pdf_seite: 2, ab_zeichen: -1 }).success).toBe(true)
    })

    it('sagt in der Beschreibung, wie man weiterliest', () => {
      expect(WERKZEUGE.source_read.description).toMatch(/bis_zeichen.*als nächstes ab_zeichen/)
    })
  })

  it('check_report liefert Zeilen seitenweise samt Statistik', async () => {
    m.PruefManager.bericht.mockResolvedValue({ zeilen: Array.from({ length: 55 }, (_, i) => ({ i })), zaehlung: { geprueft: 1, ohne_quelle: 2 }, abschnitte: { neu: 1, uebernommen: 0 } })
    const ergebnis = await aufruf('check_report', { project_id: projekt })
    expect(ergebnis.eintraege).toHaveLength(50)
    expect(ergebnis).toMatchObject({ naechster_cursor: '50', zaehlung: { geprueft: 1, ohne_quelle: 2 } })
    expect(ergebnis).not.toHaveProperty('abschnitte')
  })

  it('bib_list nennt den Status der DOI und die Abweichungen von Crossref je Eintrag', async () => {
    m.Crossref.pruefen.mockImplementation(async doi =>
      ({ '10.1/a': { gefunden: true, registrierstelle: 'crossref', retraction: 'zurueckgezogen', band: '7' }, '10.1/c': { gefunden: false }, '10.1/d': null })[doi]
    )
    const { eintraege } = await aufruf('bib_list', { project_id: projekt })
    expect(eintraege).toEqual([
      { key: 'a', doi: '10.1/a', referenz: 'gefunden', registrierstelle: 'crossref', retraction: 'zurueckgezogen', abweichungen: [{ feld: 'volume', eintrag: null, erwartet: '7' }] },
      { key: 'b', doi: null, referenz: 'ohne_doi', retraction: null, abweichungen: null, abweichungen_grund: 'ohne_doi' },
      { key: 'c', doi: '10.1/c', referenz: 'nicht_gefunden', retraction: null, abweichungen: null, abweichungen_grund: 'nicht_bei_crossref' },
      { key: 'd', doi: '10.1/d', referenz: 'nicht_pruefbar', grund: 'crossref_nicht_erreichbar', retraction: null, abweichungen: null, abweichungen_grund: 'crossref_nicht_erreichbar' },
    ])
  })
})

describe('Schreiben', () => {
  it('quote_mark markiert die Fundstelle als der Mensch', async () => {
    m.QuellenManager.holen.mockResolvedValue({ _id: 'q1' })
    m.ZitatManager.markieren.mockResolvedValue({ _id: 'z1', label: null, seite: 3 })
    expect(await aufruf('quote_mark', { project_id: projekt, source_id: 'q1', pdf_seite: 3, text: 'Satz' })).toEqual({ zitat_id: 'z1', seite: 3 })
    expect(m.ZitatManager.markieren).toHaveBeenCalledWith({ _id: 'q1' }, { seite: 3, text: 'Satz' }, anna)
  })

  it('doc_edit reicht Argumente und Bot an den SchreibManager', async () => {
    await aufruf('doc_edit', { project_id: projekt, pfad: 'a.tex', alt: 'x', neu: 'y', idempotenz_schluessel: 'schluessel-0001' })
    expect(m.SchreibManager.docEdit).toHaveBeenCalledWith({
      projectId: new ObjectId(projekt),
      botId: bot,
      menschId: anna,
      docId: undefined,
      pfad: 'a.tex',
      alt: 'x',
      neu: 'y',
      schluessel: 'schluessel-0001',
      alleVorkommen: false,
    })
    await aufruf('doc_edit', { project_id: projekt, pfad: 'a.tex', alt: 'x', neu: 'y', alle_vorkommen: true, idempotenz_schluessel: 'schluessel-0002' })
    expect(m.SchreibManager.docEdit).toHaveBeenLastCalledWith(expect.objectContaining({ alleVorkommen: true }))
  })

  it('doc_create reicht Pfad und Inhalt weiter', async () => {
    await aufruf('doc_create', { project_id: projekt, pfad: 'neu.tex', inhalt: 'Text', idempotenz_schluessel: 'schluessel-0001' })
    expect(m.SchreibManager.docCreate).toHaveBeenCalledWith({ projectId: new ObjectId(projekt), botId: bot, menschId: anna, pfad: 'neu.tex', inhalt: 'Text', schluessel: 'schluessel-0001' })
  })

  it('reply speichert die Antwort für den Bot', async () => {
    expect(await aufruf('reply', { project_id: projekt, text: 'Erledigt' })).toEqual({ nachricht_id: 'n1' })
    expect(m.Inbox.antwortSpeichern).toHaveBeenCalledWith({ projectId: new ObjectId(projekt), botId: bot, text: 'Erledigt' })
  })

  it('reply mit kommentar_id antwortet im Kommentar-Thread statt im Panel', async () => {
    const thread = 'aaaaaaaaaaaaaaaaaaaaaaaa'
    expect(await aufruf('reply', { project_id: projekt, text: 'Nicht belegt.', kommentar_id: thread })).toEqual({ nachricht_id: 'm1' })
    expect(m.Erwaehnung.imThreadAntworten).toHaveBeenCalledWith({
      projectId: new ObjectId(projekt),
      threadId: thread,
      botId: bot,
      text: 'Nicht belegt.',
    })
    expect(m.Inbox.antwortSpeichern).not.toHaveBeenCalled()
  })

  it('suggest legt einen Vorschlag des Bots ins Panel, auch mit Leserecht', async () => {
    mitStufe('readOnly')
    const args = { art: 'belegloses_argument', titel: 'Beleg fehlt', text: 'Quelle ergänzen.', pfad: 'main.tex' }
    expect(await aufruf('suggest', { project_id: projekt, ...args })).toEqual({ vorschlag_id: 'v1' })
    expect(m.Vorschlaege.vorschlagen).toHaveBeenCalledWith({ projectId: new ObjectId(projekt), botId: bot, ...args })
    expect(m.SchreibManager.docEdit).not.toHaveBeenCalled()
  })

  it('run_status zeigt den letzten Lauf mit seinem Stand', async () => {
    expect(await aufruf('run_status', { project_id: projekt })).toEqual({ lauf: { id: 'l1', status: 'offen' }, ...STAND })
    expect(m.LaufAktionen.stand).toHaveBeenCalledWith(new ObjectId(projekt), { _id: 'l1', status: 'offen' })
  })

  it('run_finish beendet den offenen Lauf und stößt die Automatik an', async () => {
    const ergebnis = await aufruf('run_finish', { project_id: projekt, zusammenfassung: 'Geglättet.' })
    expect(m.LaufManager.beenden).toHaveBeenCalledWith({ _id: 'l1' }, 'Geglättet.')
    expect(m.LaufAktionen.nachLaufende).toHaveBeenCalledWith(new ObjectId(projekt), { _id: 'l1' })
    expect(ergebnis).toEqual({ lauf: { id: 'l1', status: 'offen' }, ...STAND })
  })

  it('run_finish meldet kein_lauf, wenn keiner offen ist', async () => {
    m.LaufManager.offenerLauf.mockResolvedValue(null)
    expect(await fehlerVon(aufruf('run_finish', { project_id: projekt, zusammenfassung: 'x' }))).toMatchObject({ code: 'kein_lauf' })
    expect(m.LaufManager.beenden).not.toHaveBeenCalled()
  })
})

describe('Ereignisse', () => {
  it('wait_for_event liefert den Auftrag mit seiner ID als Cursor', async () => {
    m.Inbox.warteAufEreignis.mockResolvedValue({ ereignis: { id: 'e1', typ: 'task_created' }, abgeloest: false })
    const ctx = { mcpReq: { signal: 'signal', _meta: {} } }
    expect(await aufruf('wait_for_event', { max_sekunden: 10 }, kontext, ctx)).toEqual({ ereignis: { id: 'e1', typ: 'task_created' }, cursor: 'e1' })
    expect(m.Inbox.warteAufEreignis).toHaveBeenCalledWith(bot, expect.objectContaining({ signal: 'signal', maxMs: 10000 }))
  })

  it('wait_for_event kehrt ohne Auftrag nach 100 Sekunden mit Cursor und Hinweis zurück', async () => {
    m.Inbox.warteAufEreignis.mockResolvedValue({ ereignis: null, abgeloest: false })
    const ergebnis = await aufruf('wait_for_event', {}, kontext, { mcpReq: { signal: null, _meta: {} } })
    expect(ergebnis).toEqual({ ereignis: null, cursor: 'c9', hinweis: meldung('spur_warten_kein_auftrag') })
    expect(m.Inbox.warteAufEreignis.mock.calls[0][1].maxMs).toBe(100000)
  })

  it('wait_for_event meldet abgeloest, wenn ein neuerer Aufruf wartet, und bittet, nicht erneut aufzurufen', async () => {
    m.Inbox.warteAufEreignis.mockResolvedValue({ ereignis: null, abgeloest: true })
    const ergebnis = await aufruf('wait_for_event', {}, kontext, { mcpReq: { signal: null, _meta: {} } })
    expect(ergebnis).toEqual({ ereignis: null, abgeloest: true, cursor: 'c9', hinweis: meldung('spur_warten_abgeloest') })
  })

  it('wait_for_event meldet Fortschritt nur, wenn der Client ein Token mitgeschickt hat', async () => {
    const notify = vi.fn(async () => {})
    m.Inbox.warteAufEreignis.mockImplementation(async (_bot, { fortschritt }) => {
      await fortschritt(30)
      await fortschritt(60)
      return { ereignis: null, abgeloest: false }
    })
    await aufruf('wait_for_event', {}, kontext, { mcpReq: { _meta: { progressToken: 'pt' }, notify } })
    expect(notify.mock.calls.map(([n]) => n.params)).toEqual([
      { progressToken: 'pt', progress: 1, message: 'wartet seit 30 s' },
      { progressToken: 'pt', progress: 2, message: 'wartet seit 60 s' },
    ])
    notify.mockClear()
    await aufruf('wait_for_event', {}, kontext, { mcpReq: { _meta: {}, notify } })
    expect(notify).not.toHaveBeenCalled()
  })

  it('events_since reicht Cursor und Bot an die Inbox', async () => {
    m.Inbox.seit.mockResolvedValue({ ereignisse: [], cursor: null })
    expect(await aufruf('events_since', { cursor: 'abc' })).toEqual({ ereignisse: [], cursor: null })
    expect(m.Inbox.seit).toHaveBeenCalledWith(bot, 'abc')
  })
})

describe('Eingabeprüfung', () => {
  it('verlangt 24-stellige Hex-IDs und Schlüssel mit mindestens 8 Zeichen', () => {
    expect(WERKZEUGE.doc_list.inputSchema.safeParse({ project_id: 'kurz' }).success).toBe(false)
    expect(WERKZEUGE.doc_list.inputSchema.safeParse({ project_id: projekt }).success).toBe(true)
    expect(WERKZEUGE.doc_edit.inputSchema.safeParse({ project_id: projekt, neu: 'x', idempotenz_schluessel: 'kurz' }).success).toBe(false)
    expect(WERKZEUGE.doc_create.inputSchema.safeParse({ project_id: projekt, pfad: 'a.exe', inhalt: '', idempotenz_schluessel: 'schluessel-0001' }).success).toBe(false)
  })
})

describe('Recherche', () => {
  it('paper_search sucht für Projekt und Person und reicht das Ergebnis durch', async () => {
    m.Recherche.suchen.mockResolvedValue({ treffer: [{ doi: '10.1038/nrn2762' }], fehler: [] })
    const ergebnis = await aufruf('paper_search', { project_id: projekt, anfrage: 'sleep' })
    expect(ergebnis.treffer[0].doi).toBe('10.1038/nrn2762')
    expect(m.Recherche.suchen).toHaveBeenCalledWith({
      projectId: new ObjectId(projekt),
      userId: anna,
      anfrage: 'sleep',
      seite: 0,
    })
  })

  it('paper_search nimmt den cursor der nächsten Seite und nennt den folgenden', async () => {
    m.Recherche.suchen.mockImplementation(async ({ seite }) => ({ seite, treffer: [], fehler: [], weiter: seite === 0 }))
    const erste = await aufruf('paper_search', { project_id: projekt, anfrage: 'sleep' })
    expect(erste.naechster_cursor).toBe('1')
    const zweite = await aufruf('paper_search', { project_id: projekt, anfrage: 'sleep', cursor: erste.naechster_cursor })
    expect(m.Recherche.suchen).toHaveBeenLastCalledWith(expect.objectContaining({ seite: 1 }))
    expect(zweite.naechster_cursor).toBeNull()
  })

  it('search_log liefert die Anfragen in zeitlicher Folge, die PRISMA-Summen und blättert mit cursor', async () => {
    mitStufe('readOnly')
    expect(await aufruf('search_log', { project_id: projekt })).toEqual({
      eintraege: [{ anfrage: 'sleep', seite: 0 }],
      naechster_cursor: null,
      prisma: { identifiziert: 9, dubletten: 2, gesichtet: 7 },
    })
    expect(m.Suchprotokoll.liste).toHaveBeenCalledWith(new ObjectId(projekt), { ab: 0, aufsteigend: true })
    m.Suchprotokoll.liste.mockResolvedValue({ eintraege: [], gesamt: 120, weiter: true })
    expect((await aufruf('search_log', { project_id: projekt, cursor: '50' })).naechster_cursor).toBe('100')
    expect(m.Suchprotokoll.liste).toHaveBeenLastCalledWith(new ObjectId(projekt), { ab: 50, aufsteigend: true })
  })

  it('paper_exclude verlangt Schreibrechte und schließt per DOI oder Titel mit Grund aus', async () => {
    mitStufe('readOnly')
    expect(await fehlerVon(aufruf('paper_exclude', { project_id: projekt, doi: '10.1/X', grund: 'falsche Population' }))).toMatchObject({ code: 'keine_rechte' })
    expect(m.Suchprotokoll.ausschliessen).not.toHaveBeenCalled()
    mitStufe('owner')
    expect(await aufruf('paper_exclude', { project_id: projekt, doi: '10.1/X', grund: 'falsche Population' })).toEqual({ doi: '10.1/x', titel: 'T', grund: 'falsche Population' })
    expect(m.Suchprotokoll.ausschliessen).toHaveBeenCalledWith({ projectId: new ObjectId(projekt), userId: anna, doi: '10.1/x', titel: undefined, grund: 'falsche Population' })
    await aufruf('paper_exclude', { project_id: projekt, titel: 'Ohne DOI', grund: 'Abschlussarbeit' })
    expect(m.Suchprotokoll.ausschliessen).toHaveBeenLastCalledWith(expect.objectContaining({ doi: undefined, titel: 'Ohne DOI' }))
    expect(await fehlerVon(aufruf('paper_exclude', { project_id: projekt, grund: 'x' }))).toMatchObject({ typ: 'eingabe_ungueltig', zusatz: { feld: 'doi' } })
  })

  it('paper_citations reicht DOI und Richtung weiter', async () => {
    await aufruf('paper_citations', { doi: '10.1038/nrn2762', richtung: 'zitiert' })
    expect(m.Recherche.zitationen).toHaveBeenCalledWith('10.1038/nrn2762', 'zitiert')
  })

  it('source_add verlangt Schreibrechte und nimmt per DOI auf', async () => {
    mitStufe('readOnly')
    expect(await fehlerVon(aufruf('source_add', { project_id: projekt, doi: '10.1/X' }))).toMatchObject({ code: 'keine_rechte' })
    mitStufe('owner')
    expect(await aufruf('source_add', { project_id: projekt, doi: '10.1/X' })).toEqual({
      quelle_id: 'q1',
      key: 'keller2014',
      dateiname: 'keller2014.pdf',
      doi: '10.1/x',
    })
    expect(m.Beschaffung.aufnehmenOderVormerken).toHaveBeenCalledWith({ projectId: new ObjectId(projekt), userId: anna, doi: '10.1/x' })
  })

  it('source_add nimmt eine Quelle ohne DOI per pdf_url mit Metadaten auf', async () => {
    mitStufe('readOnly')
    const metadaten = { titel: 'Generative AI adoption in a large enterprise', autoren: [{ family: 'Virtanen', given: 'Aino' }], jahr: 2024, art: 'thesis' }
    const eingabe = { project_id: projekt, pdf_url: 'https://trepo.example/thesis.pdf', metadaten }
    expect(await fehlerVon(aufruf('source_add', eingabe))).toMatchObject({ code: 'keine_rechte' })
    mitStufe('owner')
    expect(await aufruf('source_add', eingabe)).toEqual({ quelle_id: 'q2', key: 'virtanen2024', dateiname: 'virtanen2024.pdf', doi: null, titelabgleich: 'passt' })
    expect(m.Aufnahme.perUrl).toHaveBeenCalledWith({ projectId: new ObjectId(projekt), userId: anna, pdfUrl: 'https://trepo.example/thesis.pdf', metadaten })
    expect(m.Beschaffung.aufnehmenOderVormerken).not.toHaveBeenCalled()
  })

  it('source_add verlangt genau eines von doi und pdf_url und nennt das Feld', async () => {
    mitStufe('owner')
    const beide = await fehlerVon(aufruf('source_add', { project_id: projekt, doi: '10.1/x', pdf_url: 'https://trepo.example/thesis.pdf' }))
    expect(beide).toMatchObject({ status: 422, typ: 'eingabe_ungueltig', zusatz: { feld: 'pdf_url' } })
    expect(beide.message).toBe(meldung('spur_fehler_eingabe_doi_oder_pdf_url', { feld: 'pdf_url' }))
    const keines = await fehlerVon(aufruf('source_add', { project_id: projekt }))
    expect(keines).toMatchObject({ status: 422, typ: 'eingabe_ungueltig', zusatz: { feld: 'doi' } })
    expect(m.Aufnahme.perUrl).not.toHaveBeenCalled()
    expect(m.Beschaffung.aufnehmenOderVormerken).not.toHaveBeenCalled()
  })

  it('source_add nennt nach einer Aufnahme das Ergebnis des Titelabgleichs', async () => {
    mitStufe('owner')
    m.Beschaffung.aufnehmenOderVormerken.mockResolvedValue({ _id: 'q1', key: 'k', dateiname: 'k.pdf', doi: '10.1/x', titelabgleich: 'passt' })
    expect(await aufruf('source_add', { project_id: projekt, doi: '10.1/X' })).toMatchObject({ titelabgleich: 'passt' })
  })

  it('acquisition_add verlangt Schreibrechte und setzt die DOI auf die Liste', async () => {
    mitStufe('review')
    expect(await fehlerVon(aufruf('acquisition_add', { project_id: projekt, doi: '10.1/X' }))).toMatchObject({ code: 'keine_rechte' })
    mitStufe('readAndWrite')
    expect(await aufruf('acquisition_add', { project_id: projekt, doi: '10.1/X' })).toEqual({
      eintrag_id: 'b1',
      doi: '10.1/x',
      titel: 'T',
      status: 'offen',
    })
  })

  it('matrix_suggest legt nur einen Vorschlag des Bots an und verlangt Schreibrechte', async () => {
    const quelle = String(new ObjectId())
    mitStufe('readOnly')
    expect(await fehlerVon(aufruf('matrix_suggest', { project_id: projekt, source_id: quelle, spalte: 'Methode', text: 'x' }))).toMatchObject({
      code: 'keine_rechte',
    })
    mitStufe('review')
    await aufruf('matrix_suggest', { project_id: projekt, source_id: quelle, spalte: 'Methode', text: 'x' })
    expect(m.Literatur.vorschlagen).toHaveBeenCalledWith(new ObjectId(projekt), { quelleId: quelle, spalte: 'Methode', text: 'x', botId: bot })
  })

  it('source_page_image liefert die Quellseite als MCP-Bild', async () => {
    m.QuellenManager.holen.mockResolvedValue({ _id: 'q1' })
    expect(await aufruf('source_page_image', { project_id: projekt, quelle_id: 'q1', pdf_seite: 4 })).toEqual({
      content: [{ type: 'image', data: Buffer.from('PNG').toString('base64'), mimeType: 'image/png' }],
    })
    expect(m.QuellenManager.holen).toHaveBeenCalledWith(new ObjectId(projekt), 'q1')
    expect(m.QuellenManager.seitenBildFuerClaude).toHaveBeenCalledWith({ _id: 'q1' }, 4)
  })

  it('compile startet als Person und Bot, page_image liefert ein PNG als MCP-Bild', async () => {
    mitStufe('readOnly')
    expect(await aufruf('compile', { project_id: projekt })).toEqual({ job_id: 'j1', status: 'laeuft' })
    expect(m.Kompilieren.starten).toHaveBeenCalledWith({ projectId: new ObjectId(projekt), menschId: anna, botId: bot })
    expect(await aufruf('page_image', { project_id: projekt, seite: 2 })).toEqual({
      content: [{ type: 'image', data: Buffer.from('PNG').toString('base64'), mimeType: 'image/png' }],
    })
  })

  it('tex_package_add verlangt Schreibrechte und holt das Paket als Person und Bot', async () => {
    mitStufe('readOnly')
    expect(await fehlerVon(aufruf('tex_package_add', { project_id: projekt, paket: 'xfrac' }))).toMatchObject({ code: 'keine_rechte' })
    mitStufe('readAndWrite')
    await aufruf('tex_package_add', { project_id: projekt, paket: 'xfrac' })
    expect(m.TexPakete.hinzufuegen).toHaveBeenCalledWith({ projectId: new ObjectId(projekt), menschId: anna, botId: bot, paket: 'xfrac' })
  })

  it('tex_package_add reicht datei statt paket weiter, auch nur mit Schreibrecht', async () => {
    mitStufe('readOnly')
    expect(await fehlerVon(aufruf('tex_package_add', { project_id: projekt, datei: 'booktabs.sty' }))).toMatchObject({ code: 'keine_rechte' })
    mitStufe('readAndWrite')
    await aufruf('tex_package_add', { project_id: projekt, datei: 'booktabs.sty' })
    expect(m.TexPakete.hinzufuegen).toHaveBeenLastCalledWith({ projectId: new ObjectId(projekt), menschId: anna, botId: bot, paket: undefined, datei: 'booktabs.sty' })
  })

  it('file_upload_link verlangt Schreibrecht und erzeugt einen Link für Projektdateien', async () => {
    mitStufe('review')
    expect(await fehlerVon(aufruf('file_upload_link', { project_id: projekt }))).toMatchObject({ code: 'keine_rechte' })
    mitStufe('readAndWrite')
    expect(await aufruf('file_upload_link', { project_id: projekt })).toEqual({ link: 'https://x/spur/hochladen/t' })
    expect(m.UploadLink.erzeugen).toHaveBeenCalledWith({ projectId: new ObjectId(projekt), menschId: anna, botId: bot, art: 'datei' })
    expect(WERKZEUGE.file_upload_link.description).toMatch(/--projektdatei/)
  })

  it('source_figure_add verlangt Schreibrecht und reicht Quelle, Seite, Ausschnitt und Pfad weiter', async () => {
    const args = { project_id: projekt, quelle_id: 'q1', pdf_seite: 3, ausschnitt: { x: 0.1, y: 0.2, breite: 0.8, hoehe: 0.4 }, pfad: 'abbildungen/offen2023-abb2.png' }
    mitStufe('review')
    expect(await fehlerVon(aufruf('source_figure_add', args))).toMatchObject({ code: 'keine_rechte' })
    mitStufe('owner')
    m.QuellenManager.holen.mockResolvedValue({ _id: 'q1', key: 'offen2023' })
    expect(await aufruf('source_figure_add', args)).toMatchObject({ pfad: 'abbildungen/offen2023-abb2.png', lizenz: 'cc-by' })
    expect(m.Projektdatei.abbildungAusQuelle).toHaveBeenCalledWith({
      projectId: new ObjectId(projekt), menschId: anna, botId: bot, quelle: { _id: 'q1', key: 'offen2023' }, seite: 3, ausschnitt: args.ausschnitt, pfad: args.pfad,
    })
    // Ausschnitt und Pfad prüft spur selbst, damit ein Fehler eingabe_ungueltig mit dem Feld ergibt.
    expect(WERKZEUGE.source_figure_add.inputSchema.safeParse({ ...args, quelle_id: projekt, ausschnitt: { x: 0, y: 0, breite: 0, hoehe: 2 }, pfad: 'a.jpg' }).success).toBe(true)
  })
})
