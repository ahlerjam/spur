import Settings from '@overleaf/settings'
import { fetchJson } from '@overleaf/fetch-utils'
import DocumentUpdaterHandler from '../../../../../app/src/Features/DocumentUpdater/DocumentUpdaterHandler.mjs'
import ProjectLocator from '../../../../../app/src/Features/Project/ProjectLocator.mjs'
import { ObjectId } from '../../../../../app/src/infrastructure/mongodb.mjs'
import { Problem } from '../probleme.mjs'
import { einstellungen, laeufe } from '../sammlungen.mjs'
import * as LaufManager from './LaufManager.mjs'
import { umkehrOps } from './ops.mjs'

async function pfadVon(projectId, docId) {
  try {
    const { path } = await ProjectLocator.promises.findElement({
      project_id: projectId,
      element_id: docId,
      type: 'doc',
    })
    return path.fileSystem.replace(/^\//, '')
  } catch {
    return null
  }
}

// Changes eines Laufs erkennt man am Seed, den doc_edit als tc mitgeschickt hat.
export async function aenderungen(projectId, lauf) {
  const ergebnis = []
  for (const docId of lauf.docs) {
    const pfad = await pfadVon(projectId, docId)
    if (!pfad) {
      ergebnis.push({ docId, pfad: null, geloescht: true, changes: [], text: '' })
      continue
    }
    const { lines, version, ranges } = await DocumentUpdaterHandler.promises.getDocument(
      projectId,
      docId,
      -1
    )
    const changes = (ranges?.changes ?? []).filter(c =>
      lauf.seeds.some(seed => c.id.startsWith(seed))
    )
    ergebnis.push({ docId, pfad, geloescht: false, changes, version, text: lines.join('\n') })
  }
  return ergebnis
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

async function laufHolen(projectId, laufId, botId) {
  const filter = { _id: new ObjectId(laufId), projectId }
  if (botId) filter.botId = botId
  const lauf = ObjectId.isValid(laufId) && (await (await laeufe()).findOne(filter))
  if (!lauf) throw new Problem(404, 'lauf_fehlt', 'Diesen Lauf gibt es nicht.')
  return lauf
}

export { laufHolen }

async function anwenden(projectId, docId, op, version, meta) {
  await fetchJson(
    `${Settings.apis.documentupdater.url}/project/${projectId}/doc/${docId}/spur-update`,
    { method: 'POST', json: { op, v: version, meta: { source: 'spur', ...meta } } }
  )
}

async function statusSetzen(lauf, status, felder = {}) {
  await (await laeufe()).updateOne({ _id: lauf._id }, { $set: { status, ...felder } })
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
    await anwenden(projectId, d.docId, umkehrOps(changes), d.version, { user_id: String(userId) })
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
    await anwenden(projectId, docId, ops, version, {
      user_id: String(userId),
      tc: LaufManager.neuerSeed(),
    })
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
