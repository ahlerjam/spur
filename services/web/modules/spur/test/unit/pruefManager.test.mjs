import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Settings from '@overleaf/settings'
import { ObjectId, schalterAttrappe, testDatenbank } from './hilfen/datenbank.mjs'
import { crossrefAttrappe, fixture } from './hilfen/quellen.mjs'

let datenbank
let PruefManager
let Quellen
let schalter
let crossref
let flush
let projektDocs
let wurzelDoc
const wurzel = mkdtempSync(join(tmpdir(), 'spur-pruef-'))
const compilesVorher = Settings.path.compilesDir
const projekt = new ObjectId()

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

const doc = (text, id = new ObjectId()) => ({ _id: id, lines: text.split('\n') })

const SMITH_ZITAT = '\\enquote{Sleep supports the consolidation of declarative memory.} \\autocite[347]{smith2024}'

const MAIN = `\\section{Einleitung}
${SMITH_ZITAT}

\\section{Methode}
\\enquote{Das steht nirgends.} \\autocite[1]{smith2024}
`
const BIB = '@article{smith2024,\n  doi = {10.5555/spur.2024.001}\n}\n'

beforeEach(async () => {
  await datenbank.leeren()
  Settings.path.compilesDir = join(wurzel, 'compiles')
  schalter = schalterAttrappe()
  crossref = crossrefAttrappe()
  flush = vi.fn(async () => {})
  wurzelDoc = new ObjectId()
  projektDocs = { '/main.tex': doc(MAIN, wurzelDoc), '/references.bib': doc(BIB), '/anhang.txt': doc('kein tex \\enquote{x}') }
  vi.resetModules()
  vi.doMock('../../../../app/src/infrastructure/mongodb.mjs', () => datenbank.mongodbModul)
  vi.doMock('../../app/src/schalter.mjs', () => schalter.modul)
  vi.doMock('../../app/src/live.mjs', () => ({ quelleGeaendert: () => {}, zitateGeaendert: () => {} }))
  vi.doMock('../../app/src/Crossref.mjs', () => crossref.modul)
  vi.doMock('../../../../app/src/Features/DocumentUpdater/DocumentUpdaterHandler.mjs', () => ({
    default: { promises: { flushProjectToMongo: flush } },
  }))
  vi.doMock('../../../../app/src/Features/Project/ProjectGetter.mjs', () => ({
    default: { promises: { getProject: async () => ({ rootDoc_id: wurzelDoc }) } },
  }))
  vi.doMock('../../../../app/src/Features/Project/ProjectEntityHandler.mjs', () => ({
    default: { promises: { getAllDocs: async () => projektDocs } },
  }))
  Quellen = await import('../../app/src/QuellenManager.mjs')
  PruefManager = await import('../../app/src/pruefung/PruefManager.mjs')
  await Quellen.aufnehmen({ projectId: projekt, userId: new ObjectId(), dateiname: 'smith2024.pdf', tempPfad: fixture('smith2024.pdf'), groesse: 1 })
})

describe('abschnitte', () => {
  it('teilt vor jedem part, chapter und section, auch mit Stern', () => {
    const text = 'Vorwort\n\\chapter{A}\nx\n  \\section*{B}\ny\n\\subsection{bleibt}\n\\part[kurz]{C}'
    const teile = PruefManager.abschnitte(text)
    expect(teile.map(t => t.text.split('\n')[0].trim())).toEqual(['Vorwort', '\\chapter{A}', '\\section*{B}', '\\part[kurz]{C}'])
    expect(teile.map(t => t.von)).toEqual([0, 8, 22, text.indexOf('\\part')])
    expect(teile.map(t => t.text).join('')).toBe(text)
  })

  it('liefert einen Abschnitt, wenn der Text keine Gliederung hat', () => {
    expect(PruefManager.abschnitte('nur Text')).toEqual([{ von: 0, text: 'nur Text' }])
  })
})

describe('dokumente', () => {
  it('schreibt vorher die offenen Änderungen in die Datenbank und nennt das Hauptdokument zuerst', async () => {
    const docs = await PruefManager.dokumente(projekt)
    expect(flush).toHaveBeenCalledWith(projekt)
    expect(docs.map(d => d.pfad)).toEqual(['main.tex', 'anhang.txt', 'references.bib'])
    expect(docs[0]).toMatchObject({ docId: String(wurzelDoc), text: MAIN })
  })
})

describe('bericht', () => {
  it('bewertet jedes Zitat der .tex-Dateien mit Zeile, Position und Problemstatus', async () => {
    const { zeilen, statistik, stand } = await PruefManager.bericht(projekt)
    expect(zeilen).toHaveLength(2)
    expect(zeilen.every(z => z.pfad === 'main.tex' && z.docId === String(wurzelDoc))).toBe(true)
    expect(zeilen[0]).toMatchObject({
      key: 'smith2024',
      wortlaut: 'exakt',
      seite: 'stimmt',
      referenz: 'gefunden',
      zeile: 2,
      problem: false,
    })
    expect(MAIN.slice(zeilen[0].von, zeilen[0].bis)).toContain('Sleep supports')
    expect(MAIN.slice(zeilen[1].zitatVon, zeilen[1].zitatBis)).toContain('Das steht nirgends.')
    expect(zeilen[1]).toMatchObject({ wortlaut: 'abweichend', zeile: 5, problem: true })
    expect(zeilen[0].id).toMatch(/^[0-9a-f]{12}$/)
    expect(zeilen[0].id).not.toBe(zeilen[1].id)
    expect(statistik).toEqual({ geprueft: 2, wiederverwendet: 0 })
    expect(stand).toEqual(schalter.zeit)
  })

  it('verwendet geprüfte Abschnitte wieder und prüft nur geänderte neu', async () => {
    await PruefManager.bericht(projekt)
    expect((await PruefManager.bericht(projekt)).statistik).toEqual({ geprueft: 0, wiederverwendet: 2 })
    projektDocs['/main.tex'] = doc(MAIN.replace('Das steht nirgends.', 'Auch nicht.'), wurzelDoc)
    expect((await PruefManager.bericht(projekt)).statistik).toEqual({ geprueft: 1, wiederverwendet: 1 })
  })

  it('prüft alles neu, wenn sich Quellen oder der Tag ändern', async () => {
    await PruefManager.bericht(projekt)
    const quelle = (await Quellen.alle(projekt))[0]
    await Quellen.aendern(quelle, { versatz: 100 })
    expect((await PruefManager.bericht(projekt)).statistik.geprueft).toBe(2)
    schalter.zeit = new Date('2026-11-08T10:00:00Z')
    expect((await PruefManager.bericht(projekt)).statistik.geprueft).toBe(2)
  })

  it('zeigt Zitate ohne Quelle als quelle_fehlt und fragt Crossref nur einmal je DOI', async () => {
    projektDocs['/main.tex'] = doc('\\enquote{X.} \\autocite{unbekannt}\n\\enquote{Y.} \\autocite{unbekannt2}', wurzelDoc)
    projektDocs['/zwei.bib'] = doc(BIB.replace('smith2024', 'weiteres'))
    crossref.abfragen.length = 0
    const { zeilen } = await PruefManager.bericht(projekt)
    expect(zeilen.map(z => z.wortlaut)).toEqual(['quelle_fehlt', 'quelle_fehlt'])
    expect(crossref.abfragen).toEqual(['10.5555/spur.2024.001'])
  })

  it('liefert keine Zeilen für ein Projekt ohne Zitate', async () => {
    projektDocs = { '/main.tex': doc('Nur Text.', wurzelDoc) }
    expect((await PruefManager.bericht(projekt)).zeilen).toEqual([])
  })
})

describe('bereichPruefen', () => {
  it('bewertet nur Zitate, die den Bereich berühren', async () => {
    const text = `${SMITH_ZITAT}\n\n\\enquote{Das steht nirgends.} \\autocite[1]{smith2024}`
    const zweites = text.indexOf('\\enquote{Das')
    const nurErstes = await PruefManager.bereichPruefen(projekt, text, 0, 10)
    expect(nurErstes.map(z => z.wortlaut)).toEqual(['exakt'])
    const nurZweites = await PruefManager.bereichPruefen(projekt, text, zweites, zweites + 5)
    expect(nurZweites.map(z => z.wortlaut)).toEqual(['abweichend'])
    expect(await PruefManager.bereichPruefen(projekt, text, text.indexOf('\n\n') + 1, text.indexOf('\n\n') + 1)).toEqual([])
  })
})

describe('bericht mit OCR-Quelle', () => {
  it('meldet „OCR, nicht bestätigt“ und nach der Bestätigung eines Zitats „bestätigt“, ohne alten Cache', async () => {
    const [smith] = await Quellen.alle(projekt)
    await datenbank.db.collection('spurSources').updateOne({ _id: smith._id }, { $set: { status: 'ocr' } })
    expect((await PruefManager.bericht(projekt)).zeilen[0].wortlaut).toBe('ocr_unbestaetigt')
    await datenbank.db.collection('spurQuotes').insertOne({
      projectId: projekt,
      quelleId: smith._id,
      seite: 3,
      text: 'Sleep supports the consolidation of declarative memory.',
      bestaetigt: { von: new ObjectId(), am: schalter.zeit },
    })
    await datenbank.db.collection('spurQuotes').insertOne({ projectId: new ObjectId(), quelleId: smith._id, text: 'fremd', bestaetigt: { am: schalter.zeit } })
    const { zeilen, statistik } = await PruefManager.bericht(projekt)
    expect(zeilen[0]).toMatchObject({ wortlaut: 'bestaetigt', problem: false })
    expect(statistik.geprueft).toBe(2)
  })
})
