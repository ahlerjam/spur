import { randomBytes } from 'node:crypto'
import Settings from '@overleaf/settings'
import { fetchJson } from '@overleaf/fetch-utils'
import HistoryManager from '../../../../../app/src/Features/History/HistoryManager.mjs'
import { laeufe } from '../sammlungen.mjs'
import { jetzt } from '../schalter.mjs'

const HISTORY = () => Settings.apis.project_history.url

// Vor dem ersten Schreiben eines Laufs: Label als letzter Ausweg für die Wiederherstellung.
async function labelSetzen(projectId, botId) {
  await HistoryManager.promises.flushProject(projectId)
  const { version } = await fetchJson(`${HISTORY()}/project/${projectId}/version`)
  const label = await fetchJson(`${HISTORY()}/project/${projectId}/labels`, {
    method: 'POST',
    json: { comment: 'Claude: Lauf', version, user_id: String(botId) },
  })
  return label.id ?? null
}

export async function offenerLauf(projectId, botId) {
  return await (await laeufe()).findOne(
    { projectId, botId, status: 'offen' },
    { sort: { _id: -1 } }
  )
}

export async function laufFuerSchreiben(projectId, botId) {
  const vorhanden = await offenerLauf(projectId, botId)
  if (vorhanden) return vorhanden
  const lauf = {
    projectId,
    botId,
    status: 'offen',
    gestartet: jetzt(),
    labelId: await labelSetzen(projectId, botId),
    seeds: [],
    docs: [],
    aenderungen: 0,
    rot: [],
    zusammenfassung: null,
  }
  const { insertedId } = await (await laeufe()).insertOne(lauf)
  return { ...lauf, _id: insertedId }
}

export function neuerSeed() {
  return randomBytes(9).toString('hex')
}

export async function aenderungMerken(lauf, { seed, docId, rot }) {
  await (await laeufe()).updateOne(
    { _id: lauf._id },
    {
      $push: { seeds: seed, ...(rot.length ? { rot: { $each: rot } } : {}) },
      $addToSet: { docs: docId },
      $inc: { aenderungen: 1 },
    }
  )
}

export async function letzterLauf(projectId, botId) {
  return await (await laeufe()).findOne({ projectId, botId }, { sort: { _id: -1 } })
}

export async function beenden(lauf, zusammenfassung) {
  await (await laeufe()).updateOne(
    { _id: lauf._id },
    { $set: { status: 'fertig', zusammenfassung, beendet: jetzt() } }
  )
}

export function laufFuerClient(lauf) {
  return lauf && {
    id: lauf._id,
    status: lauf.status,
    gestartet: lauf.gestartet,
    beendet: lauf.beendet ?? null,
    dateien: lauf.docs.length,
    aenderungen: lauf.aenderungen,
    rot: lauf.rot,
    zusammenfassung: lauf.zusammenfassung,
  }
}
