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
  vi.resetModules()
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
    expect(danach.angenommen).toEqual([{ docId: doc, op: { p: 8, i: 'neu' }, ...kontextUm('Alt und neu.', { p: 8, i: 'neu' }) }])
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

  it('nimmt bei eingeschalteter Automatik ohne rote Status alles an', async () => {
    await LaufAktionen.automatikSetzen(projekt, anna, true)
    const l = await lauf()
    await LaufAktionen.nachLaufende(projekt, l, anna)
    expect((await gespeichert(l)).status).toBe('angenommen')
  })

  it('tut nichts bei ausgeschalteter Automatik', async () => {
    const l = await lauf()
    await LaufAktionen.nachLaufende(projekt, l, anna)
    expect(acceptChanges).not.toHaveBeenCalled()
  })

  it('übernimmt nie Läufe mit roten Status', async () => {
    await LaufAktionen.automatikSetzen(projekt, anna, true)
    await LaufAktionen.nachLaufende(projekt, await lauf({ rot: [{ grund: 'nicht_pruefbar' }] }), anna)
    expect(acceptChanges).not.toHaveBeenCalled()
  })

  it('übernimmt nichts mehr, wenn der Mensch inzwischen nur noch lesen oder prüfen darf', async () => {
    await LaufAktionen.automatikSetzen(projekt, anna, true)
    for (const stufe of ['readOnly', 'review']) {
      recht.vergeben(anna, projekt, { stufe })
      await LaufAktionen.nachLaufende(projekt, await lauf(), anna)
    }
    expect(acceptChanges).not.toHaveBeenCalled()
  })
})
