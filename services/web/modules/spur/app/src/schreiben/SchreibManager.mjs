import DocumentUpdaterHandler from '../../../../../app/src/Features/DocumentUpdater/DocumentUpdaterHandler.mjs'
import EditorController from '../../../../../app/src/Features/Editor/EditorController.mjs'
import Errors from '../../../../../app/src/Features/Errors/Errors.js'
import ProjectLocator from '../../../../../app/src/Features/Project/ProjectLocator.mjs'
import { WerkzeugFehler } from '../mcp/fehler.mjs'
import { zitateFinden } from '../pruefung/latex.mjs'
import { bereichPruefen } from '../pruefung/PruefManager.mjs'
import { bearbeitungen } from '../sammlungen.mjs'
import { jetzt } from '../schalter.mjs'
import * as LaufManager from './LaufManager.mjs'
import { opsFuer } from './ops.mjs'
import { spurUpdate } from './spurUpdate.mjs'

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
  } catch (error) {
    if (!(error instanceof Errors.NotFoundError)) throw error
  }
  throw new WerkzeugFehler('doc_fehlt', 'Das Dokument gibt es nicht (mehr). Bitte doc_list aufrufen.')
}

function vorkommen(text, teil) {
  const treffer = []
  for (let i = text.indexOf(teil); i >= 0; i = text.indexOf(teil, i + 1)) treffer.push(i)
  return treffer
}

async function pruefSperre(projectId, neuerText, von, bis) {
  const beruehrt = zitateFinden(neuerText).some(f => f.von <= bis && f.bis >= von)
  if (!beruehrt) return []
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

function frueheresErgebnis(frueher, projectId) {
  if (String(frueher.projectId) !== String(projectId)) {
    throw new WerkzeugFehler(
      'konflikt',
      'Dieser Idempotenz-Schlüssel gehört zu einem anderen Projekt. Bitte einen neuen Schlüssel nehmen.'
    )
  }
  if (!frueher.ergebnis) {
    throw new WerkzeugFehler('konflikt', 'Ein Aufruf mit diesem Idempotenz-Schlüssel läuft noch.')
  }
  return { ...frueher.ergebnis, wiederholt: true }
}

// Reserviert den Schlüssel vor dem Schreiben; der Unique-Index fängt gleichzeitige Wiederholungen.
async function mitSchluessel({ projectId, botId, schluessel }, schreiben) {
  const sammlung = await bearbeitungen()
  let reservierung
  try {
    reservierung = await sammlung.insertOne({ botId, schluessel, projectId, am: jetzt() })
  } catch (error) {
    if (error.code !== 11000) throw error
    return frueheresErgebnis(await sammlung.findOne({ botId, schluessel }), projectId)
  }
  try {
    const ergebnis = await schreiben()
    await sammlung.updateOne({ _id: reservierung.insertedId }, { $set: { ergebnis } })
    return ergebnis
  } catch (error) {
    await sammlung.deleteOne({ _id: reservierung.insertedId })
    throw error
  }
}

export async function docEdit({ projectId, botId, docId, pfad, alt, neu, schluessel }) {
  return await mitSchluessel({ projectId, botId, schluessel }, () =>
    bearbeiten({ projectId, botId, docId, pfad, alt, neu })
  )
}

async function bearbeiten({ projectId, botId, docId, pfad, alt, neu }) {
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
  let ergebnis = { doc_id: doc.docId, version, lauf_id: lauf._id, aenderung: false, rot }
  if (op.length) {
    await spurUpdate(projectId, doc.docId, op, version, { userId: botId, tracked: true })
    await LaufManager.aenderungMerken(lauf, { docId: doc.docId, rot })
    ergebnis = { ...ergebnis, aenderung: true }
  }
  return ergebnis
}

async function pfadBelegt(projectId, pfad) {
  try {
    await ProjectLocator.promises.findElementByPath({ project_id: projectId, path: pfad })
    return true
  } catch (error) {
    if (error instanceof Errors.NotFoundError) return false
    throw error
  }
}

export async function docCreate({ projectId, botId, pfad, inhalt, schluessel }) {
  const ziel = `/${pfad.replace(/^\//, '')}`
  return await mitSchluessel({ projectId, botId, schluessel }, async () => {
    // upsertDocWithPath würde ein vorhandenes Dokument ungetrackt leeren.
    if (await pfadBelegt(projectId, ziel)) {
      throw new WerkzeugFehler(
        'konflikt',
        'Unter diesem Pfad gibt es schon eine Datei. Bitte doc_edit nehmen oder einen anderen Pfad wählen.'
      )
    }
    let doc
    try {
      ;({ doc } = await EditorController.promises.upsertDocWithPath(projectId, ziel, [''], 'spur', botId))
    } catch (error) {
      if (!(error instanceof Errors.InvalidNameError)) throw error
      throw new WerkzeugFehler('pfad_ungueltig', 'Dieser Dateiname ist nicht erlaubt. Bitte einen anderen Pfad wählen.')
    }
    return await bearbeiten({ projectId, botId, docId: String(doc._id), alt: '', neu: inhalt })
  })
}
