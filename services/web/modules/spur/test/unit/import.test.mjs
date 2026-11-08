import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ObjectId } from './hilfen/datenbank.mjs'
import { fehlerVon } from './hilfen/fehler.mjs'

let Import
let m
let docs

const projectId = new ObjectId()
const userId = new ObjectId()

const ZOTERO = `@article{diekelmann_memory_2010,
  title = {The memory function of sleep},
  doi = {10.1038/nrn2762}
}

@book{born_schlaf_2020,
  title = {Schlaf, {Gedächtnis} und @-Zeichen},
  year = {2020}
}
`

beforeEach(async () => {
  docs = [{ docId: 'd1', pfad: 'references.bib', text: '@article{smith2024,\n  doi = {10.1038/NRN2762}\n}\n' }]
  m = {
    EditorController: {
      promises: { appendToDoc: vi.fn(async () => {}), upsertDocWithPath: vi.fn(async () => {}) },
    },
    PruefManager: { dokumente: vi.fn(async () => docs) },
    ZoteroApiClient: {
      getCollectionsForLibrary: vi.fn(async () => [{ key: 'ABCD2345', name: 'Schlaf' }]),
      getLibraryBibtex: vi.fn(async () => ZOTERO),
    },
    schalter: { paperApiBasis: () => undefined },
  }
  vi.resetModules()
  vi.doMock('../../../../app/src/Features/Editor/EditorController.mjs', () => ({ default: m.EditorController }))
  vi.doMock('../../app/src/pruefung/PruefManager.mjs', () => m.PruefManager)
  vi.doMock('../../../zotero/app/src/ZoteroApiClient.mjs', () => ({ default: m.ZoteroApiClient }))
  vi.doMock('../../app/src/schalter.mjs', () => m.schalter)
  Import = await import('../../app/src/recherche/Import.mjs')
})

describe('bibBloecke', () => {
  it('trennt einen BibTeX-Export in Einträge mit Key und DOI, auch mit @ in Feldern', () => {
    expect(Import.bibBloecke(ZOTERO).map(b => [b.key, b.doi])).toEqual([
      ['diekelmann_memory_2010', '10.1038/nrn2762'],
      ['born_schlaf_2020', null],
    ])
    expect(Import.bibBloecke(ZOTERO)[1].text).toBe(
      '@book{born_schlaf_2020,\n  title = {Schlaf, {Gedächtnis} und @-Zeichen},\n  year = {2020}\n}'
    )
  })
})

describe('zoteroImportieren', () => {
  it('hängt neue Einträge mit ihren Zotero-Keys an und überspringt DOIs, die schon in der .bib stehen', async () => {
    const ergebnis = await Import.zoteroImportieren({ projectId, userId, sammlung: 'ABCD2345' })
    expect(m.ZoteroApiClient.getLibraryBibtex).toHaveBeenCalledWith(userId, null, 'bibtex', 'ABCD2345')
    expect(ergebnis).toEqual({ neu: ['born_schlaf_2020'], vorhanden: ['diekelmann_memory_2010'] })
    const [, docId, zeilen] = m.EditorController.promises.appendToDoc.mock.calls[0]
    expect(docId).toBe('d1')
    expect(zeilen.join('\n')).toContain('@book{born_schlaf_2020,')
    expect(zeilen.join('\n')).not.toContain('diekelmann')
  })

  it('legt ohne .bib eine references.bib an', async () => {
    docs = [{ docId: 'm', pfad: 'main.tex', text: '' }]
    const ergebnis = await Import.zoteroImportieren({ projectId, userId, sammlung: 'ABCD2345' })
    expect(ergebnis.neu).toEqual(['diekelmann_memory_2010', 'born_schlaf_2020'])
    expect(m.EditorController.promises.upsertDocWithPath).toHaveBeenCalledWith(
      projectId,
      '/references.bib',
      expect.any(Array),
      'spur',
      userId
    )
  })

  it('erzeugt beim zweiten Import keine Dubletten', async () => {
    docs[0].text += `\n${ZOTERO}`
    const ergebnis = await Import.zoteroImportieren({ projectId, userId, sammlung: 'ABCD2345' })
    expect(ergebnis).toEqual({ neu: [], vorhanden: ['diekelmann_memory_2010', 'born_schlaf_2020'] })
    expect(m.EditorController.promises.appendToDoc).not.toHaveBeenCalled()
  })

  it('meldet ein nicht verbundenes Zotero-Konto', async () => {
    m.ZoteroApiClient.getCollectionsForLibrary.mockResolvedValue(null)
    expect(await fehlerVon(Import.zoteroSammlungen(userId))).toMatchObject({ status: 409, typ: 'zotero_fehlt' })
  })

  it('lehnt ungültige Sammlungs-Keys ab', async () => {
    expect(await fehlerVon(Import.zoteroImportieren({ projectId, userId, sammlung: '../x' }))).toMatchObject({ status: 400 })
  })
})
