import logger from '@overleaf/logger'
import { createHash } from 'node:crypto'
import DocumentUpdaterHandler from '../../../../../app/src/Features/DocumentUpdater/DocumentUpdaterHandler.mjs'
import EditorController from '../../../../../app/src/Features/Editor/EditorController.mjs'
import Errors from '../../../../../app/src/Features/Errors/Errors.js'
import ProjectLocator from '../../../../../app/src/Features/Project/ProjectLocator.mjs'
import SafePath from '../../../../../app/src/Features/Project/SafePath.mjs'
import EditorHttpController from '../../../../../app/src/Features/Editor/EditorHttpController.mjs'
import { WerkzeugFehler } from '../mcp/fehler.mjs'
import { zitateFinden } from '../pruefung/latex.mjs'
import { bereichPruefen } from '../pruefung/PruefManager.mjs'
import { bearbeitungen } from '../sammlungen.mjs'
import { jetzt } from '../schalter.mjs'
import * as LaufManager from './LaufManager.mjs'
import { zahlenOhneBeleg } from './zahlen.mjs'
import { opsFuer } from './ops.mjs'
import { spurUpdate } from './spurUpdate.mjs'

// document-updater trennt Clients ab 2000 offenen Changes; wir halten Abstand.
const GRENZE_CHANGES = 1990

// Namen und Pfade wie der Web-Weg prüfen: SafePath für erlaubte Zeichen und reservierte Namen,
// _nameIsAcceptableLength für die Länge jedes Teils (unter 150 Zeichen). Längere Namen legt
// SafePath zwar an, danach scheitert aber jeder Compile mit ENAMETOOLONG.
function pruefePfad(pfad) {
  const teile = pfad.replace(/^\//, '').split('/')
  if (!SafePath.isCleanPath(pfad) || !teile.every(EditorHttpController._nameIsAcceptableLength)) {
    throw new WerkzeugFehler(
      'pfad_ungueltig',
      'spur_fehler_pfad_ungueltig'
    )
  }
}

async function docAufloesen(projectId, docId, pfad) {
  if (!docId && !pfad) {
    throw new WerkzeugFehler('doc_fehlt', 'spur_fehler_doc_angabe_fehlt')
  }
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
  throw new WerkzeugFehler('doc_fehlt', 'spur_fehler_doc_fehlt_liste')
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
        'spur_fehler_zitat_abweichend', { auszug: z.auszug, key: z.key }
      )
    }
    if (z.wortlaut === 'quelle_fehlt') {
      throw new WerkzeugFehler(
        'quelle_fehlt',
        'spur_fehler_zitat_ohne_quelle', { key: z.key }
      )
    }
    // Nicht prüfbar (unbekannte Form oder Quelle ohne lesbaren Wortlaut): annehmen, aber rot,
    // damit die Automatik es nie still übernimmt.
    if (z.form === 'unbekannt' || z.wortlaut === 'nicht_pruefbar') {
      rot.push({ grund: 'nicht_pruefbar', auszug: z.auszug })
    }
  }
  return rot
}

const VERWAIST_MS = 2 * 60 * 1000

// Fingerabdruck der Argumente: Derselbe Schlüssel mit anderem Inhalt ist ein Fehler des Aufrufers.
const fingerabdruck = inhalt => createHash('sha256').update(JSON.stringify(inhalt)).digest('hex')

function frueheresErgebnis(frueher, projectId, inhalt) {
  if (!frueher) {
    // Der erste Aufruf ist zwischen Reservierung und Nachsehen gescheitert: einfach wiederholen.
    throw new WerkzeugFehler('konflikt', 'spur_fehler_idempotenz_gescheitert')
  }
  if (String(frueher.projectId) !== String(projectId)) {
    throw new WerkzeugFehler(
      'konflikt',
      'spur_fehler_idempotenz_anderes_projekt'
    )
  }
  if (frueher.inhalt && frueher.inhalt !== inhalt) {
    throw new WerkzeugFehler(
      'konflikt',
      'spur_fehler_idempotenz_andere_aenderung'
    )
  }
  if (!frueher.ergebnis) {
    throw new WerkzeugFehler('konflikt', 'spur_fehler_idempotenz_laeuft')
  }
  return { ...frueher.ergebnis, wiederholt: true }
}

// Reserviert den Schlüssel vor dem Schreiben; der Unique-Index fängt gleichzeitige Wiederholungen.
async function mitSchluessel({ projectId, botId, schluessel, argumente }, schreiben) {
  const sammlung = await bearbeitungen()
  const inhalt = fingerabdruck(argumente)
  let reservierung
  try {
    reservierung = await sammlung.insertOne({ botId, schluessel, projectId, inhalt, am: jetzt() })
  } catch (error) {
    if (error.code !== 11000) throw error
    const frueher = await sammlung.findOne({ botId, schluessel })
    // Eine Reservierung ohne Ergebnis, die älter als zwei Minuten ist, stammt von einem abgebrochenen
    // Aufruf: freigeben und neu versuchen, statt den Schlüssel 30 Tage zu blockieren.
    if (frueher && !frueher.ergebnis && jetzt() - frueher.am > VERWAIST_MS) {
      await sammlung.deleteOne({ _id: frueher._id, ergebnis: { $exists: false } })
      return await mitSchluessel({ projectId, botId, schluessel, argumente }, schreiben)
    }
    return frueheresErgebnis(frueher, projectId, inhalt)
  }
  let ergebnis
  try {
    ergebnis = await schreiben()
  } catch (error) {
    // Nichts geschrieben: Der Schlüssel ist für eine Wiederholung wieder frei.
    await sammlung.deleteOne({ _id: reservierung.insertedId })
    throw error
  }
  // Geschrieben ist geschrieben: Scheitert nur das Merken, bleibt die Reservierung stehen,
  // damit eine Wiederholung nicht doppelt schreibt.
  await sammlung.updateOne({ _id: reservierung.insertedId }, { $set: { ergebnis } })
  return ergebnis
}

export async function docEdit({ projectId, botId, docId, pfad, alt, neu, schluessel }) {
  if (pfad !== undefined) pruefePfad(pfad)
  const argumente = { werkzeug: 'doc_edit', docId, pfad, alt, neu }
  return await mitSchluessel({ projectId, botId, schluessel, argumente }, () =>
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
      'spur_fehler_zu_viele_changes'
    )
  }
  const text = lines.join('\n')
  let start = text.length
  if (alt) {
    const treffer = vorkommen(text, alt)
    if (treffer.length > 1) throw new WerkzeugFehler('konflikt', 'spur_fehler_alttext_mehrfach')
    if (treffer.length === 0) throw new WerkzeugFehler('konflikt', 'spur_fehler_alttext_fehlt')
    start = treffer[0]
  }
  const neuerText = text.slice(0, start) + neu + text.slice(start + alt.length)
  const rot = await pruefSperre(projectId, neuerText, start, start + neu.length)

  // Werte gehören nach ergebnisse.tex; dort selbst ist jede Zahl gewollt.
  const zahlen = /(^|\/)ergebnisse\.tex$/.test(doc.pfad) ? [] : zahlenOhneBeleg(neu)
  const op = opsFuer(start, alt, neu)
  const lauf = await LaufManager.laufFuerSchreiben(projectId, botId)
  let ergebnis = { doc_id: doc.docId, version, lauf_id: lauf._id, aenderung: false, rot, zahlen_ohne_beleg: zahlen }
  if (op.length) {
    await spurUpdate(projectId, doc.docId, op, version, { userId: botId, tracked: true })
    ergebnis = { ...ergebnis, aenderung: true }
    try {
      await LaufManager.aenderungMerken(lauf, {
        docId: doc.docId,
        rot,
        zahlen: zahlen.map(zahl => ({ zahl, pfad: doc.pfad })),
      })
    } catch (error) {
      // Geschrieben ist geschrieben: Ein Fehler beim Mitzählen darf die Reservierung nicht freigeben,
      // sonst schriebe eine Wiederholung doppelt.
      logger.error({ err: error, projectId, docId: doc.docId }, 'spur: Änderung nicht am Lauf vermerkt')
    }
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
  pruefePfad(pfad)
  const ziel = `/${pfad.replace(/^\//, '')}`
  const argumente = { werkzeug: 'doc_create', pfad, inhalt }
  return await mitSchluessel({ projectId, botId, schluessel, argumente }, async () => {
    // upsertDocWithPath würde ein vorhandenes Dokument ungetrackt leeren.
    if (await pfadBelegt(projectId, ziel)) {
      throw new WerkzeugFehler(
        'konflikt',
        'spur_fehler_pfad_belegt'
      )
    }
    let doc
    try {
      ;({ doc } = await EditorController.promises.upsertDocWithPath(projectId, ziel, [''], 'spur', botId))
    } catch (error) {
      if (!(error instanceof Errors.InvalidNameError)) throw error
      throw new WerkzeugFehler('pfad_ungueltig', 'spur_fehler_dateiname_ungueltig')
    }
    try {
      return await bearbeiten({ projectId, botId, docId: String(doc._id), alt: '', neu: inhalt })
    } catch (error) {
      // Kein leeres Dokument zurücklassen, das jede Wiederholung am belegten Pfad scheitern ließe.
      await EditorController.promises.deleteEntity(projectId, doc._id, 'doc', 'spur', botId)
      throw error
    }
  })
}
