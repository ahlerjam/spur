import EditorController from '../../../../../app/src/Features/Editor/EditorController.mjs'
import ZoteroApiClient from '../../../../zotero/app/src/ZoteroApiClient.mjs'
import logger from '@overleaf/logger'
import { Problem } from '../probleme.mjs'
import * as PruefManager from '../pruefung/PruefManager.mjs'
import { bibLesen } from '../pruefung/bib.mjs'
import { paperApiBasis } from '../schalter.mjs'

const SAMMLUNG = /^[A-Za-z0-9]{8}$/

// Einträge eines BibTeX-Exports mit ihrem Text. Klammern werden gezählt, damit @ in Feldern nicht trennt.
export function bibBloecke(text) {
  const bloecke = []
  const start = /^@([a-zA-Z]+)\s*\{\s*([^,\s]+)\s*,/gm
  for (let m = start.exec(text); m; m = start.exec(text)) {
    if (/^(comment|string|preamble)$/i.test(m[1])) continue
    let tiefe = 0
    let ende = text.length
    for (let i = text.indexOf('{', m.index); i < text.length; i++) {
      if (text[i] === '{') tiefe++
      if (text[i] === '}' && --tiefe === 0) {
        ende = i + 1
        break
      }
    }
    const block = text.slice(m.index, ende)
    bloecke.push({ key: m[2], doi: bibLesen(block).get(m[2])?.doi?.toLowerCase() ?? null, text: block })
    start.lastIndex = ende
  }
  return bloecke
}

// Mit Paper-Fake liefert der Fake die Sammlungen; sonst das Konto aus modules/zotero.
async function fakeAbruf(pfad, text = false) {
  const antwort = await fetch(`${paperApiBasis()}/zotero${pfad}`, { signal: AbortSignal.timeout(15000) })
  if (!antwort.ok) throw new Error(`Zotero-Fake antwortet ${antwort.status}`)
  return text ? await antwort.text() : await antwort.json()
}

const zoteroFehler = error => {
  logger.warn({ err: error }, 'Zotero nicht erreichbar')
  return new Problem(502, 'zotero_nicht_erreichbar', 'spur_fehler_zotero_nicht_erreichbar')
}

export async function zoteroSammlungen(userId) {
  let sammlungen
  try {
    sammlungen = paperApiBasis()
      ? await fakeAbruf('/collections')
      : await ZoteroApiClient.getCollectionsForLibrary(userId, null)
  } catch (error) {
    throw zoteroFehler(error)
  }
  if (!sammlungen) {
    throw new Problem(409, 'zotero_fehlt', 'spur_fehler_zotero_fehlt')
  }
  return sammlungen.map(({ key, name }) => ({ key, name }))
}

export async function zoteroImportieren({ projectId, userId, sammlung }) {
  if (!SAMMLUNG.test(sammlung ?? '')) {
    throw new Problem(400, 'sammlung_ungueltig', 'spur_fehler_sammlung_ungueltig')
  }
  let bibtex
  try {
    bibtex = paperApiBasis()
      ? await fakeAbruf(`/collections/${sammlung}/bibtex`, true)
      : await ZoteroApiClient.getLibraryBibtex(userId, null, 'bibtex', sammlung)
  } catch (error) {
    throw zoteroFehler(error)
  }
  const docs = await PruefManager.dokumente(projectId)
  const bibDocs = docs.filter(d => d.pfad.endsWith('.bib'))
  const keys = new Set()
  const dois = new Set()
  for (const d of bibDocs) {
    for (const e of bibLesen(d.text).values()) {
      keys.add(e.key)
      if (e.doi) dois.add(e.doi.toLowerCase())
    }
  }
  const neu = []
  const vorhanden = []
  for (const block of bibBloecke(bibtex ?? '')) {
    if (keys.has(block.key) || (block.doi && dois.has(block.doi))) {
      vorhanden.push(block.key)
      continue
    }
    keys.add(block.key)
    if (block.doi) dois.add(block.doi)
    neu.push(block)
  }
  if (neu.length) {
    const zeilen = neu.flatMap(b => ['', ...b.text.split('\n')])
    if (bibDocs.length) {
      await EditorController.promises.appendToDoc(projectId, bibDocs[0].docId, zeilen, 'spur', userId)
    } else {
      await EditorController.promises.upsertDocWithPath(projectId, '/references.bib', zeilen.slice(1), 'spur', userId)
    }
  }
  return { neu: neu.map(b => b.key), vorhanden }
}
