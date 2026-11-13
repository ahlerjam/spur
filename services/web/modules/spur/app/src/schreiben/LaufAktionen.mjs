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

// `automatisch`: vom Schalter direkt nach dem Schreiben; die Karte zeigt diese Changes weiter an.
// Schalter und Sammelannahme lassen einen offenen Lauf offen: Claude schreibt vielleicht weiter, und der nächste
// doc_edit legte sonst einen neuen Lauf an.
export async function annehmen(projectId, lauf, userId, nurIds, { automatisch = false, laufOffenLassen = automatisch } = {}) {
  mussOffenSein(lauf)
  const liste = await aenderungen(projectId, lauf)
  const angenommen = []
  // Ein Stapel teilt sich den Text, aus dem sein Kontext stammt; „Lauf rückgängig“ nimmt Stapel nacheinander zurück.
  const stapel = String(new ObjectId())
  for (const d of liste) {
    // Wie beim Ablehnen: ein gespaltener Einschub wird ganz angenommen, sonst blieben Restmarken.
    const ids = mitGanzenEinschueben(d.changes, nurIds).map(c => c.id)
    if (!ids.length) continue
    await DocumentUpdaterHandler.promises.acceptChanges(projectId, d.docId, ids, userId)
    // Wie TrackChangesController: offene Editoren entfernen die Marken sofort.
    EditorRealTimeController.emitToRoom(projectId, 'accept-changes', d.docId, ids)
    for (const c of d.changes.filter(c => ids.includes(c.id))) {
      angenommen.push({
        docId: d.docId,
        op: c.op,
        ...kontextUm(d.text, c.op),
        stapel,
        ...(automatisch && { automatisch: true, pfad: d.pfad, zeile: d.text.slice(0, c.op.p).split('\n').length }),
      })
    }
  }
  const rest = liste.reduce((n, d) => n + d.changes.length, 0) - angenommen.length
  const fertig = rest === 0 && !(laufOffenLassen && lauf.status === 'offen')
  await (await laeufe()).updateOne(
    { _id: lauf._id },
    {
      $push: { angenommen: { $each: angenommen } },
      ...(fertig ? { $set: { status: 'angenommen' } } : {}),
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
  // Dateien und Quellen löschen darf nur, wer schreiben darf; Reviewer lehnen nur die Changes ab.
  if (!nurIds && ['readAndWrite', 'owner'].includes(await rolleFuerClaude(userId, projectId))) {
    await angelegtEntfernen(projectId, lauf, userId)
  }
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
  const offen = lauf.status === 'offen' || lauf.status === 'fertig'
  // Ein noch nicht angenommener Lauf: offene Changes ablehnen, Angelegtes entfernen und, was Schalter oder
  // Sammelannahme schon angenommen haben, zurücknehmen. Erst ein Probelauf: Ein Konflikt ändert gar nichts.
  if (offen && (lauf.angelegt?.length || lauf.angenommen?.length)) {
    if (lauf.angenommen?.length) await rueckPlan(projectId, lauf, { offeneAbziehen: true })
    await ablehnen(projectId, lauf, userId)
    if (lauf.angenommen?.length) await angenommenesZuruecknehmen(projectId, lauf, userId)
    await statusSetzen(lauf, 'zurueckgenommen')
    return
  }
  if (lauf.status !== 'angenommen') {
    throw new Problem(409, 'nicht_angenommen', 'spur_fehler_nicht_angenommen')
  }
  await angenommenesZuruecknehmen(projectId, lauf, userId)
  await angelegtEntfernen(projectId, lauf, userId)
  await statusSetzen(lauf, 'zurueckgenommen')
}

function opsAnwenden(text, ops) {
  return ops.reduce(
    (t, op) => (op.i !== undefined ? t.slice(0, op.p) + op.i + t.slice(op.p) : t.slice(0, op.p) + t.slice(op.p + op.d.length)),
    text
  )
}

// Aufeinanderfolgende Einträge desselben Stapels; alte Einträge ohne Stapel gelten als einer.
function stapelVon(eintraege) {
  const gruppen = []
  for (const e of eintraege) {
    if (gruppen.length && gruppen.at(-1)[0].stapel === e.stapel) gruppen.at(-1).push(e)
    else gruppen.push([e])
  }
  return gruppen
}

// Der Kontext eines Stapels kann offene Changes enthalten, die beim Zurücknehmen schon herausgerechnet sind
// (oder umgekehrt). Dann mit kürzerem Kontext auf beiden Seiten suchen; bei mehreren Treffern gilt weiter der nächste
// zur alten Stelle.
function positionMitKuerzeremKontext(text, eintrag) {
  for (const laenge of [40, 20, 10]) {
    const p = heutigePosition(text, { ...eintrag, vor: eintrag.vor.slice(-laenge), nach: eintrag.nach.slice(0, laenge) })
    if (p !== null) return p
  }
  return null
}

// Ops, die das Angenommene je Dokument zurücknehmen: der jüngste Stapel zuerst, jeder gegen den Text, aus dem sein
// Kontext stammt. Mit `offeneAbziehen` rechnet der Plan die offenen Changes des Laufs vorher heraus (Probelauf).
async function rueckPlan(projectId, lauf, { offeneAbziehen = false } = {}) {
  const offeneJeDoc = new Map()
  if (offeneAbziehen) {
    for (const d of await aenderungen(projectId, lauf)) offeneJeDoc.set(String(d.docId), d.changes)
  }
  const plan = []
  const docs = new Map(lauf.angenommen.map(a => [String(a.docId), a.docId]))
  for (const [schluessel, docId] of docs) {
    const { lines, version } = await DocumentUpdaterHandler.promises.getDocument(projectId, docId, -1)
    let text = opsAnwenden(lines.join('\n'), umkehrOps(offeneJeDoc.get(schluessel) ?? []))
    const ops = []
    for (const gruppe of stapelVon(lauf.angenommen.filter(a => String(a.docId) === schluessel)).reverse()) {
      const gefunden = []
      for (const eintrag of gruppe) {
        // Ohne gespeicherten Kontext lässt sich die Stelle nicht sicher finden: lieber Konflikt.
        const p = eintrag.vor === undefined ? null : positionMitKuerzeremKontext(text, eintrag)
        if (p === null) throw konflikt(text, eintrag.op.p)
        gefunden.push({ op: { ...eintrag.op, p } })
      }
      const rueck = umkehrOps(gefunden).map(({ u, ...op }) => op)
      text = opsAnwenden(text, rueck)
      ops.push(...rueck)
    }
    plan.push({ docId, version, ops })
  }
  return plan
}

async function angenommenesZuruecknehmen(projectId, lauf, userId) {
  const plan = await rueckPlan(projectId, lauf)
  for (const { docId, version, ops } of plan) {
    await spurUpdate(projectId, docId, ops, version, { userId, tracked: true })
  }
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

// Am Laufende wird nichts nachträglich angenommen (der Schalter wirkt nur beim Schreiben). Hat der Schalter alles
// angenommen, gilt der Lauf als angenommen.
export async function nachLaufende(projectId, lauf) {
  if (!lauf.angenommen?.length) return
  const offen = (await aenderungen(projectId, lauf)).reduce((n, d) => n + d.changes.length, 0)
  if (offen === 0) await statusSetzen(lauf, 'angenommen')
}

const darfSchreiben = async (menschId, projectId) =>
  ['readAndWrite', 'owner'].includes(await rolleFuerClaude(menschId, projectId))

// Schalter an: Changes, die Claude eben geschrieben hat, sofort annehmen. Rote Zitate kommen gar nicht hierher
// (SchreibManager merkt sie am Lauf). Die Einstellung überdauert eine Herabstufung; es zählt das Recht jetzt.
export async function sofortAnnehmen(projectId, lauf, menschId, ids) {
  if (!ids.length || !(await automatik(projectId, menschId))) return
  if (!(await darfSchreiben(menschId, projectId))) return
  await annehmen(projectId, lauf, menschId, ids, { automatisch: true })
}

async function offeneLaeufe(projectId, botId) {
  return await (await laeufe()).find({ projectId, botId, status: { $in: ['offen', 'fertig'] } }).toArray()
}

// Offene Changes je Lauf ohne rote Zitate (die bleiben, bis ein Mensch sie einzeln prüft).
async function offeneOhneRot(projectId, lauf) {
  const rot = new Set(lauf.rotAenderungen ?? [])
  const rotZeiten = new Set(lauf.rotZeiten ?? [])
  const istRot = c => rot.has(c.id) || rotZeiten.has(String(c.metadata?.ts))
  return (await aenderungen(projectId, lauf)).map(d => ({ ...d, changes: d.changes.filter(c => !istRot(c)) }))
}

export async function offenZaehlen(projectId, botId) {
  let anzahl = 0
  const dateien = new Set()
  for (const lauf of await offeneLaeufe(projectId, botId)) {
    for (const d of await offeneOhneRot(projectId, lauf)) {
      anzahl += d.changes.length
      if (d.changes.length) dateien.add(String(d.docId))
    }
  }
  return { aenderungen: anzahl, dateien: dateien.size }
}

// „Alles Offene jetzt annehmen“: alle Läufe des eigenen Bots, rote Zitate bleiben offen.
export async function allesAnnehmen(projectId, botId, menschId) {
  if (!(await darfSchreiben(menschId, projectId))) {
    throw new Problem(403, 'nur_schreibende', 'spur_fehler_nur_schreibende')
  }
  let angenommen = 0
  for (const lauf of await offeneLaeufe(projectId, botId)) {
    const ids = (await offeneOhneRot(projectId, lauf)).flatMap(d => d.changes.map(c => c.id))
    if (!ids.length) continue
    const ergebnis = await annehmen(projectId, lauf, menschId, ids, { laufOffenLassen: true })
    angenommen += ergebnis.angenommen
  }
  return { angenommen }
}

export async function laufDaten(projectId, lauf) {
  if (!lauf) return { lauf: null, aenderungen: [] }
  const liste = lauf.status === 'offen' || lauf.status === 'fertig' ? await aenderungen(projectId, lauf) : []
  return { lauf: LaufManager.laufFuerClient(lauf), aenderungen: fuerKarte(liste) }
}
