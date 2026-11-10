// Speicherstand je Projekt: hochgeladene Dateien (Blobs der Dateien im Projektbaum, ohne Versionsverlauf), spur-Quellen
// und damit auch TeX-Pakete unter tex-pakete/. Die Compile-Ausgabe zählt nicht.
import fs from 'node:fs/promises'
import { db, ObjectId } from '../../../../app/src/infrastructure/mongodb.mjs'
import { GrenzeErreicht, gbText, speicherGrenzeBytes } from './grenzen/Grenzen.mjs'
import { quellen, speicher } from './sammlungen.mjs'

function dateiHashes(ordner) {
  return ordner.flatMap(o => [...(o.fileRefs ?? []).map(f => f.hash), ...dateiHashes(o.folders ?? [])]).filter(Boolean)
}

async function projekt(projectId) {
  return await db.projects.findOne(
    { _id: new ObjectId(projectId) },
    { projection: { owner_ref: 1, rootFolder: 1, 'overleaf.history.id': 1 } }
  )
}

async function dateienBytes(p) {
  const hashes = dateiHashes(p.rootFolder ?? [])
  if (!hashes.length) return 0
  // Erst hier laden: HistoryManager zieht viel nach, und ohne Grenze wird nie gerechnet.
  const { default: HistoryManager } = await import('../../../../app/src/Features/History/HistoryManager.mjs')
  return (await HistoryManager.promises.getBlobStats(p.overleaf.history.id, hashes)).totalBytes
}

async function quellenBytes(projectId) {
  const [summe] = await (await quellen())
    .aggregate([{ $match: { projectId: new ObjectId(projectId) } }, { $group: { _id: null, bytes: { $sum: '$groesse' } } }])
    .toArray()
  return summe?.bytes ?? 0
}

async function standVon(p) {
  const [dateien, quellenTeil] = await Promise.all([dateienBytes(p), quellenBytes(p._id)])
  return dateien + quellenTeil
}

export async function stand(projectId) {
  return await standVon(await projekt(projectId))
}

export async function info(projectId) {
  const p = await projekt(projectId)
  const [bytes, grenze] = await Promise.all([standVon(p), speicherGrenzeBytes(p.owner_ref)])
  return { bytes, grenze }
}

function vollFehler(bytes, grenze) {
  return new GrenzeErreicht('speicher_voll', 'spur_fehler_speicher_voll', { stand: gbText(bytes), grenze: gbText(grenze) })
}

// Für Wege ohne bekannte Größe vorab (verknüpfte Dateien, TeX-Pakete): gesperrt, sobald die Grenze erreicht ist.
export async function nichtVollPruefen(projectId) {
  const { bytes, grenze } = await info(projectId)
  if (grenze !== null && bytes >= grenze) throw vollFehler(bytes, grenze)
}

// Reserviert Platz für einen Upload und gibt eine Funktion zurück, die ihn freigibt, sobald die Datei im Projekt
// liegt (dann zählt sie im Stand) oder der Upload gescheitert ist. Die Bedingung am Zähler sorgt dafür, dass
// gleichzeitige Uploads die Grenze nicht gemeinsam überschreiten.
export async function reservieren(projectId, bytes) {
  const p = await projekt(projectId)
  const grenze = p && (await speicherGrenzeBytes(p.owner_ref))
  if (grenze === null || grenze === undefined) return async () => {}
  const _id = new ObjectId(projectId)
  const aktuell = await standVon(p)
  const sammlung = await speicher()
  await sammlung.updateOne({ _id }, { $setOnInsert: { reserviert: 0 } }, { upsert: true })
  const { modifiedCount } = await sammlung.updateOne(
    { _id, reserviert: { $lte: grenze - aktuell - bytes } },
    { $inc: { reserviert: bytes } }
  )
  if (!modifiedCount) throw vollFehler(aktuell, grenze)
  return async () => {
    await sammlung.updateOne({ _id }, { $inc: { reserviert: -bytes } })
  }
}

// Für „Speicher neu berechnen“: Größen der Quellen-Dateien in der Ablage neu einlesen.
export async function neuBerechnen(projectId, dateiPfad) {
  for (const q of await (await quellen()).find({ projectId: new ObjectId(projectId) }).toArray()) {
    const groesse = await fs.stat(dateiPfad(q)).then(s => s.size, () => null)
    if (groesse !== null && groesse !== q.groesse) await (await quellen()).updateOne({ _id: q._id }, { $set: { groesse } })
  }
  await (await speicher()).updateOne({ _id: new ObjectId(projectId) }, { $set: { reserviert: 0 } })
  return await stand(projectId)
}
