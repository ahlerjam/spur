// tex_file_read: Dateien der TeX-Installation lesen, um das Verhalten einer Klasse oder eines Pakets zu verstehen.
// Zuerst tex-pakete/ des Projekts (dort liegen Pakete aus tex_package_add), dann die Installation wie kpsewhich.
// Nur Dateinamen ohne Pfad und mit TeX-Endung; was kpsewhich außerhalb des TeX-Baums fände, gilt als nicht gefunden.
import { execFile } from 'node:child_process'
import fs from 'node:fs/promises'
import os from 'node:os'
import Path from 'node:path'
import { promisify } from 'node:util'
import HistoryManager from '../../../../../app/src/Features/History/HistoryManager.mjs'
import ProjectEntityHandler from '../../../../../app/src/Features/Project/ProjectEntityHandler.mjs'
import { Problem } from '../probleme.mjs'
import { eingabeUngueltig } from '../recherche/ohneDoi.mjs'
import { ORDNER } from './texArchiv.mjs'

const ausfuehren = promisify(execFile)
const MAX_TEXT = 40000
const MAX_BYTES = 5 * 1024 * 1024
const NAME = /^[A-Za-z0-9][A-Za-z0-9_-]*(\.[A-Za-z0-9_-]+)*\.(cls|sty|bst|bbx|cbx|lbx|def|cfg|clo|tex|ldf)$/

const nichtGefunden = name => new Problem(404, 'tex_datei_nicht_gefunden', 'spur_fehler_tex_datei_nicht_gefunden', { name })

async function ausDemProjekt(projectId, name) {
  const { files } = await ProjectEntityHandler.promises.getAllEntities(projectId)
  const datei = files.find(f => f.path.startsWith(`/${ORDNER}/`) && Path.posix.basename(f.path) === name)
  if (!datei) return null
  const { stream } = await HistoryManager.promises.requestBlobWithProjectId(projectId, datei.file.hash)
  const teile = []
  let laenge = 0
  for await (const teil of stream) {
    laenge += teil.length
    if (laenge > MAX_BYTES) break
    teile.push(teil)
  }
  stream.destroy?.()
  return { pfad: datei.path.slice(1), herkunft: 'projekt', inhalt: Buffer.concat(teile).toString('utf8') }
}

async function wurzeln() {
  const werte = await Promise.all(
    ['SELFAUTOPARENT', 'TEXMFLOCAL'].map(async name => (await ausfuehren('kpsewhich', ['-var-value', name])).stdout.trim())
  )
  const echt = await Promise.all(werte.filter(Boolean).map(w => fs.realpath(w).catch(() => null)))
  return echt.filter(Boolean)
}

// kpsewhich sucht auch im Arbeitsordner; darum aus einem leeren Ordner fragen.
async function ausDerInstallation(name) {
  const leer = await fs.mkdtemp(Path.join(os.tmpdir(), 'spur-kpsewhich-'))
  let gefunden
  try {
    gefunden = (await ausfuehren('kpsewhich', [name], { cwd: leer })).stdout.trim()
  } catch (error) {
    // kpsewhich endet mit Code 1, wenn es die Datei nicht findet.
    if (error.code !== 1) throw error
    return null
  } finally {
    await fs.rm(leer, { recursive: true, force: true })
  }
  if (!gefunden) return null
  const pfad = await fs.realpath(gefunden)
  if (!(await wurzeln()).some(w => pfad.startsWith(`${w}/`))) return null
  return { pfad, herkunft: 'installation', inhalt: (await fs.readFile(pfad)).subarray(0, MAX_BYTES).toString('utf8') }
}

export async function lesen({ projectId, name, abZeile = 1 }) {
  if (typeof name !== 'string' || !NAME.test(name)) throw eingabeUngueltig('name')
  const datei = (await ausDemProjekt(projectId, name)) ?? (await ausDerInstallation(name))
  if (!datei) throw nichtGefunden(name)
  const zeilen = datei.inhalt.split('\n')
  const text = zeilen.slice(abZeile - 1).join('\n')
  return {
    name,
    pfad: datei.pfad,
    herkunft: datei.herkunft,
    // Ein Zeilenumbruch am Dateiende beginnt keine weitere Zeile.
    zeilen: datei.inhalt.endsWith('\n') ? zeilen.length - 1 : zeilen.length,
    ab_zeile: abZeile,
    text: text.slice(0, MAX_TEXT),
    gekuerzt: text.length > MAX_TEXT,
  }
}
