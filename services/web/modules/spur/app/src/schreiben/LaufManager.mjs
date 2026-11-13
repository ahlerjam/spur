import Settings from '@overleaf/settings'
import { fetchJson } from '@overleaf/fetch-utils'
import HistoryManager from '../../../../../app/src/Features/History/HistoryManager.mjs'
import { ObjectId } from '../../../../../app/src/infrastructure/mongodb.mjs'
import { laeufe } from '../sammlungen.mjs'
import { jetzt } from '../schalter.mjs'

const HISTORY = () => Settings.apis.project_history.url

// Vor dem ersten Schreiben eines Laufs: Label als letzter Ausweg für die Wiederherstellung.
async function labelSetzen(projectId, botId) {
  await HistoryManager.promises.flushProject(projectId)
  const { version } = await fetchJson(`${HISTORY()}/project/${projectId}/version`)
  await fetchJson(`${HISTORY()}/project/${projectId}/labels`, {
    method: 'POST',
    json: { comment: 'Claude: Lauf', version, user_id: String(botId) },
  })
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
  await labelSetzen(projectId, botId)
  const lauf = {
    projectId,
    botId,
    status: 'offen',
    gestartet: jetzt(),
    docs: [],
    aenderungen: 0,
    rot: [],
    zusammenfassung: null,
  }
  try {
    const { insertedId } = await (await laeufe()).insertOne(lauf)
    return { ...lauf, _id: insertedId }
  } catch (error) {
    // Ein gleichzeitiger doc_edit hat den Lauf schon angelegt (eindeutiger Index auf offene Läufe).
    if (error.code !== 11000) throw error
    return await offenerLauf(projectId, botId)
  }
}

export async function aenderungMerken(lauf, { docId, rot, zahlen = [] }) {
  const neu = { ...(rot.length && { rot: { $each: rot } }), ...(zahlen.length && { zahlen: { $each: zahlen } }) }
  await (await laeufe()).updateOne(
    { _id: lauf._id },
    {
      ...(Object.keys(neu).length ? { $push: neu } : {}),
      $addToSet: { docs: docId },
      $inc: { aenderungen: 1 },
    }
  )
}

// Changes mit rotem Zitat: Weder der Schalter noch „Alles Offene jetzt annehmen“ nimmt sie an. Die Zeit bleibt
// auch erhalten, wenn jemand in den Einschub tippt und ihn in Stücke mit neuen IDs teilt.
export async function rotMerken(lauf, changes) {
  if (!changes.length) return
  await (await laeufe()).updateOne(
    { _id: lauf._id },
    {
      $addToSet: {
        rotAenderungen: { $each: changes.map(c => c.id) },
        rotZeiten: { $each: changes.map(c => c.metadata?.ts).filter(Boolean).map(String) },
      },
    }
  )
}

// Was ein Lauf außerhalb der Dokumente anlegt (Dateien, Ordner, Quellen); „Lauf rückgängig“ entfernt es.
export async function angelegtMerken(lauf, eintraege) {
  await (await laeufe()).updateOne({ _id: lauf._id }, { $push: { angelegt: { $each: eintraege } } })
}

export async function letzterLauf(projectId, botId) {
  return await (await laeufe()).findOne({ projectId, botId }, { sort: { _id: -1 } })
}

const LAEUFE_SEITE = 20

// Die letzten 20 Läufe, neueste zuerst; `vor` (Lauf-ID) lädt die nächsten 20 älteren.
export async function laeufeListe(projectId, botId, { vor } = {}) {
  const filter = { projectId, botId, ...(ObjectId.isValid(vor) && { _id: { $lt: new ObjectId(vor) } }) }
  const liste = await (await laeufe()).find(filter).sort({ _id: -1 }).limit(LAEUFE_SEITE + 1).toArray()
  return { laeufe: liste.slice(0, LAEUFE_SEITE), weitere: liste.length > LAEUFE_SEITE }
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
    zahlen: lauf.zahlen ?? [],
    zusammenfassung: lauf.zusammenfassung,
    angelegt: (lauf.angelegt ?? []).map(({ art, pfad, name }) => ({ art, pfad, name })),
    rotAenderungen: lauf.rotAenderungen ?? [],
    automatisch: (lauf.angenommen ?? [])
      .filter(a => a.automatisch)
      .map(({ pfad, zeile, op }) => ({
        pfad,
        zeile,
        art: op.i !== undefined ? 'einfuegung' : 'loeschung',
        text: (op.i ?? op.d).slice(0, 200),
      })),
  }
}
