import logger from '@overleaf/logger'
import { createHash } from 'node:crypto'
import DocumentUpdaterHandler from '../../../../../app/src/Features/DocumentUpdater/DocumentUpdaterHandler.mjs'
import EditorController from '../../../../../app/src/Features/Editor/EditorController.mjs'
import Errors from '../../../../../app/src/Features/Errors/Errors.js'
import ProjectLocator from '../../../../../app/src/Features/Project/ProjectLocator.mjs'
import SafePath from '../../../../../app/src/Features/Project/SafePath.mjs'
import EditorHttpController from '../../../../../app/src/Features/Editor/EditorHttpController.mjs'
import { WerkzeugFehler } from '../mcp/fehler.mjs'
import { Problem } from '../probleme.mjs'
import { eingabeUngueltig } from '../recherche/ohneDoi.mjs'
import { zitateFinden } from '../pruefung/latex.mjs'
import { bereichPruefen, bibBereichPruefen } from '../pruefung/PruefManager.mjs'
import { bearbeitungen } from '../sammlungen.mjs'
import { anzahlEintraege, maxEintraege } from '../projektEintraege.mjs'
import { jetzt, testSchalter } from '../schalter.mjs'
import * as LaufManager from './LaufManager.mjs'
import * as LaufAktionen from './LaufAktionen.mjs'
import { lageImDokument, zahlenIn, zahlenOhneBeleg } from './zahlen.mjs'
import { opsFuer } from './ops.mjs'
import { spurUpdate } from './spurUpdate.mjs'

// document-updater trennt Clients ab 2000 offenen Changes; wir halten Abstand.
const GRENZE_CHANGES = 1990
const MAX_VORKOMMEN = 500

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
    const { element, type } = await ProjectLocator.promises.findElementByPath({
      project_id: projectId,
      path: pfad,
      exactCaseMatch: true,
    })
    // Eine Binärdatei unter dem Pfad (etwa ergebnisse.tex hochgeladen) ist kein Dokument.
    if (element?._id && type === 'doc') return { docId: String(element._id), pfad }
  } catch (error) {
    if (!(error instanceof Errors.NotFoundError)) throw error
  }
  throw new WerkzeugFehler('doc_fehlt', 'spur_fehler_doc_fehlt_liste')
}

// Zahlen aus ergebnisse.tex im Wurzelordner gelten als belegt.
async function ergebnisZahlen(projectId) {
  let doc
  try {
    doc = await docAufloesen(projectId, null, 'ergebnisse.tex')
  } catch (error) {
    if (error instanceof WerkzeugFehler) return []
    throw error
  }
  const { lines } = await DocumentUpdaterHandler.promises.getDocument(projectId, doc.docId, -1)
  return zahlenIn(lines.join('\n'))
}

function vorkommen(text, teil) {
  const treffer = []
  for (let i = text.indexOf(teil); i >= 0; i = text.indexOf(teil, i + 1)) treffer.push(i)
  return treffer
}

// Ob die Änderung ein Zitat berühren kann. Ohne das wird das Projekt nicht geladen. Eigene Zitatmakros kennt erst
// bereichPruefen, darum zählt auch ein Befehl im Bereich oder ein offenes Makro-Argument davor auf derselben Zeile.
function koennteZitatBeruehren(text, von, bis) {
  if (zitateFinden(text).some(f => f.von <= bis && f.bis >= von)) return true
  if (/\\[a-zA-Z@]|„/.test(text.slice(von, bis))) return true
  const davor = text.slice(text.lastIndexOf('\n', von - 1) + 1, von)
  return /\\[a-zA-Z@]+\*?(\[[^\]]*\])?\{[^{}]*$/.test(davor)
}

async function pruefSperre(projectId, neuerText, von, bis) {
  if (!koennteZitatBeruehren(neuerText, von, bis)) return []
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
    // Schreiben ja, aber rot, damit die Automatik es nie still übernimmt: unbekannte Form oder Quelle ohne lesbaren
    // Wortlaut, DOI bei keiner Registrierstelle, zurückgezogene Quelle.
    if (z.form === 'unbekannt' || z.wortlaut === 'nicht_pruefbar') {
      rot.push({ grund: 'nicht_pruefbar', auszug: z.auszug })
    } else if (z.referenz === 'nicht_gefunden') {
      rot.push({ grund: 'doi_unbekannt', auszug: z.auszug })
    } else if (z.retraction === 'zurueckgezogen') {
      rot.push({ grund: 'zurueckgezogen', auszug: z.auszug })
    }
  }
  return rot
}

// Eine .bib-Änderung blockiert nichts, wird aber rot, sobald ein Zitat auf den geänderten Eintrag dadurch
// nicht mehr sauber belegt ist; sonst nähme „Alle annehmen“ den kippenden Eintrag still mit.
async function bibSperre(projectId, docId, neuerText, von, bis) {
  const zeilen = await bibBereichPruefen(projectId, docId, neuerText, von, bis)
  return zeilen
    .map(z => {
      const auszug = z.auszug || z.key
      if (z.form === 'unbekannt' || ['nicht_pruefbar', 'abweichend', 'quelle_fehlt'].includes(z.wortlaut)) {
        return { grund: 'nicht_pruefbar', auszug }
      }
      if (z.referenz === 'nicht_gefunden') return { grund: 'doi_unbekannt', auszug }
      if (z.retraction === 'zurueckgezogen') return { grund: 'zurueckgezogen', auszug }
      return null
    })
    .filter(Boolean)
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

export async function docEdit({ projectId, botId, menschId, docId, pfad, alt, neu, schluessel, alleVorkommen = false }) {
  if (pfad !== undefined) pruefePfad(pfad)
  if (alleVorkommen && !alt) throw eingabeUngueltig('alt')
  // Ohne alle_vorkommen bleibt der Fingerabdruck wie vor P15.
  const argumente = { werkzeug: 'doc_edit', docId, pfad, alt, neu, ...(alleVorkommen && { alleVorkommen }) }
  return await mitSchluessel({ projectId, botId, schluessel, argumente }, () =>
    bearbeiten({ projectId, botId, menschId, docId, pfad, alt, neu, alleVorkommen })
  )
}

// Nach dem Schreiben: rote Zitate am Lauf merken, sonst nimmt der Schalter des Menschen die neuen Changes an.
// Rot wird nach Position bestimmt, nicht nur nach neuen IDs: Schreibt doc_edit in eine eigene Einfügung hinein
// (`\parencite{zzz}` wird zu `\parencite{unbekannt}`), wächst die bestehende Einfügung unter ihrer alten ID.
async function nachDemSchreiben({ projectId, lauf, menschId, docId, vorher, rot, bereich }) {
  const { ranges } = await DocumentUpdaterHandler.promises.getDocument(projectId, docId, -1)
  const alt = new Set((vorher ?? []).map(c => c.id))
  const alle = ranges?.changes ?? []
  const istNeu = c => !alt.has(c.id)
  if (rot.length) {
    const imBereich = c => c.op.i !== undefined && c.op.p < bereich.bis && c.op.p + c.op.i.length > bereich.von
    return await LaufManager.rotMerken(lauf, alle.filter(c => istNeu(c) || imBereich(c)))
  }
  const neu = alle.filter(istNeu).map(c => c.id)
  // Der Lauf kann eben erst angelegt sein: Das Dokument steht dann nur in der Datenbank schon in `docs`.
  const docs = lauf.docs.some(d => String(d) === docId) ? lauf.docs : [...lauf.docs, docId]
  if (menschId) await LaufAktionen.sofortAnnehmen(projectId, { ...lauf, docs }, menschId, neu)
}

// Wo der Alttext ersetzt wird: genau eine Stelle, mit alle_vorkommen jede (ohne Überlappung), ohne Alttext das Ende.
function stellenFuer(text, alt, alleVorkommen) {
  if (!alt) return [text.length]
  if (!alleVorkommen) {
    const treffer = vorkommen(text, alt)
    if (treffer.length > 1) throw new WerkzeugFehler('konflikt', 'spur_fehler_alttext_mehrfach')
    if (treffer.length === 0) throw new WerkzeugFehler('konflikt', 'spur_fehler_alttext_fehlt')
    return treffer
  }
  const treffer = []
  for (let i = text.indexOf(alt); i >= 0; i = text.indexOf(alt, i + alt.length)) treffer.push(i)
  if (treffer.length === 0) throw new WerkzeugFehler('konflikt', 'spur_fehler_alttext_fehlt')
  if (treffer.length > MAX_VORKOMMEN) {
    throw new Problem(422, 'zu_viele_vorkommen', 'spur_fehler_zu_viele_vorkommen', { anzahl: treffer.length, max: MAX_VORKOMMEN }, { anzahl: treffer.length })
  }
  return treffer
}

async function bearbeiten({ projectId, botId, menschId, docId, pfad, alt, neu, alleVorkommen }) {
  const doc = await docAufloesen(projectId, docId, pfad)
  const { lines, version, ranges } = await DocumentUpdaterHandler.promises.getDocument(
    projectId,
    doc.docId,
    -1
  )
  const offen = ranges?.changes?.length ?? 0
  if (offen >= GRENZE_CHANGES) {
    throw new WerkzeugFehler(
      'grenze_changes',
      'spur_fehler_zu_viele_changes'
    )
  }
  const text = lines.join('\n')
  const stellen = stellenFuer(text, alt, alleVorkommen)
  // Je Stelle bis zu zwei Changes (Löschung und Einfügung); viele Stellen dürfen die Grenze nicht auf einmal reißen.
  if (alleVorkommen && offen + 2 * stellen.length > GRENZE_CHANGES) {
    throw new WerkzeugFehler('grenze_changes', 'spur_fehler_zu_viele_changes')
  }
  // Lage jeder Stelle im neuen Text: Davor stehende Stellen haben ihn schon um die Längendifferenz verschoben.
  const versatz = neu.length - alt.length
  const neueStellen = stellen.map((start, k) => start + k * versatz)
  const neuerText = alleVorkommen ? text.replaceAll(alt, neu) : text.slice(0, stellen[0]) + neu + text.slice(stellen[0] + alt.length)
  const istBib = /\.bib$/.test(doc.pfad)
  // Alle Prüfungen vor dem Schreiben: Schlägt eine Stelle fehl, wird nichts geschrieben.
  const rot = []
  for (const start of neueStellen) {
    rot.push(
      ...(istBib
        ? await bibSperre(projectId, doc.docId, neuerText, start, start + neu.length)
        : await pruefSperre(projectId, neuerText, start, start + neu.length))
    )
  }

  // Werte gehören nach ergebnisse.tex; dort selbst ist jede Zahl gewollt, in .bib-Dateien stehen nur Metadaten.
  const ohnePruefung = istBib || /(^|\/)ergebnisse\.tex$/.test(doc.pfad)
  const ohneLage = ohnePruefung ? [] : zahlenOhneBeleg(neu)
  // Die Lage kostet einen Lauf über den Text davor; nur bestimmen, wenn das Stück Zahlen hat.
  const lagen = ohneLage.length ? neueStellen.map(start => lageImDokument(neuerText, start)) : []
  const kandidaten = lagen.flatMap(lage => zahlenOhneBeleg(neu, [], lage))
  const belegt = kandidaten.length ? await ergebnisZahlen(projectId) : []
  const zahlen = kandidaten.length ? [...new Set(lagen.flatMap(lage => zahlenOhneBeleg(neu, belegt, lage)))] : []
  const op = [...stellen].reverse().flatMap(start => opsFuer(start, alt, neu))
  const lauf = await LaufManager.laufFuerSchreiben(projectId, botId)
  let ergebnis = {
    doc_id: doc.docId,
    version,
    lauf_id: lauf._id,
    aenderung: false,
    rot,
    zahlen_ohne_beleg: zahlen,
    ...(alleVorkommen && { ersetzt: stellen.length }),
  }
  if (op.length) {
    await spurUpdate(projectId, doc.docId, op, version, { userId: botId, tracked: true })
    ergebnis = { ...ergebnis, aenderung: true }
    try {
      await LaufManager.aenderungMerken(lauf, {
        docId: doc.docId,
        rot,
        zahlen: zahlen.map(zahl => ({ zahl, pfad: doc.pfad })),
        ...(alleVorkommen && { anzahl: stellen.length }),
      })
      await nachDemSchreiben({
        projectId,
        lauf,
        menschId,
        docId: doc.docId,
        vorher: ranges?.changes,
        rot,
        bereich: { von: neueStellen[0], bis: neueStellen.at(-1) + neu.length },
      })
    } catch (error) {
      // Geschrieben ist geschrieben: Ein Fehler beim Mitzählen oder Annehmen darf die Reservierung nicht freigeben,
      // sonst schriebe eine Wiederholung doppelt. Die Changes bleiben dann offen.
      logger.error({ err: error, projectId, docId: doc.docId }, 'spur: Änderung nicht am Lauf vermerkt oder angenommen')
    }
  }
  return ergebnis
}

async function elementAn(projectId, pfad) {
  try {
    return await ProjectLocator.promises.findElementByPath({ project_id: projectId, path: pfad })
  } catch (error) {
    if (error instanceof Errors.NotFoundError) return null
    throw error
  }
}

// Fehler eines Dienstes (document-updater, project-history, docstore): 5xx, Zeitüberschreitung, keine Verbindung.
function dienstNichtErreichbar(error) {
  // RequestFailedError von @overleaf/fetch-utils trägt die Antwort.
  if (typeof error?.response?.status === 'number') return error.response.status >= 500
  return ['AbortError', 'TimeoutError'].includes(error?.name) || /^(ECONNREFUSED|ECONNRESET|ETIMEDOUT|EAI_AGAIN|UND_ERR)/.test(error?.code ?? '')
}

function alsWerkzeugFehler(error) {
  if (error instanceof Errors.TooManyFilesError) return zuVieleDateien(maxEintraege() + 1)
  if (dienstNichtErreichbar(error)) return new WerkzeugFehler('dienst_nicht_erreichbar', 'spur_fehler_dienst_kurz_weg')
  return error
}

const zuVieleDateien = anzahl =>
  new WerkzeugFehler('projekt_zu_viele_dateien', 'spur_fehler_projekt_zu_viele_dateien', { anzahl, grenze: maxEintraege() })

// Overleaf legt fehlende Ordner an, scheitert aber an einem Pfadteil, der eine Datei ist.
async function ordnerPruefen(projectId, ziel) {
  const teile = ziel.split('/').filter(Boolean).slice(0, -1)
  for (let i = 1; i <= teile.length; i++) {
    const gefunden = await elementAn(projectId, `/${teile.slice(0, i).join('/')}`)
    if (!gefunden) return
    if (gefunden.type !== 'folder') {
      throw new WerkzeugFehler('pfad_ist_datei', 'spur_fehler_pfad_ist_datei', { teil: teile.slice(0, i).join('/') })
    }
  }
}

// Ein leeres Dokument, das ein gescheiterter Versuch desselben Bots hinterlassen hat, wird wiederverwendet.
const restSchluessel = (projectId, ziel) => `rest:${projectId}:${ziel}`

async function restUebernehmen(projectId, botId, ziel, gefunden) {
  const rest = await (await bearbeitungen()).findOne({ botId, schluessel: restSchluessel(projectId, ziel) })
  if (gefunden.type === 'doc' && rest && String(rest.docId) === String(gefunden.element._id)) {
    const { lines } = await DocumentUpdaterHandler.promises.getDocument(projectId, String(gefunden.element._id), -1)
    if (lines.join('\n') === '') return String(gefunden.element._id)
  }
  throw new WerkzeugFehler('konflikt', 'spur_fehler_pfad_belegt', { pfad: ziel.slice(1) })
}

// Kein leeres Dokument zurücklassen. Scheitert das, bleibt der erste Fehler die Antwort; das Dokument wird als Rest
// vermerkt, damit der nächste Versuch es übernimmt statt an `konflikt` zu scheitern.
async function aufraeumen({ projectId, botId, docId, ziel, ursache }) {
  try {
    if (testSchalter('SPUR_DOC_AUFRAEUMEN_FEHLER')) throw new Error('Testschalter: Aufräumen scheitert')
    await EditorController.promises.deleteEntity(projectId, docId, 'doc', 'spur', botId)
    await (await bearbeitungen()).deleteOne({ botId, schluessel: restSchluessel(projectId, ziel) })
  } catch (error) {
    logger.error(
      { err: error, ursache: { name: ursache.name, message: ursache.message, status: ursache.response?.status }, projectId, botId, docId, pfad: ziel },
      'spur: doc_create konnte das leere Dokument nicht entfernen'
    )
    await (await bearbeitungen()).updateOne(
      { botId, schluessel: restSchluessel(projectId, ziel) },
      { $set: { projectId, docId, am: jetzt() } },
      { upsert: true }
    )
  }
}

export async function docCreate({ projectId, botId, menschId, pfad, inhalt, schluessel }) {
  pruefePfad(pfad)
  const ziel = `/${pfad.replace(/^\//, '')}`
  const argumente = { werkzeug: 'doc_create', pfad, inhalt }
  return await mitSchluessel({ projectId, botId, schluessel, argumente }, async () => {
    await ordnerPruefen(projectId, ziel)
    const gefunden = await elementAn(projectId, ziel)
    let docId
    if (gefunden) {
      // upsertDocWithPath würde ein vorhandenes Dokument ungetrackt leeren.
      docId = await restUebernehmen(projectId, botId, ziel, gefunden)
    } else {
      const anzahl = await anzahlEintraege(projectId)
      if (anzahl >= maxEintraege()) throw zuVieleDateien(anzahl)
      try {
        const { doc } = await EditorController.promises.upsertDocWithPath(projectId, ziel, [''], 'spur', botId)
        docId = String(doc._id)
      } catch (error) {
        if (error instanceof Errors.InvalidNameError) throw new WerkzeugFehler('pfad_ungueltig', 'spur_fehler_dateiname_ungueltig')
        throw alsWerkzeugFehler(error)
      }
    }
    try {
      if (testSchalter('SPUR_DOC_CREATE_FEHLER')) throw new Error('Testschalter: unbekannter Fehler in doc_create')
      const ergebnis = await bearbeiten({ projectId, botId, menschId, docId, alt: '', neu: inhalt })
      if (gefunden) await (await bearbeitungen()).deleteOne({ botId, schluessel: restSchluessel(projectId, ziel) })
      return ergebnis
    } catch (error) {
      await aufraeumen({ projectId, botId, docId, ziel, ursache: error })
      throw alsWerkzeugFehler(error)
    }
  })
}
