// Speicherstand je Projekt: hochgeladene Dateien, spur-Quellen und TeX-Pakete, ohne Versionsverlauf und Compile-Ausgabe.
import { speicher } from './sammlungen.mjs'

export async function reservieren(projectId, bytes) {
  await (await speicher()).updateOne({ projectId }, { $inc: { bytes } }, { upsert: true })
}

export async function freigeben(projectId, bytes) {
  await (await speicher()).updateOne({ projectId }, { $inc: { bytes: -bytes } })
}

export async function stand(projectId) {
  return (await (await speicher()).findOne({ projectId }))?.bytes ?? 0
}
