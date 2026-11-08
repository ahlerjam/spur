import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Settings from '@overleaf/settings'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { ObjectId, schalterAttrappe, testDatenbank } from './hilfen/datenbank.mjs'
import { fehlerVon } from './hilfen/fehler.mjs'
import { crossrefAttrappe, fixture } from './hilfen/quellen.mjs'

let datenbank
let Zitate
let Team
let quelle
let gesendet
const wurzel = mkdtempSync(join(tmpdir(), 'spur-team-'))
const compilesVorher = Settings.path.compilesDir
const projekt = new ObjectId()
const anna = new ObjectId()
const ben = new ObjectId()
const fremd = new ObjectId()

beforeAll(async () => {
  datenbank = await testDatenbank()
})
afterAll(async () => {
  await datenbank.schliessen()
  rmSync(wurzel, { recursive: true, force: true })
})
afterEach(() => {
  Settings.path.compilesDir = compilesVorher
})

beforeEach(async () => {
  await datenbank.leeren()
  Settings.path.compilesDir = join(wurzel, 'compiles')
  await datenbank.db.collection('users').insertMany([
    { _id: anna, email: 'anna@example.org', first_name: 'Anna', last_name: 'Autor' },
    { _id: ben, email: 'ben@example.org', first_name: '', last_name: '' },
    { _id: fremd, email: 'fremd@example.org' },
  ])
  gesendet = []
  vi.resetModules()
  vi.doMock('../../../../app/src/infrastructure/mongodb.mjs', () => datenbank.mongodbModul)
  vi.doMock('../../app/src/schalter.mjs', () => schalterAttrappe().modul)
  vi.doMock('../../app/src/Crossref.mjs', () => crossrefAttrappe().modul)
  vi.doMock('../../../../app/src/Features/Editor/EditorRealTimeController.mjs', () => ({
    default: { emitToRoom: (...args) => gesendet.push(args) },
  }))
  vi.doMock('../../../../app/src/Features/Collaborators/CollaboratorsGetter.mjs', () => ({
    default: { promises: { getInvitedMemberIds: async () => [String(anna), String(ben)] } },
  }))
  vi.doMock('../../app/src/pruefung/PruefManager.mjs', () => ({ dokumente: async () => [] }))
  vi.doMock('../../../../app/src/Features/Editor/EditorController.mjs', () => ({ default: { promises: {} } }))
  const Quellen = await import('../../app/src/QuellenManager.mjs')
  Zitate = await import('../../app/src/ZitatManager.mjs')
  Team = await import('../../app/src/Team.mjs')
  quelle = await Quellen.aufnehmen({ projectId: projekt, userId: anna, dateiname: 'smith2024.pdf', tempPfad: fixture('smith2024.pdf'), groesse: 1 })
})

const MARKE = { seite: 3, text: 'Sleep supports the consolidation of declarative memory.' }

describe('Team', () => {
  it('nennt Mitglieder mit Vor- und Nachnamen, sonst mit E-Mail', async () => {
    expect(await Team.mitglieder(projekt)).toEqual([
      { id: String(anna), name: 'Anna Autor' },
      { id: String(ben), name: 'ben@example.org' },
    ])
  })

  it('löst Namen für beliebige IDs auf, gelöschte Konten als „Gelöschtes Konto“', async () => {
    const namen = await Team.namen([anna, ben, new ObjectId()])
    expect(namen.get(String(anna))).toBe('Anna Autor')
    expect(namen.get(String(ben))).toBe('ben@example.org')
    expect(Team.nameAus(namen, new ObjectId())).toBe('Gelöschtes Konto')
  })
})

describe('Live-Meldung', () => {
  it('meldet ein neues Zitat an alle im Projekt, nur mit der Quellen-ID', async () => {
    await Zitate.markieren(quelle, MARKE, anna)
    expect(gesendet).toEqual([[String(projekt), 'spur:zitate', { quelleId: String(quelle._id) }]])
  })
})

describe('kommentieren und zuweisen', () => {
  it('hängt den Kommentar mit Person und Zeit an und weist das Zitat zu', async () => {
    const zitat = await Zitate.markieren(quelle, MARKE, anna)
    gesendet.length = 0
    const neu = await Zitate.kommentieren(quelle, String(zitat._id), { text: '  Bitte prüfen ', zuweisen: String(anna) }, ben)
    expect(neu.kommentare).toEqual([
      { _id: expect.any(ObjectId), von: ben, text: 'Bitte prüfen', am: new Date('2026-11-07T10:00:00Z') },
    ])
    expect(neu.zugewiesen).toEqual({ an: anna, von: ben, am: new Date('2026-11-07T10:00:00Z') })
    // Die Meldung nennt die Person, damit nur ihr Hinweis nachlädt.
    expect(gesendet).toEqual([[String(projekt), 'spur:zitate', { quelleId: String(quelle._id), an: String(anna) }]])
    const gespeichert = await Zitate.holen(quelle, String(zitat._id))
    expect(gespeichert.kommentare).toHaveLength(1)
  })

  it('ändert die Zuweisung nicht, wenn keine angegeben ist', async () => {
    const zitat = await Zitate.markieren(quelle, MARKE, anna)
    await Zitate.kommentieren(quelle, String(zitat._id), { text: 'Eins', zuweisen: String(anna) }, ben)
    const neu = await Zitate.kommentieren(quelle, String(zitat._id), { text: 'Zwei' }, anna)
    expect(neu.kommentare.map(k => k.text)).toEqual(['Eins', 'Zwei'])
    expect(neu.zugewiesen.an).toEqual(anna)
  })

  it.each([
    ['leer', ''],
    ['zu lang', 'x'.repeat(2001)],
  ])('lehnt einen Kommentar ab, der %s ist', async (_name, text) => {
    const zitat = await Zitate.markieren(quelle, MARKE, anna)
    expect(await fehlerVon(Zitate.kommentieren(quelle, String(zitat._id), { text }, ben))).toMatchObject({ status: 422, typ: 'kommentar_text' })
  })

  it('weist nur Mitgliedern des Projekts zu', async () => {
    const zitat = await Zitate.markieren(quelle, MARKE, anna)
    for (const zuweisen of [String(fremd), 'quatsch', 7]) {
      expect(await fehlerVon(Zitate.kommentieren(quelle, String(zitat._id), { text: 'x', zuweisen }, ben))).toMatchObject({ status: 422, typ: 'zuweisung' })
    }
  })

  it('meldet 404 für ein unbekanntes Zitat', async () => {
    expect(await fehlerVon(Zitate.kommentieren(quelle, String(new ObjectId()), { text: 'x' }, ben))).toMatchObject({ status: 404, typ: 'zitat_fehlt' })
  })

  it('zuweisungLoesen nimmt die Zuweisung weg und meldet es', async () => {
    const zitat = await Zitate.markieren(quelle, MARKE, anna)
    await Zitate.kommentieren(quelle, String(zitat._id), { text: 'x', zuweisen: String(anna) }, ben)
    gesendet.length = 0
    await Zitate.zuweisungLoesen(quelle, String(zitat._id))
    expect((await Zitate.holen(quelle, String(zitat._id))).zugewiesen).toBeNull()
    expect(gesendet[0][2]).toEqual({ quelleId: String(quelle._id), an: String(anna) })
  })
})

describe('zugewiesenAn', () => {
  it('liefert die Zitate, die einer Person zugewiesen sind, mit Quelle', async () => {
    const eins = await Zitate.markieren(quelle, MARKE, anna)
    await Zitate.markieren(quelle, { seite: 1, text: 'Sleep and Memory' }, anna)
    await Zitate.kommentieren(quelle, String(eins._id), { text: 'Bitte prüfen', zuweisen: String(anna) }, ben)
    const liste = await Zitate.zugewiesenAn(projekt, anna)
    expect(liste).toHaveLength(1)
    expect(liste[0]).toMatchObject({ _id: eins._id, quelleId: quelle._id, text: MARKE.text })
    expect(await Zitate.zugewiesenAn(projekt, ben)).toEqual([])
    expect(await Zitate.zugewiesenAn(new ObjectId(), anna)).toEqual([])
  })
})

describe('bestaetigen', () => {
  it('hält fest, wer die Stelle bestätigt hat, und meldet es', async () => {
    const zitat = await Zitate.markieren(quelle, MARKE, anna)
    gesendet.length = 0
    const neu = await Zitate.bestaetigen(quelle, String(zitat._id), ben)
    expect(neu.bestaetigt).toEqual({ von: ben, am: new Date('2026-11-07T10:00:00Z') })
    expect((await Zitate.holen(quelle, String(zitat._id))).bestaetigt.von).toEqual(ben)
    expect(gesendet).toHaveLength(1)
  })
})
