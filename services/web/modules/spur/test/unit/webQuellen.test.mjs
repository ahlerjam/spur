import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Settings from '@overleaf/settings'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { ObjectId, schalterAttrappe, testDatenbank } from './hilfen/datenbank.mjs'
import { fehlerVon } from './hilfen/fehler.mjs'
import { crossrefAttrappe, fixture } from './hilfen/quellen.mjs'
import { meldung } from '../../app/src/meldungen.mjs'

let datenbank
let Quellen
let Zitate
let schalter
let server
let basis
let docs
let upsertDocWithPath
const wurzel = mkdtempSync(join(tmpdir(), 'spur-web-'))
const compilesVorher = Settings.path.compilesDir
const projekt = new ObjectId()
const anna = new ObjectId()
const HTML = readFileSync(fixture('testseite.html'), 'utf8')
const SATZ = 'Regular sleep times help shift workers recover.'

beforeAll(async () => {
  datenbank = await testDatenbank()
  server = createServer((req, res) => {
    if (!['/testseite', '/gleicher-titel'].includes(req.url)) {
      res.writeHead(404)
      return res.end()
    }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
    res.end(HTML)
  })
  await new Promise(r => server.listen(0, '127.0.0.1', r))
  basis = `http://127.0.0.1:${server.address().port}`
})
afterAll(async () => {
  server.close()
  await datenbank.schliessen()
  rmSync(wurzel, { recursive: true, force: true })
})
afterEach(() => {
  Settings.path.compilesDir = compilesVorher
})

beforeEach(async () => {
  await datenbank.leeren()
  Settings.path.compilesDir = join(wurzel, 'compiles')
  schalter = schalterAttrappe()
  // Im Dev-Stack liegt die Testseite im lokalen Netz; nur dort ist das erlaubt.
  schalter.modul.IST_DEV = true
  docs = [{ pfad: 'main.tex', docId: 'd1', text: '\\usepackage[backend=biber]{biblatex}' }]
  upsertDocWithPath = vi.fn(async () => {})
  vi.resetModules()
  vi.doMock('../../../../app/src/infrastructure/mongodb.mjs', () => datenbank.mongodbModul)
  vi.doMock('../../app/src/schalter.mjs', () => schalter.modul)
  vi.doMock('../../app/src/Crossref.mjs', () => crossrefAttrappe().modul)
  vi.doMock('../../app/src/live.mjs', () => ({ quelleGeaendert: () => {}, zitateGeaendert: () => {} }))
  vi.doMock('../../../../app/src/Features/Collaborators/CollaboratorsGetter.mjs', () => ({ default: { promises: { getInvitedMemberIds: async () => [] } } }))
  vi.doMock('../../app/src/pruefung/PruefManager.mjs', () => ({ dokumente: async () => docs }))
  vi.doMock('../../../../app/src/Features/Editor/EditorController.mjs', () => ({
    default: { promises: { upsertDocWithPath, appendToDoc: vi.fn() } },
  }))
  Quellen = await import('../../app/src/QuellenManager.mjs')
  Zitate = await import('../../app/src/ZitatManager.mjs')
})

const aufnehmen = url => Quellen.webAufnehmen({ projectId: projekt, userId: anna, url })

describe('webAufnehmen', () => {
  it('speichert Titel, Adresse, Abrufdatum aus jetzt(), Hash, Text und die HTML-Datei', async () => {
    const quelle = await aufnehmen(`${basis}/testseite`)
    expect(quelle).toMatchObject({
      art: 'web',
      status: 'text',
      seitenzahl: 1,
      key: 'schlafhygiene-im-schichtdienst',
      dateiname: 'schlafhygiene-im-schichtdienst.html',
      meta: { titel: 'Schlafhygiene im Schichtdienst' },
      web: { url: `${basis}/testseite`, abgerufenAm: schalter.zeit },
    })
    const seite = await Quellen.seite(quelle, 1)
    expect(seite.text).toContain(SATZ)
    expect(seite.text).not.toContain('alert(')
    expect(quelle.web.hash).toBe(createHash('sha256').update(seite.text).digest('hex'))
    expect(readFileSync(Quellen.dateiPfad(quelle), 'utf8')).toBe(HTML)
    expect((await Quellen.suchen(projekt, 'shift workers recover'))[0]).toMatchObject({ quelleId: quelle._id })
  })

  it('speichert nichts, wenn die Seite nicht erreichbar ist', async () => {
    for (const url of [`${basis}/weg`, 'http://nicht-erreichbar.invalid/']) {
      expect(await fehlerVon(aufnehmen(url))).toMatchObject({ status: 502, typ: 'seite_nicht_erreichbar' })
    }
    expect(await Quellen.alle(projekt)).toEqual([])
    expect(await datenbank.db.collection('spurSourcePages').countDocuments()).toBe(0)
  })

  it('meldet einen zweiten Schnappschuss derselben Seite als vorhanden', async () => {
    await aufnehmen(`${basis}/testseite`)
    const fehler = await fehlerVon(aufnehmen(`${basis}/testseite`))
    expect(fehler).toMatchObject({ status: 409, typ: 'quelle_vorhanden' })
    expect(fehler.message).toBe(meldung('spur_fehler_webseite_vorhanden', { name: 'Schlafhygiene im Schichtdienst' }))
  })

  it('zählt den Schlüssel hoch, wenn eine andere Seite gleich heißt', async () => {
    await aufnehmen(`${basis}/testseite`)
    const zweite = await aufnehmen(`${basis}/gleicher-titel`)
    expect(zweite).toMatchObject({ key: 'schlafhygiene-im-schichtdienst-2', dateiname: 'schlafhygiene-im-schichtdienst-2.html' })
  })

  it('sperrt das lokale Netz außerhalb der Dev-Umgebung', async () => {
    schalter.modul.IST_DEV = false
    vi.resetModules()
    vi.doMock('../../app/src/schalter.mjs', () => schalter.modul)
    Quellen = await import('../../app/src/QuellenManager.mjs')
    expect(await fehlerVon(aufnehmen(`${basis}/testseite`))).toMatchObject({ status: 422, typ: 'adresse_gesperrt' })
  })

  it('nimmt den Host als Namen, wenn die Seite keinen Titel hat', async () => {
    const ohne = createServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/html' })
      res.end('<p>Ohne Titel</p>')
    })
    await new Promise(r => ohne.listen(0, '127.0.0.1', r))
    try {
      const quelle = await aufnehmen(`http://127.0.0.1:${ohne.address().port}/a/b`)
      expect(quelle).toMatchObject({ key: '127-0-0-1-a-b', meta: { titel: null } })
    } finally {
      ohne.close()
    }
  })
})

describe('Zitat aus einem Schnappschuss einfügen', () => {
  it('zitiert ohne Seitenangabe und legt einen @online-Eintrag mit url und urldate an', async () => {
    const quelle = await aufnehmen(`${basis}/testseite`)
    const zitat = await Zitate.markieren(quelle, { seite: 1, text: SATZ }, anna)
    const { latex, key } = await Zitate.einfuegen(projekt, quelle, zitat, anna)
    expect(latex).toBe(`\\enquote{${SATZ}} \\autocite{${key}}`)
    expect(upsertDocWithPath.mock.calls[0][2].join('\n')).toBe(
      [
        '@online{schlafhygiene-im-schichtdienst,',
        '  title = {Schlafhygiene im Schichtdienst},',
        `  url = {${basis}/testseite},`,
        '  urldate = {2026-11-07}',
        '}',
      ].join('\n')
    )
    docs[0].text = '\\usepackage{natbib}'
    expect((await Zitate.einfuegen(projekt, quelle, zitat, anna)).latex).toBe(`\\enquote{${SATZ}} \\citep{${key}}`)
  })
})
