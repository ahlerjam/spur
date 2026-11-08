import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { berechtigung } from './hilfen/berechtigung.mjs'
import { ObjectId, testDatenbank } from './hilfen/datenbank.mjs'
import { fehlerVon } from './hilfen/fehler.mjs'

let datenbank
let WERKZEUGE
let recht
let m
const anna = new ObjectId()
const admin = new ObjectId()
const bot = new ObjectId()
const projekt = String(new ObjectId())
const kontext = { menschId: anna, botId: bot }

beforeAll(async () => {
  datenbank = await testDatenbank()
})
afterAll(async () => await datenbank.schliessen())

beforeEach(async () => {
  await datenbank.leeren()
  recht = berechtigung()
  m = {
    PruefManager: { dokumente: vi.fn(async () => []), bericht: vi.fn() },
    QuellenManager: { alle: vi.fn(async () => []), suchen: vi.fn(), holen: vi.fn(), seite: vi.fn() },
    ZitatManager: { markieren: vi.fn() },
    SchreibManager: { docEdit: vi.fn(async () => ({ aenderung: true })), docCreate: vi.fn(async () => ({ aenderung: true })) },
    LaufManager: {
      letzterLauf: vi.fn(async () => ({ _id: 'l1', status: 'offen' })),
      offenerLauf: vi.fn(async () => ({ _id: 'l1' })),
      beenden: vi.fn(async () => {}),
      laufFuerClient: vi.fn(l => l && { id: l._id, status: l.status }),
    },
    LaufAktionen: { nachLaufende: vi.fn(async () => {}) },
    Inbox: { warteAufEreignis: vi.fn(), seit: vi.fn(), antwortSpeichern: vi.fn(async () => ({ _id: 'n1' })) },
    Crossref: { werk: vi.fn() },
  }
  vi.resetModules()
  vi.doMock('../../../../app/src/infrastructure/mongodb.mjs', () => datenbank.mongodbModul)
  recht.anmelden(vi)
  vi.doMock('../../app/src/pruefung/PruefManager.mjs', () => m.PruefManager)
  vi.doMock('../../app/src/QuellenManager.mjs', () => m.QuellenManager)
  vi.doMock('../../app/src/ZitatManager.mjs', () => m.ZitatManager)
  vi.doMock('../../app/src/schreiben/SchreibManager.mjs', () => m.SchreibManager)
  vi.doMock('../../app/src/schreiben/LaufManager.mjs', () => m.LaufManager)
  vi.doMock('../../app/src/schreiben/LaufAktionen.mjs', () => m.LaufAktionen)
  vi.doMock('../../app/src/Inbox.mjs', () => m.Inbox)
  vi.doMock('../../app/src/Crossref.mjs', () => m.Crossref)
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
    ['run_status', {}],
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

  it('sources_list zeigt Status ohne Text', async () => {
    m.QuellenManager.alle.mockResolvedValue([
      { _id: 'q1', dateiname: 'a.pdf', key: 'a', doi: '10.1/a', seitenzahl: 8, status: 'text', fassung: '', meta: { geheim: 1 } },
    ])
    expect(await aufruf('sources_list', { project_id: projekt })).toEqual({
      eintraege: [{ id: 'q1', dateiname: 'a.pdf', key: 'a', doi: '10.1/a', seiten: 8, status: 'text', fassung: '' }],
      naechster_cursor: null,
    })
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
      gekuerzt: true,
    })
    expect((await aufruf('source_read', { project_id: projekt, source_id: 'q1', pdf_seite: 3 })).gekuerzt).toBe(false)
  })

  it('check_report liefert Zeilen seitenweise samt Statistik', async () => {
    m.PruefManager.bericht.mockResolvedValue({ zeilen: Array.from({ length: 55 }, (_, i) => ({ i })), statistik: { geprueft: 1, wiederverwendet: 0 } })
    const ergebnis = await aufruf('check_report', { project_id: projekt })
    expect(ergebnis.eintraege).toHaveLength(50)
    expect(ergebnis).toMatchObject({ naechster_cursor: '50', statistik: { geprueft: 1, wiederverwendet: 0 } })
  })

  it('bib_list nennt den Crossref-Status je Eintrag', async () => {
    m.Crossref.werk.mockImplementation(async doi =>
      ({ '10.1/a': { gefunden: true, retraction: 'zurueckgezogen' }, '10.1/c': { gefunden: false }, '10.1/d': null })[doi]
    )
    const { eintraege } = await aufruf('bib_list', { project_id: projekt })
    expect(eintraege).toEqual([
      { key: 'a', doi: '10.1/a', referenz: 'gefunden', retraction: 'zurueckgezogen' },
      { key: 'b', doi: null, referenz: 'ohne_doi', retraction: null },
      { key: 'c', doi: '10.1/c', referenz: 'nicht_gefunden', retraction: null },
      { key: 'd', doi: '10.1/d', referenz: 'unbekannt', retraction: null },
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
      docId: undefined,
      pfad: 'a.tex',
      alt: 'x',
      neu: 'y',
      schluessel: 'schluessel-0001',
    })
  })

  it('doc_create reicht Pfad und Inhalt weiter', async () => {
    await aufruf('doc_create', { project_id: projekt, pfad: 'neu.tex', inhalt: 'Text', idempotenz_schluessel: 'schluessel-0001' })
    expect(m.SchreibManager.docCreate).toHaveBeenCalledWith({ projectId: new ObjectId(projekt), botId: bot, pfad: 'neu.tex', inhalt: 'Text', schluessel: 'schluessel-0001' })
  })

  it('reply speichert die Antwort für den Bot', async () => {
    expect(await aufruf('reply', { project_id: projekt, text: 'Erledigt' })).toEqual({ nachricht_id: 'n1' })
    expect(m.Inbox.antwortSpeichern).toHaveBeenCalledWith({ projectId: new ObjectId(projekt), botId: bot, text: 'Erledigt' })
  })

  it('run_status zeigt den letzten Lauf', async () => {
    expect(await aufruf('run_status', { project_id: projekt })).toEqual({ lauf: { id: 'l1', status: 'offen' } })
  })

  it('run_finish beendet den offenen Lauf und stößt die Automatik an', async () => {
    const ergebnis = await aufruf('run_finish', { project_id: projekt, zusammenfassung: 'Geglättet.' })
    expect(m.LaufManager.beenden).toHaveBeenCalledWith({ _id: 'l1' }, 'Geglättet.')
    expect(m.LaufAktionen.nachLaufende).toHaveBeenCalledWith(new ObjectId(projekt), { _id: 'l1' }, anna)
    expect(ergebnis).toEqual({ lauf: { id: 'l1', status: 'offen' } })
  })

  it('run_finish meldet kein_lauf, wenn keiner offen ist', async () => {
    m.LaufManager.offenerLauf.mockResolvedValue(null)
    expect(await fehlerVon(aufruf('run_finish', { project_id: projekt, zusammenfassung: 'x' }))).toMatchObject({ code: 'kein_lauf' })
    expect(m.LaufManager.beenden).not.toHaveBeenCalled()
  })
})

describe('Ereignisse', () => {
  it('wait_for_event liefert den Auftrag', async () => {
    m.Inbox.warteAufEreignis.mockResolvedValue({ id: 'e1', typ: 'task_created' })
    const ctx = { mcpReq: { signal: 'signal', _meta: {} } }
    expect(await aufruf('wait_for_event', { max_sekunden: 10 }, kontext, ctx)).toEqual({ ereignis: { id: 'e1', typ: 'task_created' } })
    expect(m.Inbox.warteAufEreignis).toHaveBeenCalledWith(bot, expect.objectContaining({ signal: 'signal', maxMs: 10000 }))
  })

  it('wait_for_event bittet ohne Auftrag um erneuten Aufruf, standardmäßig nach 30 Minuten', async () => {
    m.Inbox.warteAufEreignis.mockResolvedValue(null)
    const ergebnis = await aufruf('wait_for_event', {}, kontext, { mcpReq: { signal: null, _meta: {} } })
    expect(ergebnis).toEqual({ ereignis: null, hinweis: 'Kein Auftrag. Bitte erneut aufrufen.' })
    expect(m.Inbox.warteAufEreignis.mock.calls[0][1].maxMs).toBe(1800000)
  })

  it('wait_for_event meldet Fortschritt nur, wenn der Client ein Token mitgeschickt hat', async () => {
    const notify = vi.fn(async () => {})
    m.Inbox.warteAufEreignis.mockImplementation(async (_bot, { fortschritt }) => {
      await fortschritt(30)
      await fortschritt(60)
      return null
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
