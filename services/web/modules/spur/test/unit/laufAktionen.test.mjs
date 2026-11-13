import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { kontextUm } from '../../app/src/schreiben/ops.mjs'
import { berechtigung } from './hilfen/berechtigung.mjs'
import { ObjectId, testDatenbank } from './hilfen/datenbank.mjs'
import { fehlerVon } from './hilfen/fehler.mjs'
import { meldung } from '../../app/src/meldungen.mjs'

let datenbank
let LaufAktionen
let recht
let dokumente
let geloeschteDocs
let spurUpdate
let acceptChanges
let emitToRoom
let geloeschtePfade
let paketEntfernt
let quelleGeloescht
const projekt = new ObjectId()
const bot = new ObjectId()
const anna = new ObjectId()
const doc = new ObjectId()
const START = new Date('2026-11-07T10:00:00Z')
const ENDE = new Date('2026-11-07T10:30:00Z')
const IN_LAUF = '2026-11-07T10:10:00.000Z'

beforeAll(async () => {
  datenbank = await testDatenbank()
})
afterAll(async () => await datenbank.schliessen())

beforeEach(async () => {
  await datenbank.leeren()
  recht = berechtigung()
  dokumente = new Map()
  geloeschteDocs = new Set()
  spurUpdate = vi.fn(async () => {})
  acceptChanges = vi.fn(async () => {})
  emitToRoom = vi.fn()
  geloeschtePfade = []
  paketEntfernt = vi.fn(async () => {})
  vi.resetModules()
  vi.doMock('../../../../app/src/Features/Editor/EditorController.mjs', () => ({
    default: { promises: { deleteEntityWithPath: async (_p, pfad) => geloeschtePfade.push(pfad) } },
  }))
  vi.doMock('../../app/src/kompilieren/TexPakete.mjs', () => ({ paketEntfernt }))
  quelleGeloescht = vi.fn(async () => {})
  vi.doMock('../../app/src/QuellenManager.mjs', () => ({ loeschen: quelleGeloescht }))
  vi.doMock('../../../../app/src/infrastructure/mongodb.mjs', () => datenbank.mongodbModul)
  recht.anmelden(vi)
  vi.doMock('../../../../app/src/Features/Editor/EditorRealTimeController.mjs', () => ({ default: { emitToRoom } }))
  vi.doMock('../../../../app/src/Features/DocumentUpdater/DocumentUpdaterHandler.mjs', () => ({
    default: {
      promises: {
        getDocument: async (_projekt, docId) => dokumente.get(String(docId)),
        acceptChanges,
      },
    },
  }))
  vi.doMock('../../../../app/src/Features/Project/ProjectLocator.mjs', () => ({
    default: {
      promises: {
        findElement: async ({ element_id: id }) => {
          if (geloeschteDocs.has(String(id))) {
            const { default: Errors } = await import('../../../../app/src/Features/Errors/Errors.js')
            throw new Errors.NotFoundError('weg')
          }
          return { path: { fileSystem: '/kapitel.tex' } }
        },
      },
    },
  }))
  vi.doMock('../../app/src/schreiben/spurUpdate.mjs', () => ({ spurUpdate }))
  vi.doMock('../../app/src/schreiben/LaufManager.mjs', () => ({
    laufFuerClient: lauf => lauf && { id: lauf._id, status: lauf.status },
  }))
  LaufAktionen = await import('../../app/src/schreiben/LaufAktionen.mjs')
})

function docSetzen(text, changes = [], version = 7) {
  dokumente.set(String(doc), { lines: text.split('\n'), version, ranges: { changes } })
}

const change = (id, op, ts = IN_LAUF, user = String(bot)) => ({ id, op, metadata: { user_id: user, ts } })

async function lauf(felder = {}) {
  const eintrag = {
    projectId: projekt,
    botId: bot,
    status: 'fertig',
    gestartet: START,
    beendet: ENDE,
    docs: [doc],
    aenderungen: 1,
    rot: [],
    angenommen: [],
    ...felder,
  }
  const { insertedId } = await datenbank.db.collection('spurRuns').insertOne(eintrag)
  return { ...eintrag, _id: insertedId }
}

const gespeichert = async l => await datenbank.db.collection('spurRuns').findOne({ _id: l._id })

describe('aenderungen', () => {
  it('nimmt nur Changes des Bots innerhalb der Laufzeit', async () => {
    docSetzen('Text', [
      change('a', { p: 0, i: 'x' }),
      change('fremd', { p: 0, i: 'x' }, IN_LAUF, String(anna)),
      change('zufrueh', { p: 0, i: 'x' }, '2026-11-07T09:59:59Z'),
      change('zuspaet', { p: 0, i: 'x' }, '2026-11-07T10:30:01Z'),
    ])
    const [ergebnis] = await LaufAktionen.aenderungen(projekt, await lauf())
    expect(ergebnis.changes.map(c => c.id)).toEqual(['a'])
  })

  it('zählt bei einem offenen Lauf alles ab dem Start', async () => {
    docSetzen('Text', [change('spaet', { p: 0, i: 'x' }, '2030-01-01T00:00:00Z')])
    const [ergebnis] = await LaufAktionen.aenderungen(projekt, await lauf({ status: 'offen', beendet: undefined }))
    expect(ergebnis.changes).toHaveLength(1)
  })

  it('meldet gelöschte Dokumente, statt zu scheitern', async () => {
    geloeschteDocs.add(String(doc))
    expect(await LaufAktionen.aenderungen(projekt, await lauf())).toEqual([
      { docId: doc, pfad: null, geloescht: true, changes: [], text: '' },
    ])
  })

  it('reicht unerwartete Fehler der Pfadsuche weiter', async () => {
    vi.resetModules()
    vi.doMock('../../../../app/src/Features/Project/ProjectLocator.mjs', () => ({
      default: { promises: { findElement: async () => Promise.reject(new Error('Mongo weg')) } },
    }))
    const neu = await import('../../app/src/schreiben/LaufAktionen.mjs')
    expect((await fehlerVon(neu.aenderungen(projekt, await lauf()))).message).toBe('Mongo weg')
  })
})

describe('fuerKarte und laufDaten', () => {
  it('beschreibt Einfügungen und Löschungen mit Zeile und gekürztem Text', async () => {
    docSetzen('Zeile eins\nZeile zwei', [change('e', { p: 11, i: 'x'.repeat(300) }), change('l', { p: 0, d: 'Zeile' })])
    const karte = LaufAktionen.fuerKarte(await LaufAktionen.aenderungen(projekt, await lauf()))
    expect(karte).toEqual([
      { id: 'e', docId: doc, pfad: 'kapitel.tex', art: 'einfuegung', text: 'x'.repeat(200), zeile: 2 },
      { id: 'l', docId: doc, pfad: 'kapitel.tex', art: 'loeschung', text: 'Zeile', zeile: 1 },
    ])
  })

  it('fuerKarte vermerkt gelöschte Dokumente', () => {
    expect(LaufAktionen.fuerKarte([{ docId: doc, geloescht: true, changes: [] }])).toEqual([{ docId: doc, geloescht: true }])
  })

  it('laufDaten ist ohne Lauf leer und lädt bei abgeschlossenen Läufen keine Changes', async () => {
    expect(await LaufAktionen.laufDaten(projekt, null)).toEqual({ lauf: null, aenderungen: [] })
    const fertig = await lauf({ status: 'angenommen' })
    expect(await LaufAktionen.laufDaten(projekt, fertig)).toEqual({ lauf: { id: fertig._id, status: 'angenommen' }, aenderungen: [] })
  })

  it('laufDaten zeigt bei offenen und fertigen Läufen die Changes', async () => {
    docSetzen('Text', [change('a', { p: 0, i: 'neu' })])
    const daten = await LaufAktionen.laufDaten(projekt, await lauf())
    expect(daten.aenderungen).toHaveLength(1)
  })
})

describe('laufHolen', () => {
  it('findet den Lauf im Projekt, optional nur für einen Bot', async () => {
    const l = await lauf()
    expect((await LaufAktionen.laufHolen(projekt, String(l._id)))._id).toEqual(l._id)
    expect((await LaufAktionen.laufHolen(projekt, String(l._id), bot))._id).toEqual(l._id)
  })

  it.each([
    ['ungültige ID', () => ['kaputt', undefined]],
    ['unbekannte ID', () => [String(new ObjectId()), undefined]],
    ['anderer Bot', l => [String(l._id), new ObjectId()]],
    ['anderes Projekt', l => [String(l._id), undefined, new ObjectId()]],
  ])('meldet 404 bei %s', async (_name, argumente) => {
    const l = await lauf()
    const [id, nurBot, anderesProjekt] = argumente(l)
    const fehler = await fehlerVon(LaufAktionen.laufHolen(anderesProjekt ?? projekt, id, nurBot))
    expect(fehler).toMatchObject({ status: 404, typ: 'lauf_fehlt' })
  })
})

describe('annehmen', () => {
  it('übernimmt alle Changes, meldet das offenen Editoren und merkt Kontext für die Rücknahme', async () => {
    docSetzen('Alt und neu.', [change('a', { p: 8, i: 'neu' })])
    const l = await lauf()
    expect(await LaufAktionen.annehmen(projekt, l, anna)).toEqual({ angenommen: 1, rest: 0 })
    expect(acceptChanges).toHaveBeenCalledWith(projekt, doc, ['a'], anna)
    expect(emitToRoom).toHaveBeenCalledWith(projekt, 'accept-changes', doc, ['a'])
    const danach = await gespeichert(l)
    expect(danach.status).toBe('angenommen')
    expect(danach.angenommen).toEqual([
      { docId: doc, op: { p: 8, i: 'neu' }, ...kontextUm('Alt und neu.', { p: 8, i: 'neu' }), stapel: expect.any(String) },
    ])
  })

  it('nimmt auf Wunsch nur gewählte Changes an und lässt den Lauf offen für den Rest', async () => {
    docSetzen('abc', [change('a', { p: 0, i: 'x' }, '2026-11-07T10:01:00Z'), change('b', { p: 1, i: 'y' }, '2026-11-07T10:02:00Z')])
    const l = await lauf()
    expect(await LaufAktionen.annehmen(projekt, l, anna, ['a'])).toEqual({ angenommen: 1, rest: 1 })
    expect((await gespeichert(l)).status).toBe('fertig')
  })

  it('nimmt einen gespaltenen Einschub immer ganz an', async () => {
    docSetzen('abc', [change('a', { p: 0, i: 'x' }), change('a2', { p: 3, i: 'y' }), change('b', { p: 1, i: 'z' }, '2026-11-07T10:20:00Z')])
    const l = await lauf()
    expect(await LaufAktionen.annehmen(projekt, l, anna, ['a'])).toEqual({ angenommen: 2, rest: 1 })
    expect(acceptChanges).toHaveBeenCalledWith(projekt, doc, ['a', 'a2'], anna)
  })

  it('macht ohne Changes nichts am Dokument', async () => {
    docSetzen('abc')
    expect(await LaufAktionen.annehmen(projekt, await lauf(), anna)).toEqual({ angenommen: 0, rest: 0 })
    expect(acceptChanges).not.toHaveBeenCalled()
  })

  it.each(['abgelehnt', 'angenommen', 'zurueckgenommen'])('weist einen Lauf im Status %s mit 409 ab', async status => {
    const fehler = await fehlerVon(LaufAktionen.annehmen(projekt, await lauf({ status }), anna))
    expect(fehler).toMatchObject({ status: 409, typ: 'lauf_abgeschlossen' })
    expect(acceptChanges).not.toHaveBeenCalled()
  })
})

describe('ablehnen', () => {
  it('macht alle Changes rückgängig, von hinten nach vorn und ohne Tracking', async () => {
    docSetzen('Alt und neu.', [change('a', { p: 0, d: 'Alt' }), change('b', { p: 8, i: 'neu' })])
    const l = await lauf()
    expect(await LaufAktionen.ablehnen(projekt, l, anna)).toEqual({ abgelehnt: 2, rest: 0 })
    expect(spurUpdate).toHaveBeenCalledWith(
      projekt,
      doc,
      [{ p: 8, d: 'neu', u: true }, { p: 0, i: 'Alt', u: true }],
      7,
      { userId: anna }
    )
    expect((await gespeichert(l)).status).toBe('abgelehnt')
  })

  it('lehnt auf Wunsch einzelne Changes ab und behält den Status', async () => {
    docSetzen('ab', [change('a', { p: 0, i: 'x' }, '2026-11-07T10:01:00Z'), change('b', { p: 1, i: 'y' }, '2026-11-07T10:02:00Z')])
    const l = await lauf()
    expect(await LaufAktionen.ablehnen(projekt, l, anna, ['b'])).toEqual({ abgelehnt: 1, rest: 1 })
    expect(spurUpdate.mock.calls[0][2]).toEqual([{ p: 1, d: 'y', u: true }])
    expect((await gespeichert(l)).status).toBe('fertig')
  })

  it('lehnt einen gespaltenen Einschub ganz ab', async () => {
    docSetzen('abc', [change('a', { p: 0, i: 'x' }), change('a2', { p: 2, i: 'y' })])
    expect(await LaufAktionen.ablehnen(projekt, await lauf(), anna, ['a2'])).toEqual({ abgelehnt: 2, rest: 0 })
  })

  it('weist abgeschlossene Läufe ab', async () => {
    const fehler = await fehlerVon(LaufAktionen.ablehnen(projekt, await lauf({ status: 'angenommen' }), anna))
    expect(fehler).toMatchObject({ status: 409, typ: 'lauf_abgeschlossen' })
  })
})

describe('zuruecknehmen', () => {
  const danach = 'Erster Satz.\nDritter Satz.'
  const geloescht = { p: 13, d: 'Zweiter Satz.\n' }
  const angenommen = [{ docId: doc, op: geloescht, ...kontextUm(danach, geloescht) }]

  it('setzt eine gelöschte Zeile nach einer Handänderung weiter oben an die richtige Stelle zurück', async () => {
    docSetzen('Ganz neuer Anfang. Erster Satz.\nDritter Satz.')
    const l = await lauf({ status: 'angenommen', angenommen })
    await LaufAktionen.zuruecknehmen(projekt, l, anna)
    expect(spurUpdate).toHaveBeenCalledTimes(1)
    expect(spurUpdate).toHaveBeenCalledWith(projekt, doc, [{ p: 32, i: 'Zweiter Satz.\n' }], 7, { userId: anna, tracked: true })
    expect((await gespeichert(l)).status).toBe('zurueckgenommen')
  })

  it('setzt ohne Handänderung an die alte Stelle zurück', async () => {
    docSetzen(danach)
    await LaufAktionen.zuruecknehmen(projekt, await lauf({ status: 'angenommen', angenommen }), anna)
    expect(spurUpdate.mock.calls[0][2]).toEqual([{ p: 13, i: 'Zweiter Satz.\n' }])
  })

  it('meldet einen Konflikt mit der Zeile der alten Stelle, wenn der Text um die Stelle geändert wurde, und ändert nichts', async () => {
    docSetzen('Erster Satz, geändert.\nDritter Satz.')
    const l = await lauf({ status: 'angenommen', angenommen })
    const fehler = await fehlerVon(LaufAktionen.zuruecknehmen(projekt, l, anna))
    expect(fehler).toMatchObject({ status: 409, typ: 'konflikt' })
    expect(fehler.message).toBe(meldung('spur_fehler_rueckname_konflikt', { zeile: 1 }))
    expect(spurUpdate).not.toHaveBeenCalled()
    expect((await gespeichert(l)).status).toBe('angenommen')
  })

  it('meldet einen Konflikt für Einträge ohne gespeicherten Kontext', async () => {
    docSetzen(danach)
    const alt = [{ docId: doc, op: geloescht }]
    const fehler = await fehlerVon(LaufAktionen.zuruecknehmen(projekt, await lauf({ status: 'angenommen', angenommen: alt }), anna))
    expect(fehler).toMatchObject({ status: 409, typ: 'konflikt' })
    expect(spurUpdate).not.toHaveBeenCalled()
  })

  it('ändert bei einem Konflikt in einem Dokument auch die anderen nicht', async () => {
    const zweites = new ObjectId()
    docSetzen(danach)
    dokumente.set(String(zweites), { lines: ['ganz anders'], version: 1, ranges: { changes: [] } })
    const l = await lauf({
      status: 'angenommen',
      angenommen: [...angenommen, { docId: zweites, op: { p: 3, i: 'x' }, vor: 'abc', nach: 'def' }],
    })
    expect((await fehlerVon(LaufAktionen.zuruecknehmen(projekt, l, anna))).typ).toBe('konflikt')
    expect(spurUpdate).not.toHaveBeenCalled()
  })

  it('macht Einschübe als Löschung rückgängig', async () => {
    docSetzen('Alt und neu.')
    const op = { p: 8, i: 'neu' }
    await LaufAktionen.zuruecknehmen(projekt, await lauf({ status: 'angenommen', angenommen: [{ docId: doc, op, ...kontextUm('Alt und neu.', op) }] }), anna)
    expect(spurUpdate.mock.calls[0][2]).toEqual([{ p: 8, d: 'neu' }])
  })

  it('entfernt bei einem fertigen Lauf angelegte Dateien und Ordner und lehnt seine Changes ab', async () => {
    recht.vergeben(anna, projekt, { stufe: 'owner' })
    docSetzen('Alt und neu.', [change('c1', { p: 8, i: 'neu' })])
    const l = await lauf({
      angelegt: [
        { art: 'ordner', pfad: 'tex-pakete/foo', paket: 'foo', bytes: 5 },
        { art: 'datei', pfad: 'latexmkrc' },
      ],
    })
    await LaufAktionen.zuruecknehmen(projekt, l, anna)
    expect(geloeschtePfade).toEqual(['/tex-pakete/foo', '/latexmkrc'])
    expect(paketEntfernt).toHaveBeenCalledWith(projekt, 'foo')
    expect(spurUpdate).toHaveBeenCalledTimes(1)
    expect(await gespeichert(l)).toMatchObject({ status: 'zurueckgenommen', angelegt: [] })
  })

  it('übergeht schon gelöschte Dateien', async () => {
    recht.vergeben(anna, projekt, { stufe: 'owner' })
    vi.resetModules()
    vi.doMock('../../../../app/src/Features/Editor/EditorController.mjs', async () => {
      const { default: Errors } = await import('../../../../app/src/Features/Errors/Errors.js')
      return { default: { promises: { deleteEntityWithPath: async () => { throw new Errors.NotFoundError('weg') } } } }
    })
    LaufAktionen = await import('../../app/src/schreiben/LaufAktionen.mjs')
    const l = await lauf({ docs: [], angelegt: [{ art: 'datei', pfad: 'latexmkrc' }] })
    await LaufAktionen.zuruecknehmen(projekt, l, anna)
    expect((await gespeichert(l)).status).toBe('zurueckgenommen')
  })

  it('entfernt hochgeladene Quellen des Laufs', async () => {
    recht.vergeben(anna, projekt, { stufe: 'owner' })
    const quelleId = new ObjectId()
    await datenbank.db.collection('spurSources').insertOne({ _id: quelleId, projectId: projekt, key: 'smith2024' })
    const l = await lauf({ docs: [], angelegt: [{ art: 'quelle', quelleId, name: 'smith2024.pdf' }] })
    await LaufAktionen.zuruecknehmen(projekt, l, anna)
    expect(quelleGeloescht).toHaveBeenCalledWith(expect.objectContaining({ _id: quelleId }))
    expect(geloeschtePfade).toEqual([])
  })

  it('Ganzen Lauf ablehnen entfernt auch Angelegtes', async () => {
    recht.vergeben(anna, projekt, { stufe: 'readAndWrite' })
    docSetzen('Alt und neu.', [change('c1', { p: 8, i: 'neu' })])
    const l = await lauf({ angelegt: [{ art: 'datei', pfad: 'latexmkrc' }] })
    await LaufAktionen.ablehnen(projekt, l, anna)
    expect(geloeschtePfade).toEqual(['/latexmkrc'])
    expect((await gespeichert(l)).angelegt).toEqual([])
  })

  it('ein Reviewer lehnt nur die Changes ab, Dateien und Quellen bleiben', async () => {
    recht.vergeben(anna, projekt, { stufe: 'review' })
    docSetzen('Alt und neu.', [change('c1', { p: 8, i: 'neu' })])
    const l = await lauf({ angelegt: [{ art: 'datei', pfad: 'latexmkrc' }] })
    await LaufAktionen.ablehnen(projekt, l, anna)
    expect(geloeschtePfade).toEqual([])
    expect(spurUpdate).toHaveBeenCalledTimes(1)
  })

  it('lässt nur angenommene Läufe zurücknehmen', async () => {
    const fehler = await fehlerVon(LaufAktionen.zuruecknehmen(projekt, await lauf({ status: 'fertig' }), anna))
    expect(fehler).toMatchObject({ status: 409, typ: 'nicht_angenommen' })
  })
})

describe('Automatik am Laufende', () => {
  beforeEach(() => {
    docSetzen('Text mit neu.', [change('a', { p: 9, i: 'neu' })])
    recht.vergeben(anna, projekt, { stufe: 'readAndWrite' })
  })

  it('speichert die Einstellung je Projekt und Mensch', async () => {
    expect(await LaufAktionen.automatik(projekt, anna)).toBe(false)
    await LaufAktionen.automatikSetzen(projekt, anna, true)
    expect(await LaufAktionen.automatik(projekt, anna)).toBe(true)
    expect(await LaufAktionen.automatik(projekt, new ObjectId())).toBe(false)
    await LaufAktionen.automatikSetzen(projekt, anna, false)
    expect(await LaufAktionen.automatik(projekt, anna)).toBe(false)
  })

  it('nimmt am Laufende nichts nachträglich an, auch bei eingeschaltetem Schalter', async () => {
    await LaufAktionen.automatikSetzen(projekt, anna, true)
    const l = await lauf()
    await LaufAktionen.nachLaufende(projekt, l)
    expect(acceptChanges).not.toHaveBeenCalled()
    expect((await gespeichert(l)).status).toBe('fertig')
  })

  it('schließt einen Lauf als angenommen, wenn der Schalter alles angenommen hat', async () => {
    docSetzen('Text mit neu.', [])
    const l = await lauf({ angenommen: [{ automatisch: true, docId: doc, op: { p: 9, i: 'neu' } }] })
    await LaufAktionen.nachLaufende(projekt, l)
    expect((await gespeichert(l)).status).toBe('angenommen')
  })
})

describe('Sofort annehmen (Schalter „Alles von Claude automatisch annehmen“)', () => {
  beforeEach(() => {
    docSetzen('Text mit neu.', [change('a', { p: 9, i: 'neu' })])
    recht.vergeben(anna, projekt, { stufe: 'readAndWrite' })
  })

  it('nimmt die neuen Changes sofort an, vermerkt sie als automatisch und lässt den Lauf offen', async () => {
    await LaufAktionen.automatikSetzen(projekt, anna, true)
    const l = await lauf({ status: 'offen', beendet: undefined })
    await LaufAktionen.sofortAnnehmen(projekt, l, anna, ['a'])
    expect(acceptChanges).toHaveBeenCalledWith(projekt, doc, ['a'], anna)
    const danach = await gespeichert(l)
    expect(danach.status).toBe('offen')
    expect(danach.angenommen).toEqual([
      expect.objectContaining({ docId: doc, op: { p: 9, i: 'neu' }, automatisch: true, pfad: 'kapitel.tex', zeile: 1 }),
    ])
  })

  it('tut nichts bei ausgeschaltetem Schalter oder ohne Schreibrecht', async () => {
    const l = await lauf({ status: 'offen', beendet: undefined })
    await LaufAktionen.sofortAnnehmen(projekt, l, anna, ['a'])
    await LaufAktionen.automatikSetzen(projekt, anna, true)
    for (const stufe of ['readOnly', 'review']) {
      recht.vergeben(anna, projekt, { stufe })
      await LaufAktionen.sofortAnnehmen(projekt, l, anna, ['a'])
    }
    expect(acceptChanges).not.toHaveBeenCalled()
  })

  it('„Lauf rückgängig“ entfernt auch sofort angenommene Changes eines offenen Laufs und lehnt den Rest ab', async () => {
    await LaufAktionen.automatikSetzen(projekt, anna, true)
    const l = await lauf({ status: 'offen', beendet: undefined })
    await LaufAktionen.sofortAnnehmen(projekt, l, anna, ['a'])
    docSetzen('Text mit neu. rot', [change('r', { p: 14, i: 'rot' })])
    await LaufAktionen.zuruecknehmen(projekt, await gespeichert(l), anna)
    expect(spurUpdate).toHaveBeenCalledWith(projekt, doc, [expect.objectContaining({ p: 14, d: 'rot' })], 7, { userId: anna })
    expect(spurUpdate).toHaveBeenCalledWith(projekt, doc, [{ p: 9, d: 'neu' }], 7, { userId: anna, tracked: true })
    expect((await gespeichert(l)).status).toBe('zurueckgenommen')
  })
})

describe('Lauf rückgängig nach Schalter und Sammelannahme', () => {
  // document-updater wendet die Ops nacheinander an; das Dokument im Test folgt ihnen.
  function opsAnwenden() {
    spurUpdate.mockImplementation(async (_p, docId, ops) => {
      const d = dokumente.get(String(docId))
      let text = d.lines.join('\n')
      for (const op of ops) {
        text = op.i !== undefined ? text.slice(0, op.p) + op.i + text.slice(op.p) : text.slice(0, op.p) + text.slice(op.p + op.d.length)
      }
      const offen = d.ranges.changes.filter(c => !ops.some(o => o.u && o.p === c.op.p))
      dokumente.set(String(docId), { ...d, lines: text.split('\n'), ranges: { changes: offen } })
    })
  }

  it('nimmt nacheinander Angenommenes zurück, auch wenn spätere Änderungen den Kontext verändert haben', async () => {
    recht.vergeben(anna, projekt, { stufe: 'readAndWrite' })
    await LaufAktionen.automatikSetzen(projekt, anna, true)
    opsAnwenden()
    const l = await lauf({ status: 'offen', beendet: undefined })
    // Erst „ A“ hinter „Eins.“, dann „ B“ hinter „Zwei.“ (im Kontext von A), dann ein offener roter Einschub.
    docSetzen('Eins. A Zwei.', [change('a', { p: 5, i: ' A' })])
    await LaufAktionen.sofortAnnehmen(projekt, l, anna, ['a'])
    docSetzen('Eins. A Zwei. B', [change('b', { p: 13, i: ' B' })])
    await LaufAktionen.sofortAnnehmen(projekt, await gespeichert(l), anna, ['b'])
    docSetzen('Eins. A Zwei. B rot', [change('r', { p: 15, i: ' rot' })])
    await LaufAktionen.zuruecknehmen(projekt, await gespeichert(l), anna)
    expect(dokumente.get(String(doc)).lines.join('\n')).toBe('Eins. Zwei.')
    expect((await gespeichert(l)).status).toBe('zurueckgenommen')
  })

  it('findet die Stelle mit kürzerem Kontext, wenn ein offener Change im gespeicherten Kontext stand', async () => {
    recht.vergeben(anna, projekt, { stufe: 'readAndWrite' })
    opsAnwenden()
    const l = await lauf({ status: 'offen', beendet: undefined })
    // Beim Annehmen von „ B“ stand der offene rote Einschub „ rot“ eine Zeile weiter im Kontext.
    const text = 'Eins. Zwei. B\n\nDrei Satz. rot'
    const rot = change('r', { p: 25, i: ' rot' }, '2026-11-07T10:02:00Z')
    docSetzen(text, [change('b', { p: 11, i: ' B' }, '2026-11-07T10:01:00Z'), rot])
    await LaufAktionen.annehmen(projekt, l, anna, ['b'], { laufOffenLassen: true })
    docSetzen(text, [rot])
    await LaufAktionen.zuruecknehmen(projekt, await gespeichert(l), anna)
    expect(dokumente.get(String(doc)).lines.join('\n')).toBe('Eins. Zwei.\n\nDrei Satz.')
  })

  it('ändert bei einem Konflikt nichts, auch die offenen Changes bleiben', async () => {
    recht.vergeben(anna, projekt, { stufe: 'readAndWrite' })
    await LaufAktionen.automatikSetzen(projekt, anna, true)
    const l = await lauf({ status: 'offen', beendet: undefined })
    docSetzen('Eins. A Zwei.', [change('a', { p: 5, i: ' A' })])
    await LaufAktionen.sofortAnnehmen(projekt, l, anna, ['a'])
    docSetzen('Ganz anders. rot', [change('r', { p: 12, i: ' rot' })])
    expect(await fehlerVon(LaufAktionen.zuruecknehmen(projekt, await gespeichert(l), anna))).toMatchObject({ status: 409 })
    expect(spurUpdate).not.toHaveBeenCalled()
    expect((await gespeichert(l)).status).toBe('offen')
  })
})

describe('Alles Offene jetzt annehmen', () => {
  const SPAETER = '2026-11-07T11:10:00.000Z'
  beforeEach(() => {
    recht.vergeben(anna, projekt, { stufe: 'readAndWrite' })
    docSetzen('a b c rot', [
      change('a', { p: 0, i: 'a' }),
      change('b', { p: 2, i: 'b' }, SPAETER),
      change('r', { p: 6, i: 'rot' }, '2026-11-07T11:20:00.000Z'),
      change('fremd', { p: 4, i: 'c' }, SPAETER, String(new ObjectId())),
    ])
  })

  async function zweiLaeufe() {
    const fertig = await lauf()
    const offen = await lauf({ status: 'offen', gestartet: new Date('2026-11-07T11:00:00Z'), beendet: undefined, rotAenderungen: ['r'] })
    return { fertig, offen }
  }

  it('zählt offene Changes des eigenen Bots über alle Läufe ohne rote', async () => {
    await zweiLaeufe()
    expect(await LaufAktionen.offenZaehlen(projekt, bot)).toEqual({ aenderungen: 2, dateien: 1 })
  })

  it('nimmt alles außer roten Zitaten an; ein offener Lauf bleibt offen', async () => {
    const { fertig, offen } = await zweiLaeufe()
    expect(await LaufAktionen.allesAnnehmen(projekt, bot, anna)).toEqual({ angenommen: 2 })
    expect(acceptChanges).toHaveBeenCalledWith(projekt, doc, ['a'], anna)
    expect(acceptChanges).toHaveBeenCalledWith(projekt, doc, ['b'], anna)
    expect(acceptChanges).not.toHaveBeenCalledWith(projekt, doc, expect.arrayContaining(['r']), anna)
    expect((await gespeichert(fertig)).status).toBe('angenommen')
    expect((await gespeichert(offen)).status).toBe('offen')
  })

  it('lässt auch Stücke eines geteilten roten Einschubs offen (gleiche Zeit, neue ID)', async () => {
    await zweiLaeufe()
    await datenbank.db.collection('spurRuns').updateMany({ status: 'offen' }, { $set: { rotZeiten: ['2026-11-07T11:20:00.000Z'] } })
    docSetzen('a b c rot', [change('b', { p: 2, i: 'b' }, SPAETER), change('r-stueck', { p: 6, i: 'ro' }, '2026-11-07T11:20:00.000Z')])
    expect(await LaufAktionen.offenZaehlen(projekt, bot)).toEqual({ aenderungen: 1, dateien: 1 })
  })

  it('verlangt Schreibrecht', async () => {
    await zweiLaeufe()
    recht.vergeben(anna, projekt, { stufe: 'review' })
    expect(await fehlerVon(LaufAktionen.allesAnnehmen(projekt, bot, anna))).toMatchObject({ status: 403 })
    expect(acceptChanges).not.toHaveBeenCalled()
  })
})

