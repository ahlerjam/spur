import { promiseMapWithLimit } from '@overleaf/promise-utils'
import DocumentUpdaterHandler from '../../../../../app/src/Features/DocumentUpdater/DocumentUpdaterHandler.mjs'
import ProjectLocator from '../../../../../app/src/Features/Project/ProjectLocator.mjs'
import Errors from '../../../../../app/src/Features/Errors/Errors.js'
import { ObjectId } from '../../../../../app/src/infrastructure/mongodb.mjs'
import { Problem } from '../probleme.mjs'
import { einstellungen, laeufe } from '../sammlungen.mjs'
import * as LaufManager from './LaufManager.mjs'
import { spurUpdate } from './spurUpdate.mjs'
import { umkehrOps } from './ops.mjs'

async function pfadVon(projectId, docId) {
  try {
    const { path } = await ProjectLocator.promises.findElement({
      project_id: projectId,
      element_id: docId,
      type: 'doc',
    })
    return path.fileSystem.replace(/^\//, '')
  } catch (error) {
    if (error instanceof Errors.NotFoundError) return null
    throw error
  }
}

// Changes eines Laufs: vom Bot, in der Laufzeit. Autor und Zeit bleiben erhalten, wenn jemand
// in einen Einschub tippt und ihn dadurch teilt; die Change-ID nicht.
function gehoertZumLauf(change, lauf) {
  const zeit = new Date(change.metadata?.ts)
  return (
    change.metadata?.user_id === String(lauf.botId) &&
    zeit >= lauf.gestartet &&
    (!lauf.beendet || zeit <= lauf.beendet)
  )
}

export async function aenderungen(projectId, lauf) {
  return await promiseMapWithLimit(5, lauf.docs, async docId => {
    const pfad = await pfadVon(projectId, docId)
    if (!pfad) return { docId, pfad: null, geloescht: true, changes: [], text: '' }
    const { lines, version, ranges } = await DocumentUpdaterHandler.promises.getDocument(
      projectId,
      docId,
      -1
    )
    const changes = (ranges?.changes ?? []).filter(c => gehoertZumLauf(c, lauf))
    return { docId, pfad, geloescht: false, changes, version, text: lines.join('\n') }
  })
}

export function fuerKarte(liste) {
  return liste.flatMap(d =>
    d.geloescht
      ? [{ docId: d.docId, geloescht: true }]
      : d.changes.map(c => ({
          id: c.id,
          docId: d.docId,
          pfad: d.pfad,
          art: c.op.i !== undefined ? 'einfuegung' : 'loeschung',
          text: (c.op.i ?? c.op.d).slice(0, 200),
          zeile: d.text.slice(0, c.op.p).split('\n').length,
        }))
  )
}

export async function laufHolen(projectId, laufId, botId) {
  const fehlt = () => new Problem(404, 'lauf_fehlt', 'Diesen Lauf gibt es nicht.')
  if (!ObjectId.isValid(laufId)) throw fehlt()
  const filter = { _id: new ObjectId(laufId), projectId }
  if (botId) filter.botId = botId
  const lauf = await (await laeufe()).findOne(filter)
  if (!lauf) throw fehlt()
  return lauf
}

async function statusSetzen(lauf, status) {
  await (await laeufe()).updateOne({ _id: lauf._id }, { $set: { status } })
}

export async function annehmen(projectId, lauf, userId, nurIds) {
  const liste = await aenderungen(projectId, lauf)
  const angenommen = []
  for (const d of liste) {
    const ids = d.changes.map(c => c.id).filter(id => !nurIds || nurIds.includes(id))
    if (!ids.length) continue
    await DocumentUpdaterHandler.promises.acceptChanges(projectId, d.docId, ids, userId)
    for (const c of d.changes.filter(c => ids.includes(c.id))) {
      angenommen.push({ docId: d.docId, op: c.op })
    }
  }
  const rest = liste.reduce((n, d) => n + d.changes.length, 0) - angenommen.length
  await (await laeufe()).updateOne(
    { _id: lauf._id },
    {
      $push: { angenommen: { $each: angenommen } },
      ...(rest === 0 ? { $set: { status: 'angenommen' } } : {}),
    }
  )
  return { angenommen: angenommen.length, rest }
}

export async function ablehnen(projectId, lauf, userId, nurIds) {
  const liste = await aenderungen(projectId, lauf)
  let abgelehnt = 0
  for (const d of liste) {
    const changes = d.changes.filter(c => !nurIds || nurIds.includes(c.id))
    if (!changes.length) continue
    await spurUpdate(projectId, d.docId, umkehrOps(changes), d.version, { userId })
    abgelehnt += changes.length
  }
  const rest = liste.reduce((n, d) => n + d.changes.length, 0) - abgelehnt
  if (rest === 0) await statusSetzen(lauf, 'abgelehnt')
  return { abgelehnt, rest }
}

// Rücknahme eines angenommenen Laufs als neue Track Changes; bei Überschneidung nichts ändern.
export async function zuruecknehmen(projectId, lauf, userId) {
  if (lauf.status !== 'angenommen') {
    throw new Problem(409, 'nicht_angenommen', 'Nur angenommene Läufe lassen sich zurücknehmen.')
  }
  const plan = []
  for (const docId of [...new Set(lauf.angenommen.map(a => a.docId))]) {
    const { lines, version } = await DocumentUpdaterHandler.promises.getDocument(projectId, docId, -1)
    const text = lines.join('\n')
    const ops = lauf.angenommen.filter(a => a.docId === docId).map(a => a.op)
    for (const op of ops) {
      const passt =
        op.i === undefined || text.slice(op.p, op.p + op.i.length) === op.i
      if (!passt) {
        const zeile = text.slice(0, op.p).split('\n').length
        throw new Problem(
          409,
          'konflikt',
          `Konflikt in Zeile ${zeile}: Der Text wurde nach der Annahme geändert. Es wurde nichts zurückgenommen.`
        )
      }
    }
    plan.push({ docId, version, ops: umkehrOps(ops.map(op => ({ op }))).map(({ u, ...op }) => op) })
  }
  for (const { docId, version, ops } of plan) {
    await spurUpdate(projectId, docId, ops, version, { userId, tracked: true })
  }
  await statusSetzen(lauf, 'zurueckgenommen')
}

export async function automatik(projectId, userId) {
  const eintrag = await (await einstellungen()).findOne({ projectId, userId })
  return Boolean(eintrag?.autoAnnehmen)
}

export async function automatikSetzen(projectId, userId, an) {
  await (await einstellungen()).updateOne(
    { projectId, userId },
    { $set: { autoAnnehmen: an } },
    { upsert: true }
  )
}

// Sammelannahme am Laufende, nur ohne rote Status und nur, wenn der Mensch sie im Browser eingeschaltet hat.
export async function nachLaufende(projectId, lauf, menschId) {
  if (lauf.rot.length || !(await automatik(projectId, menschId))) return
  await annehmen(projectId, lauf, menschId)
}

export async function laufDaten(projectId, lauf) {
  if (!lauf) return { lauf: null, aenderungen: [] }
  const liste = lauf.status === 'offen' || lauf.status === 'fertig' ? await aenderungen(projectId, lauf) : []
  return { lauf: LaufManager.laufFuerClient(lauf), aenderungen: fuerKarte(liste) }
}
