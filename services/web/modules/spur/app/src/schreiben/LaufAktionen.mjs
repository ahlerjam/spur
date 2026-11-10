import { promiseMapWithLimit } from '@overleaf/promise-utils'
import EditorController from '../../../../../app/src/Features/Editor/EditorController.mjs'
import EditorRealTimeController from '../../../../../app/src/Features/Editor/EditorRealTimeController.mjs'
import DocumentUpdaterHandler from '../../../../../app/src/Features/DocumentUpdater/DocumentUpdaterHandler.mjs'
import ProjectLocator from '../../../../../app/src/Features/Project/ProjectLocator.mjs'
import Errors from '../../../../../app/src/Features/Errors/Errors.js'
import { ObjectId } from '../../../../../app/src/infrastructure/mongodb.mjs'
import { Problem } from '../probleme.mjs'
import { einstellungen, laeufe, quellen } from '../sammlungen.mjs'
import * as QuellenManager from '../QuellenManager.mjs'
import * as LaufManager from './LaufManager.mjs'
import { spurUpdate } from './spurUpdate.mjs'
import { rolleFuerClaude } from '../rechte.mjs'
import { heutigePosition, kontextUm, umkehrOps } from './ops.mjs'
import { paketEntfernt } from '../kompilieren/TexPakete.mjs'

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
          // Die Ops liegen auf Wortgrenzen (opsFuer), der Text beginnt also nie mitten im Wort.
          text: (c.op.i ?? c.op.d).slice(0, 200),
          zeile: d.text.slice(0, c.op.p).split('\n').length,
        }))
  )
}

export async function laufHolen(projectId, laufId, botId) {
  const fehlt = () => new Problem(404, 'lauf_fehlt', 'spur_fehler_lauf_fehlt')
  if (!ObjectId.isValid(laufId)) throw fehlt()
  const filter = { _id: new ObjectId(laufId), projectId }
  if (botId) filter.botId = botId
  const lauf = await (await laeufe()).findOne(filter)
  if (!lauf) throw fehlt()
  return lauf
}

// Abgeschlossene Läufe (etwa aus einem veralteten Tab) dürfen ihren Status nicht mehr wechseln.
function mussOffenSein(lauf) {
  if (lauf.status !== 'offen' && lauf.status !== 'fertig') {
    throw new Problem(409, 'lauf_abgeschlossen', 'spur_fehler_lauf_abgeschlossen')
  }
}

// Tippt jemand in einen Einschub, zerfällt er in mehrere Changes mit gleichem Zeitstempel.
// Abgelehnt wird immer der ganze Einschub.
function mitGanzenEinschueben(changes, nurIds) {
  if (!nurIds) return changes
  const zeiten = new Set(changes.filter(c => nurIds.includes(c.id)).map(c => c.metadata?.ts))
  return changes.filter(c => zeiten.has(c.metadata?.ts))
}

async function statusSetzen(lauf, status) {
  await (await laeufe()).updateOne({ _id: lauf._id }, { $set: { status } })
}

// Entfernt, was der Lauf außerhalb der Dokumente angelegt hat. Von Hand schon Gelöschtes wird übergangen.
async function angelegtEntfernen(projectId, lauf, userId) {
  for (const eintrag of lauf.angelegt ?? []) {
    if (eintrag.art === 'quelle') {
      const quelle = await (await quellen()).findOne({ _id: eintrag.quelleId, projectId })
      if (quelle) await QuellenManager.loeschen(quelle)
      continue
    }
    try {
      await EditorController.promises.deleteEntityWithPath(projectId, `/${eintrag.pfad}`, 'spur', userId)
    } catch (error) {
      if (!(error instanceof Errors.NotFoundError)) throw error
    }
    if (eintrag.paket) await paketEntfernt(projectId, eintrag.paket)
  }
  await (await laeufe()).updateOne({ _id: lauf._id }, { $set: { angelegt: [] } })
}

export async function annehmen(projectId, lauf, userId, nurIds) {
  mussOffenSein(lauf)
  const liste = await aenderungen(projectId, lauf)
  const angenommen = []
  for (const d of liste) {
    // Wie beim Ablehnen: ein gespaltener Einschub wird ganz angenommen, sonst blieben Restmarken.
    const ids = mitGanzenEinschueben(d.changes, nurIds).map(c => c.id)
    if (!ids.length) continue
    await DocumentUpdaterHandler.promises.acceptChanges(projectId, d.docId, ids, userId)
    // Wie TrackChangesController: offene Editoren entfernen die Marken sofort.
    EditorRealTimeController.emitToRoom(projectId, 'accept-changes', d.docId, ids)
    for (const c of d.changes.filter(c => ids.includes(c.id))) {
      angenommen.push({ docId: d.docId, op: c.op, ...kontextUm(d.text, c.op) })
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
  mussOffenSein(lauf)
  const liste = await aenderungen(projectId, lauf)
  let abgelehnt = 0
  for (const d of liste) {
    const changes = mitGanzenEinschueben(d.changes, nurIds)
    if (!changes.length) continue
    await spurUpdate(projectId, d.docId, umkehrOps(changes), d.version, { userId })
    abgelehnt += changes.length
  }
  const rest = liste.reduce((n, d) => n + d.changes.length, 0) - abgelehnt
  if (!nurIds) await angelegtEntfernen(projectId, lauf, userId)
  if (rest === 0) await statusSetzen(lauf, 'abgelehnt')
  return { abgelehnt, rest }
}

function konflikt(text, p) {
  const zeile = text.slice(0, Math.min(p, text.length)).split('\n').length
  return new Problem(
    409,
    'konflikt',
    'spur_fehler_rueckname_konflikt', { zeile }
  )
}

// Rücknahme eines angenommenen Laufs als neue Track Changes; bei Überschneidung nichts ändern.
export async function zuruecknehmen(projectId, lauf, userId) {
  // Ein noch nicht angenommener Lauf mit angelegten Dateien: Changes ablehnen und das Angelegte entfernen.
  if ((lauf.status === 'offen' || lauf.status === 'fertig') && lauf.angelegt?.length) {
    await ablehnen(projectId, lauf, userId)
    await statusSetzen(lauf, 'zurueckgenommen')
    return
  }
  if (lauf.status !== 'angenommen') {
    throw new Problem(409, 'nicht_angenommen', 'spur_fehler_nicht_angenommen')
  }
  const plan = []
  for (const docId of [...new Set(lauf.angenommen.map(a => a.docId))]) {
    const { lines, version } = await DocumentUpdaterHandler.promises.getDocument(projectId, docId, -1)
    const text = lines.join('\n')
    const ops = []
    for (const eintrag of lauf.angenommen.filter(a => a.docId === docId)) {
      // Ohne gespeicherten Kontext lässt sich die Stelle nicht sicher finden: lieber Konflikt.
      const p = eintrag.vor === undefined ? null : heutigePosition(text, eintrag)
      if (p === null) throw konflikt(text, eintrag.op.p)
      ops.push({ ...eintrag.op, p })
    }
    plan.push({ docId, version, ops: umkehrOps(ops.map(op => ({ op }))).map(({ u, ...op }) => op) })
  }
  for (const { docId, version, ops } of plan) {
    await spurUpdate(projectId, docId, ops, version, { userId, tracked: true })
  }
  await angelegtEntfernen(projectId, lauf, userId)
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

// Sammelannahme am Laufende, nur ohne rote Status und Zahlen ohne Beleg und nur, wenn der Mensch sie im Browser eingeschaltet hat.
export async function nachLaufende(projectId, lauf, menschId) {
  if (lauf.rot.length || lauf.zahlen?.length || !(await automatik(projectId, menschId))) return
  // Die Einstellung überdauert eine Herabstufung; annehmen darf nur, wer jetzt schreiben darf.
  if (!['readAndWrite', 'owner'].includes(await rolleFuerClaude(menschId, projectId))) return
  await annehmen(projectId, lauf, menschId)
}

export async function laufDaten(projectId, lauf) {
  if (!lauf) return { lauf: null, aenderungen: [] }
  const liste = lauf.status === 'offen' || lauf.status === 'fertig' ? await aenderungen(projectId, lauf) : []
  return { lauf: LaufManager.laufFuerClient(lauf), aenderungen: fuerKarte(liste) }
}
