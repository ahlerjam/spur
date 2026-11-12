import Path from 'node:path'
import { promiseMapWithLimit } from '@overleaf/promise-utils'
import { fileURLToPath } from 'node:url'
import { db, ObjectId } from '../../../../../app/src/infrastructure/mongodb.mjs'
import { menschId, projektId } from '../anfrage.mjs'
import { mitProblemen, Problem } from '../probleme.mjs'
import { dateiPfad } from '../QuellenManager.mjs'
import * as Speicher from '../Speicher.mjs'
import * as Grenzen from './Grenzen.mjs'

const SEITE = Path.resolve(Path.dirname(fileURLToPath(import.meta.url)), '../../views/grenzen-admin')

export function seite(_req, res) {
  res.render(SEITE, { title: 'Limits' })
}

// Liest jedes Feld für sich, damit das Formular den Fehler am richtigen Feld zeigt.
function felderLesen(body, felder, umwandeln) {
  const werte = {}
  const fehler = {}
  for (const feld of felder) {
    try {
      werte[feld] = umwandeln(body[feld], feld)
    } catch (error) {
      if (!(error instanceof Problem)) throw error
      fehler[feld] = error.message
    }
  }
  return { werte, fehler }
}

export const daten = mitProblemen(async (_req, res) => {
  const standard = await Grenzen.standard()
  const ausnahmen = new Map((await Grenzen.ausnahmen()).map(a => [String(a._id), a]))
  // Ohne die Claude-Bots (ClaudeZugang.botFuer).
  const nutzer = await db.users
    .find({ 'spur.botFuer': { $exists: false } }, { projection: { email: 1, first_name: 1, last_name: 1 } })
    .toArray()
  const projekte = await db.projects.find({}, { projection: { name: 1, owner_ref: 1 } }).toArray()
  const anzahl = new Map()
  for (const p of projekte) anzahl.set(String(p.owner_ref), (anzahl.get(String(p.owner_ref)) ?? 0) + 1)
  const gilt = (id, feld) => Grenzen.grenzeAus(ausnahmen.get(id), standard, feld)
  const email = new Map(nutzer.map(u => [String(u._id), u.email]))
  res.json({
    standard,
    texStandard: Grenzen.TEX_STANDARD,
    nutzer: nutzer.map(u => {
      const id = String(u._id)
      const eigene = ausnahmen.get(id) ?? {}
      return {
        id,
        email: u.email,
        name: [u.first_name, u.last_name].filter(Boolean).join(' '),
        projekte: anzahl.get(id) ?? 0,
        grenze: gilt(id, 'projekte'),
        ausnahme: { projekte: eigene.projekte, speicherGb: eigene.speicherGb },
      }
    }),
    // Je Projekt eine Anfrage an history-v1; begrenzt, damit die Übersicht den Dienst nicht flutet.
    projekte: await promiseMapWithLimit(5, projekte, async p => ({
      id: String(p._id),
      name: p.name,
      eigentuemer: email.get(String(p.owner_ref)) ?? '',
      bytes: await Speicher.stand(p._id),
      grenze: Grenzen.gbZuBytes(gilt(String(p.owner_ref), 'speicherGb')),
    })),
  })
})

export const standardSetzen = mitProblemen(async (req, res) => {
  const body = req.body ?? {}
  const allgemein = felderLesen(body, ['projekte', 'speicherGb'], Grenzen.wertLesen)
  const tex = felderLesen(body, Grenzen.TEX_FELDER, Grenzen.texWertLesen)
  const fehler = { ...allgemein.fehler, ...tex.fehler }
  if (Object.keys(fehler).length) return res.status(422).json({ fehler })
  await Grenzen.standardSetzen({ ...allgemein.werte, ...tex.werte, texPaketeAus: body.texPaketeAus === true })
  res.sendStatus(204)
})

// Je Feld: '' = Standard, 'unbegrenzt' = ausdrücklich unbegrenzt, sonst eine Zahl.
export const nutzerSetzen = mitProblemen(async (req, res) => {
  if (!ObjectId.isValid(req.params.user_id) || !(await db.users.findOne({ _id: new ObjectId(req.params.user_id) }))) {
    throw new Problem(404, 'nutzer_fehlt', 'spur_fehler_nutzer_fehlt')
  }
  const { werte, fehler } = felderLesen(req.body ?? {}, ['projekte', 'speicherGb'], (wert, feld) => {
    if (wert === undefined || wert === null || String(wert).trim() === '') return undefined
    if (wert === 'unbegrenzt') return null
    return Grenzen.wertLesen(wert, feld)
  })
  if (Object.keys(fehler).length) return res.status(422).json({ fehler })
  await Grenzen.ausnahmeSetzen(req.params.user_id, werte)
  res.sendStatus(204)
})

export const neuBerechnen = mitProblemen(async (req, res) => {
  res.json({ bytes: await Speicher.neuBerechnen(projektId(req), dateiPfad) })
})

export const meineProjekte = mitProblemen(async (req, res) => {
  res.json(await Grenzen.projektStand(menschId(req)))
})

export const projektSpeicher = mitProblemen(async (req, res) => {
  res.json(await Speicher.info(projektId(req)))
})
