// Grenzen für Projekte je Nutzer und Speicher je Projekt. Ein Standard für alle (null = unbegrenzt) und je Nutzer
// eine Ausnahme: Feld fehlt = Standard, null = ausdrücklich unbegrenzt, Zahl (auch 0) = diese Grenze.
import { db, ObjectId } from '../../../../../app/src/infrastructure/mongodb.mjs'
import { sprache } from '../meldungen.mjs'
import { Problem } from '../probleme.mjs'
import { grenzen } from '../sammlungen.mjs'

export const GB = 1024 ** 3
const FELDER = ['projekte', 'speicherGb']
const STANDARD = '_standard'

// Auch für Overleafs Routen: ErrorController antwortet bei `spurGrenze` mit 403 und der Meldung.
export class GrenzeErreicht extends Problem {
  constructor(typ, schluessel, werte) {
    super(403, typ, schluessel, werte)
    this.spurGrenze = typ
  }
}

export function gbText(bytes) {
  return new Intl.NumberFormat(sprache, { maximumFractionDigits: 2 }).format(bytes / GB)
}

// Eingabe aus dem Formular: leer = null; sonst eine Zahl ab 0, Projekte ganzzahlig, Komma erlaubt.
export function wertLesen(eingabe, feld) {
  if (eingabe === null || eingabe === undefined || String(eingabe).trim() === '') return null
  const text = String(eingabe).trim().replace(',', '.')
  const zahl = /^\d+(\.\d+)?$/.test(text) ? Number(text) : NaN
  if (feld === 'projekte' && !Number.isInteger(zahl)) {
    throw new Problem(422, 'eingabe_ungueltig', 'spur_fehler_grenze_projekte')
  }
  if (!(zahl >= 0)) throw new Problem(422, 'eingabe_ungueltig', 'spur_fehler_grenze_speicher')
  return zahl
}

export async function standard() {
  const eintrag = (await (await grenzen()).findOne({ _id: STANDARD })) ?? {}
  return { projekte: eintrag.projekte ?? null, speicherGb: eintrag.speicherGb ?? null, texPaketeAus: Boolean(eintrag.texPaketeAus) }
}

export async function standardSetzen({ projekte, speicherGb, texPaketeAus = false }) {
  await (await grenzen()).updateOne(
    { _id: STANDARD },
    { $set: { projekte, speicherGb, texPaketeAus: Boolean(texPaketeAus) } },
    { upsert: true }
  )
}

export async function ausnahme(userId) {
  const eintrag = await (await grenzen()).findOne({ _id: new ObjectId(userId) })
  return Object.fromEntries(FELDER.filter(f => eintrag && f in eintrag).map(f => [f, eintrag[f]]))
}

// undefined entfernt die Ausnahme für das Feld (dann gilt der Standard).
export async function ausnahmeSetzen(userId, werte) {
  const $set = {}
  const $unset = {}
  for (const feld of FELDER) {
    if (werte[feld] === undefined) $unset[feld] = ''
    else $set[feld] = werte[feld]
  }
  const _id = new ObjectId(userId)
  await (await grenzen()).updateOne({ _id }, { $set, $unset }, { upsert: true })
  await (await grenzen()).deleteOne({ _id, projekte: { $exists: false }, speicherGb: { $exists: false } })
}

export async function ausnahmen() {
  return await (await grenzen()).find({ _id: { $ne: STANDARD } }).toArray()
}

async function gilt(userId, feld) {
  const eigene = await ausnahme(userId)
  return feld in eigene ? eigene[feld] : (await standard())[feld]
}

export async function projektGrenze(userId) {
  return await gilt(userId, 'projekte')
}

export async function speicherGrenzeBytes(userId) {
  const gb = await gilt(userId, 'speicherGb')
  return gb === null ? null : Math.round(gb * GB)
}

// Alle Projekte, deren Eigentümer der Nutzer ist, auch archivierte und im Papierkorb; endgültig gelöschte liegen
// nicht mehr in `projects`.
export async function projektStand(userId) {
  const ownerRef = new ObjectId(userId)
  return { anzahl: await db.projects.countDocuments({ owner_ref: ownerRef }), grenze: await projektGrenze(userId) }
}

export async function projektAnlegenPruefen(ownerId) {
  const { anzahl, grenze } = await projektStand(ownerId)
  if (grenze !== null && anzahl >= grenze) {
    throw new GrenzeErreicht('projekte_voll', 'spur_fehler_projekte_voll', { anzahl, grenze })
  }
}
