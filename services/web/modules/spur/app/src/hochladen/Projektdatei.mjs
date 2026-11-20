// Bilddateien im Projekt: eigene Bilder über file_upload_link und Ausschnitte aus offen lizenzierten Quellen über
// source_figure_add. Sie gehören zum Lauf wie die Dateien von tex_package_add; „Lauf rückgängig“ entfernt sie.
import fs from 'node:fs/promises'
import os from 'node:os'
import Path from 'node:path'
import EditorController from '../../../../../app/src/Features/Editor/EditorController.mjs'
import ProjectEntityHandler from '../../../../../app/src/Features/Project/ProjectEntityHandler.mjs'
import { ausschnittBild } from '../pdf.mjs'
import { Problem } from '../probleme.mjs'
import { anzahlEintraege, maxEintraege } from '../projektEintraege.mjs'
import * as QuellenManager from '../QuellenManager.mjs'
import { eingabeUngueltig } from '../recherche/ohneDoi.mjs'
import * as LaufManager from '../schreiben/LaufManager.mjs'
import * as Speicher from '../Speicher.mjs'

export const MAX_BYTES = 10 * 1024 * 1024
const MAX_PFAD = 200
const ENDUNGEN = { '.png': 'png', '.jpg': 'jpg', '.jpeg': 'jpg', '.pdf': 'pdf' }
const KOPF = {
  png: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  jpg: Buffer.from([0xff, 0xd8, 0xff]),
  pdf: Buffer.from('%PDF-'),
}
// Ein Abschnitt: Buchstaben, Ziffern, Leerzeichen und - _ . ( ), nicht mit Punkt oder Leerzeichen am Anfang.
const ABSCHNITT = /^[\p{L}\p{N}_\-()][\p{L}\p{N}_\-(). ]*$/u

export async function dateityp(pfad) {
  const datei = await fs.open(pfad)
  try {
    const { buffer, bytesRead } = await datei.read(Buffer.alloc(8), 0, 8, 0)
    const anfang = buffer.subarray(0, bytesRead)
    return Object.keys(KOPF).find(typ => anfang.subarray(0, KOPF[typ].length).equals(KOPF[typ])) ?? null
  } finally {
    await datei.close()
  }
}

function pfadPruefen(pfad, feld, endungen) {
  const gueltig =
    typeof pfad === 'string' &&
    pfad.length <= MAX_PFAD &&
    pfad.split('/').every(a => ABSCHNITT.test(a) && a !== '..') &&
    endungen.includes(Path.extname(pfad).toLowerCase())
  if (!gueltig) throw eingabeUngueltig(feld)
}

async function vorhandenePfade(projectId) {
  const { docs, files } = await ProjectEntityHandler.promises.getAllEntities(projectId)
  return [...docs, ...files].map(e => e.path.replace(/^\//, ''))
}

// Der oberste Ordner des Pfads, den es noch nicht gibt; „Lauf rückgängig“ entfernt ihn, wenn er danach leer ist.
function neuerOrdner(pfad, pfade) {
  const teile = pfad.split('/').slice(0, -1)
  for (let i = 1; i <= teile.length; i++) {
    const ordner = teile.slice(0, i).join('/')
    if (!pfade.some(p => p.startsWith(`${ordner}/`))) return { ordner, neu: teile.length - i + 1 }
  }
  return { ordner: null, neu: 0 }
}

async function freiPruefen(projectId, pfad) {
  const pfade = await vorhandenePfade(projectId)
  if (pfade.includes(pfad)) throw new Problem(409, 'konflikt', 'spur_fehler_projektdatei_vorhanden', { pfad })
  return pfade
}

async function ablegen({ projectId, menschId, botId, pfad, datei, groesse, pfade }) {
  const { ordner, neu } = neuerOrdner(pfad, pfade)
  const danach = (await anzahlEintraege(projectId)) + neu + 1
  if (danach > maxEintraege()) {
    throw new Problem(422, 'projekt_zu_viele_dateien', 'spur_fehler_projektdatei_zu_viele', { anzahl: danach, grenze: maxEintraege() })
  }
  const freigeben = await Speicher.reservieren(projectId, groesse)
  try {
    await EditorController.promises.upsertFileWithPath(projectId, `/${pfad}`, datei, null, 'spur', menschId)
  } finally {
    await freigeben()
  }
  const lauf = await LaufManager.laufFuerSchreiben(projectId, botId)
  await LaufManager.angelegtMerken(lauf, [{ art: 'datei', pfad, ...(ordner && { ordner }) }])
  return { pfad }
}

// Eigene Datei vom Rechner (Upload-Link). Der Typ zählt am Dateianfang und muss zur Endung des Pfads passen.
export async function anlegen({ projectId, menschId, botId, pfad, datei, groesse }) {
  pfadPruefen(pfad, 'projektdatei', Object.keys(ENDUNGEN))
  if (groesse > MAX_BYTES) throw new Problem(413, 'zu_gross', 'spur_fehler_projektdatei_zu_gross', { mb: MAX_BYTES / 1024 / 1024 })
  if ((await dateityp(datei)) !== ENDUNGEN[Path.extname(pfad).toLowerCase()]) {
    throw new Problem(422, 'dateityp_nicht_erlaubt', 'spur_fehler_dateityp_nicht_erlaubt')
  }
  const pfade = await freiPruefen(projectId, pfad)
  return await ablegen({ projectId, menschId, botId, pfad, datei, groesse, pfade })
}

// Offene Lizenzen erlauben Bearbeitungen wie einen Ausschnitt; ND (keine Bearbeitung) gehört nicht dazu.
const LIZENZ_NAME = { 'cc-by': 'CC BY', 'cc-by-sa': 'CC BY-SA', 'cc-by-nc': 'CC BY-NC', 'cc-by-nc-sa': 'CC BY-NC-SA', cc0: 'CC0', 'public-domain': 'Public Domain' }

// Lizenzangaben wie Unpaywall sie liefert („cc-by“, „CC-BY-4.0“, „pd“); null, wenn sie nicht offen ist.
export function offeneLizenz(lizenz) {
  if (typeof lizenz !== 'string') return null
  const name = lizenz.trim().toLowerCase().replace(/[\s_]+/g, '-').replace(/-\d+(\.\d+)*$/, '')
  const kanonisch = ['pd', 'public-domain', 'publicdomain'].includes(name) ? 'public-domain' : name
  return Object.hasOwn(LIZENZ_NAME, kanonisch) ? kanonisch : null
}

function ausschnittPruefen(a) {
  const anteil = w => typeof w === 'number' && w >= 0 && w <= 1
  const gueltig =
    a && [a.x, a.y, a.breite, a.hoehe].every(anteil) && a.breite > 0 && a.hoehe > 0 && a.x + a.breite <= 1 && a.y + a.hoehe <= 1
  if (!gueltig) throw eingabeUngueltig('ausschnitt')
}

// Ausschnitt einer Quellseite mit 300 dpi als PNG, nur bei offener Lizenz.
export async function abbildungAusQuelle({ projectId, menschId, botId, quelle, seite, ausschnitt, pfad }) {
  pfadPruefen(pfad, 'pfad', ['.png'])
  ausschnittPruefen(ausschnitt)
  QuellenManager.seitePruefen(quelle, seite)
  const lizenz = offeneLizenz(quelle.lizenz)
  if (!lizenz) throw new Problem(409, 'lizenz_fehlt', 'spur_fehler_lizenz_fehlt', { key: quelle.key })
  const pfade = await freiPruefen(projectId, pfad)
  const ordner = await fs.mkdtemp(Path.join(os.tmpdir(), 'spur-abbildung-'))
  try {
    const datei = await ausschnittBild(QuellenManager.dateiPfad(quelle), seite, Path.join(ordner, 'ausschnitt'), ausschnitt)
    const { size } = await fs.stat(datei)
    await ablegen({ projectId, menschId, botId, pfad, datei, groesse: size, pfade })
  } finally {
    await fs.rm(ordner, { recursive: true, force: true })
  }
  return {
    pfad,
    lizenz,
    quellenangabe: `Aus \\textcite{${quelle.key}}, S. ${seite}, Lizenz ${LIZENZ_NAME[lizenz]}.`,
  }
}
