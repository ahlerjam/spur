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
let Quellen
let docs
let appendToDoc
let upsertDocWithPath
let quelle
const wurzel = mkdtempSync(join(tmpdir(), 'spur-zitate-'))
const compilesVorher = Settings.path.compilesDir
const projekt = new ObjectId()
const anna = new ObjectId()

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
  docs = [{ pfad: 'main.tex', docId: 'd1', text: '\\documentclass{article}\\usepackage[backend=biber]{biblatex}' }]
  appendToDoc = vi.fn(async () => {})
  upsertDocWithPath = vi.fn(async () => {})
  vi.resetModules()
  vi.doMock('../../../../app/src/infrastructure/mongodb.mjs', () => datenbank.mongodbModul)
  vi.doMock('../../app/src/schalter.mjs', () => schalterAttrappe().modul)
  vi.doMock('../../app/src/Crossref.mjs', () => crossrefAttrappe().modul)
  vi.doMock('../../../../app/src/Features/Editor/EditorController.mjs', () => ({
    default: { promises: { appendToDoc, upsertDocWithPath } },
  }))
  vi.doMock('../../app/src/pruefung/PruefManager.mjs', () => ({ dokumente: async () => docs }))
  Quellen = await import('../../app/src/QuellenManager.mjs')
  Zitate = await import('../../app/src/ZitatManager.mjs')
  quelle = await Quellen.aufnehmen({ projectId: projekt, userId: anna, dateiname: 'smith2024.pdf', tempPfad: fixture('smith2024.pdf'), groesse: 1 })
})

const MARKE = { seite: 3, text: 'Sleep supports the consolidation of declarative memory.' }

describe('markieren', () => {
  it('speichert die Fundstelle mit Seite, gedruckter Seitenzahl und Person', async () => {
    const zitat = await Zitate.markieren(quelle, MARKE, anna)
    expect(zitat).toMatchObject({ projectId: projekt, quelleId: quelle._id, seite: 3, label: '347', text: MARKE.text, angelegtVon: anna })
    expect(await Zitate.liste(quelle)).toHaveLength(1)
  })

  it('vereinheitlicht Leerraum, wie er beim Markieren im Viewer entsteht', async () => {
    const zitat = await Zitate.markieren(quelle, { seite: 3, text: '  Sleep supports\n the   consolidation ' }, anna)
    expect(zitat.text).toBe('Sleep supports the consolidation')
  })

  it.each([
    ['leer', ''],
    ['nur Leerraum', '   '],
    ['zu lang', 'a'.repeat(2001)],
  ])('lehnt einen Text ab, der %s ist', async (_name, text) => {
    expect(await fehlerVon(Zitate.markieren(quelle, { seite: 3, text }, anna))).toMatchObject({ status: 422, typ: 'zitat_text' })
  })

  it('lehnt Text ab, der nicht auf der Seite steht', async () => {
    const fehler = await fehlerVon(Zitate.markieren(quelle, { seite: 1, text: MARKE.text }, anna))
    expect(fehler).toMatchObject({ status: 422, typ: 'zitat_nicht_in_quelle' })
  })

  it('meldet 404 für eine Seite, die es nicht gibt', async () => {
    expect(await fehlerVon(Zitate.markieren(quelle, { seite: 40, text: 'x' }, anna))).toMatchObject({ typ: 'seite_fehlt' })
  })
})

describe('liste und holen', () => {
  it('liste sortiert nach Seite und liefert nur Zitate der Quelle', async () => {
    await Zitate.markieren(quelle, { seite: 3, text: 'Sleep supports' }, anna)
    await Zitate.markieren(quelle, { seite: 1, text: 'Sleep and Memory' }, anna)
    await datenbank.db.collection('spurQuotes').insertOne({ quelleId: new ObjectId(), seite: 1 })
    expect((await Zitate.liste(quelle)).map(z => z.seite)).toEqual([1, 3])
  })

  it('holen findet ein Zitat der Quelle, sonst 404', async () => {
    const zitat = await Zitate.markieren(quelle, MARKE, anna)
    expect((await Zitate.holen(quelle, String(zitat._id)))._id).toEqual(zitat._id)
    for (const id of ['quatsch', String(new ObjectId())]) {
      expect(await fehlerVon(Zitate.holen(quelle, id))).toMatchObject({ status: 404, typ: 'zitat_fehlt' })
    }
    const andere = { ...quelle, _id: new ObjectId() }
    expect(await fehlerVon(Zitate.holen(andere, String(zitat._id)))).toMatchObject({ typ: 'zitat_fehlt' })
  })
})

describe('einfuegen', () => {
  async function zitat(text = MARKE.text) {
    return await Zitate.markieren(quelle, { seite: 3, text }, anna)
  }

  it('liefert biblatex-Befehl mit gedruckter Seite und legt references.bib an, wenn es keine .bib gibt', async () => {
    const ergebnis = await Zitate.einfuegen(projekt, quelle, await zitat(), anna)
    expect(ergebnis).toEqual({
      latex: `\\enquote{${MARKE.text}} \\autocite[347]{smith2024}`,
      key: 'smith2024',
      paket: 'biblatex',
    })
    expect(upsertDocWithPath).toHaveBeenCalledTimes(1)
    const [id, pfad, zeilen, quellenart, nutzer] = upsertDocWithPath.mock.calls[0]
    expect([id, pfad, quellenart, nutzer]).toEqual([projekt, '/references.bib', 'spur', anna])
    expect(zeilen.join('\n')).toBe(
      [
        '@article{smith2024,',
        '  author = {Smith, Alice},',
        '  title = {Sleep and Memory},',
        '  journal = {Journal of Sleep Research},',
        '  year = {2024},',
        '  pages = {345--352},',
        '  doi = {10.5555/spur.2024.001}',
        '}',
      ].join('\n')
    )
  })

  it('nimmt natbib, wenn das Projekt natbib nutzt', async () => {
    docs[0].text = '\\usepackage{natbib}'
    const ergebnis = await Zitate.einfuegen(projekt, quelle, await zitat(), anna)
    expect(ergebnis.latex).toBe(`\\enquote{${MARKE.text}} \\citep[S.~347]{smith2024}`)
    expect(ergebnis.paket).toBe('natbib')
  })

  it('hängt den Eintrag an eine vorhandene .bib an', async () => {
    docs.push({ pfad: 'lit.bib', docId: 'd2', text: '@book{anderes, title={X}}' })
    await Zitate.einfuegen(projekt, quelle, await zitat(), anna)
    expect(appendToDoc).toHaveBeenCalledTimes(1)
    expect(appendToDoc.mock.calls[0].slice(0, 2)).toEqual([projekt, 'd2'])
    expect(appendToDoc.mock.calls[0][2][0]).toBe('')
    expect(upsertDocWithPath).not.toHaveBeenCalled()
  })

  it('verwendet einen vorhandenen Eintrag mit gleichem Schlüssel oder gleicher DOI, ohne die .bib zu ändern', async () => {
    docs.push({ pfad: 'lit.bib', docId: 'd2', text: '@article{smith2024, title={X}}' })
    expect((await Zitate.einfuegen(projekt, quelle, await zitat(), anna)).key).toBe('smith2024')
    docs[1].text = '@article{eigenerKey, doi = {https://doi.org/10.5555/SPUR.2024.001}}'
    const ergebnis = await Zitate.einfuegen(projekt, quelle, await zitat(), anna)
    expect(ergebnis.key).toBe('eigenerKey')
    expect(ergebnis.latex).toContain('{eigenerKey}')
    expect(appendToDoc).not.toHaveBeenCalled()
    expect(upsertDocWithPath).not.toHaveBeenCalled()
  })

  it('maskiert LaTeX-Zeichen im zitierten Text', async () => {
    const roh = await Zitate.markieren(quelle, { seite: 3, text: 'Sleep supports' }, anna)
    await datenbank.db.collection('spurQuotes').updateOne({ _id: roh._id }, { $set: { text: '50% von R&D_1 {x} ~ ^ \\ #' } })
    const ergebnis = await Zitate.einfuegen(projekt, quelle, await Zitate.holen(quelle, String(roh._id)), anna)
    expect(ergebnis.latex).toContain(
      '\\enquote{50\\% von R\\&D\\_1 \\{x\\} \\textasciitilde{} \\textasciicircum{} \\textbackslash{} \\#}'
    )
  })

  it('maskiert fremde Metadaten im neuen .bib-Eintrag', async () => {
    const eigene = { ...quelle, doi: null, meta: { gefunden: true, titel: 'A & B {C}', autoren: [{ family: 'Müller_X', given: '' }], jahr: 2020, journal: null, seiten: null } }
    await Zitate.einfuegen(projekt, eigene, await zitat(), anna)
    const eintrag = upsertDocWithPath.mock.calls[0][2].join('\n')
    expect(eintrag).toContain('author = {Müller\\_X}')
    expect(eintrag).toContain('title = {A \\& B \\{C\\}}')
    expect(eintrag).not.toContain('doi')
  })

  it('nimmt den Dateinamen als Titel, wenn Crossref nichts kennt', async () => {
    const ohne = { ...quelle, meta: null, doi: null }
    await Zitate.einfuegen(projekt, ohne, await zitat(), anna)
    expect(upsertDocWithPath.mock.calls[0][2].join('\n')).toBe('@article{smith2024,\n  title = {smith2024.pdf}\n}')
  })

  it('nimmt die PDF-Seite, wenn es keine gedruckte Seitenzahl gibt, und die aktuelle, wenn sie sich geändert hat', async () => {
    const z = await zitat()
    await Quellen.aendern(quelle, { versatz: null })
    expect((await Zitate.einfuegen(projekt, quelle, z, anna)).latex).toContain('\\autocite[3]{smith2024}')
    await Quellen.aendern(quelle, { versatz: 10 })
    expect((await Zitate.einfuegen(projekt, quelle, z, anna)).latex).toContain('\\autocite[13]{smith2024}')
  })
})
