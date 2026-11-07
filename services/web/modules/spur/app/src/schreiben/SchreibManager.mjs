import Settings from '@overleaf/settings'
import { fetchJson, RequestFailedError } from '@overleaf/fetch-utils'
import DocumentUpdaterHandler from '../../../../../app/src/Features/DocumentUpdater/DocumentUpdaterHandler.mjs'
import ProjectEntityUpdateHandler from '../../../../../app/src/Features/Project/ProjectEntityUpdateHandler.mjs'
import ProjectLocator from '../../../../../app/src/Features/Project/ProjectLocator.mjs'
import { WerkzeugFehler } from '../mcp/fehler.mjs'
import { bereichPruefen } from '../pruefung/PruefManager.mjs'
import { bearbeitungen } from '../sammlungen.mjs'
import { jetzt } from '../schalter.mjs'
import * as LaufManager from './LaufManager.mjs'
import { opsFuer } from './ops.mjs'

// document-updater trennt Clients ab 2000 offenen Changes; wir halten Abstand.
const GRENZE_CHANGES = 1990

async function docAufloesen(projectId, docId, pfad) {
  try {
    if (docId) {
      const { element, path } = await ProjectLocator.promises.findElement({
        project_id: projectId,
        element_id: docId,
        type: 'doc',
      })
      return { docId: String(element._id), pfad: path.fileSystem.replace(/^\//, '') }
    }
    const { element } = await ProjectLocator.promises.findElementByPath({
      project_id: projectId,
      path: pfad,
      exactCaseMatch: true,
    })
    if (element?._id) return { docId: String(element._id), pfad }
  } catch {}
  throw new WerkzeugFehler('doc_fehlt', 'Das Dokument gibt es nicht (mehr). Bitte doc_list aufrufen.')
}

function vorkommen(text, teil) {
  const treffer = []
  for (let i = text.indexOf(teil); i >= 0; i = text.indexOf(teil, i + 1)) treffer.push(i)
  return treffer
}

async function pruefSperre(projectId, neuerText, von, bis) {
  const zeilen = await bereichPruefen(projectId, neuerText, von, bis)
  const rot = []
  for (const z of zeilen) {
    if (z.wortlaut === 'abweichend') {
      throw new WerkzeugFehler(
        'zitat_abweichend',
        `Der Wortlaut von „${z.auszug}“ steht nicht in der Quelle ${z.key}. Bitte mit source_search prüfen.`
      )
    }
    if (z.wortlaut === 'quelle_fehlt') {
      throw new WerkzeugFehler(
        'quelle_fehlt',
        `Zu ${z.key} gibt es keine Quelle mit Text. Bitte nur aus vorhandenen Quellen zitieren.`
      )
    }
    if (z.form === 'unbekannt') rot.push({ grund: 'nicht_pruefbar', auszug: z.auszug })
  }
  return rot
}

async function anwenden(projectId, docId, op, version, botId, seed) {
  try {
    return await fetchJson(
      `${Settings.apis.documentupdater.url}/project/${projectId}/doc/${docId}/spur-update`,
      {
        method: 'POST',
        json: { op, v: version, meta: { user_id: String(botId), tc: seed, source: 'spur' } },
      }
    )
  } catch (error) {
    if (error instanceof RequestFailedError && error.response.status === 409) {
      throw new WerkzeugFehler('konflikt', 'Das Dokument hat sich geändert. Bitte neu lesen.')
    }
    if (error instanceof RequestFailedError && error.response.status === 404) {
      throw new WerkzeugFehler('doc_fehlt', 'Das Dokument gibt es nicht (mehr).')
    }
    throw error
  }
}

export async function docEdit({ projectId, botId, docId, pfad, alt, neu, schluessel }) {
  const sammlung = await bearbeitungen()
  const frueher = await sammlung.findOne({ botId, schluessel })
  if (frueher) return { ...frueher.ergebnis, wiederholt: true }

  const doc = await docAufloesen(projectId, docId, pfad)
  const { lines, version, ranges } = await DocumentUpdaterHandler.promises.getDocument(
    projectId,
    doc.docId,
    -1
  )
  if ((ranges?.changes?.length ?? 0) >= GRENZE_CHANGES) {
    throw new WerkzeugFehler(
      'grenze_changes',
      'Das Dokument hat fast 2000 offene Änderungen. Bitte erst annehmen oder ablehnen lassen.'
    )
  }
  const text = lines.join('\n')
  let start = text.length
  if (alt) {
    const treffer = vorkommen(text, alt)
    if (treffer.length !== 1) {
      throw new WerkzeugFehler(
        'konflikt',
        treffer.length
          ? 'Der erwartete Alttext kommt mehrfach vor. Bitte mehr Kontext angeben.'
          : 'Der erwartete Alttext steht nicht im Dokument. Bitte neu lesen.'
      )
    }
    start = treffer[0]
  }
  const neuerText = text.slice(0, start) + neu + text.slice(start + alt.length)
  const rot = await pruefSperre(projectId, neuerText, start, start + neu.length)

  const op = opsFuer(start, alt, neu)
  const lauf = await LaufManager.laufFuerSchreiben(projectId, botId)
  const seed = LaufManager.neuerSeed()
  let ergebnis = { doc_id: doc.docId, version, lauf_id: lauf._id, aenderung: false, rot }
  if (op.length) {
    const antwort = await anwenden(projectId, doc.docId, op, version, botId, seed)
    await LaufManager.aenderungMerken(lauf, { docId: doc.docId, rot })
    ergebnis = { ...ergebnis, version: antwort.version, aenderung: true }
  }
  await sammlung.insertOne({ botId, schluessel, ergebnis, am: jetzt() })
  return ergebnis
}

export async function docCreate({ projectId, botId, pfad, inhalt, schluessel }) {
  const { doc } = await ProjectEntityUpdateHandler.promises.upsertDocWithPath(
    projectId,
    `/${pfad.replace(/^\//, '')}`,
    [''],
    'spur',
    botId
  )
  return await docEdit({
    projectId,
    botId,
    docId: String(doc._id),
    alt: '',
    neu: inhalt,
    schluessel,
  })
}
