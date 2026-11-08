import logger from '@overleaf/logger'
import mongodb from 'mongodb-legacy'
import { ObjectId } from '../../../../../app/src/infrastructure/mongodb.mjs'
import { Problem } from '../probleme.mjs'
import { jobs, quellen, quellenSeiten } from '../sammlungen.mjs'
import { jetzt, semantikAn } from '../schalter.mjs'
import { aehnlichkeit, einbetten } from './einbetten.mjs'

const { Binary } = mongodb
const TREFFER = 10
const AUSZUG = 240
// Ein Job, der so lange „läuft“, ist mit seinem Prozess gestorben.
const JOB_MAX_MS = 30 * 60 * 1000
const laufend = projectId => ({ projectId, art: 'semantik', status: 'laeuft', angelegtAm: { $gt: new Date(jetzt() - JOB_MAX_MS) } })

// Mongo liefert den Puffer an beliebigem Versatz; Float32Array braucht ihn auf 4 Byte ausgerichtet.
const ausBinaer = binaer => new Float32Array(Uint8Array.from(binaer.buffer).buffer)
const alsBinaer = vektor => new Binary(Buffer.from(vektor.buffer, vektor.byteOffset, vektor.byteLength))

function pruefeAn() {
  if (!semantikAn()) throw new Problem(404, 'semantik_aus', 'Die semantische Suche ist auf dieser Installation aus.')
}

const mitText = projectId => ({ projectId, text: { $regex: '\\S' } })

export async function stand(projectId) {
  if (!semantikAn()) return { an: false }
  const seiten = await quellenSeiten()
  const [gesamt, indexiert, job] = await Promise.all([
    seiten.countDocuments(mitText(projectId)),
    seiten.countDocuments({ ...mitText(projectId), vektor: { $exists: true } }),
    (await jobs()).findOne({ projectId, art: 'semantik' }, { sort: { angelegtAm: -1 } }),
  ])
  const laeuft = job?.status === 'laeuft' && jetzt() - job.angelegtAm < JOB_MAX_MS
  return { an: true, gesamt, indexiert, laeuft, fehlgeschlagen: job?.status === 'fehlgeschlagen' }
}

async function abarbeiten(job) {
  const seiten = await quellenSeiten()
  const offen = await seiten
    .find({ ...mitText(job.projectId), vektor: { $exists: false } }, { projection: { text: 1 } })
    .toArray()
  for (const seite of offen) {
    const vektor = await einbetten(seite.text, 'passage')
    await seiten.updateOne({ _id: seite._id }, { $set: { vektor: alsBinaer(vektor) } })
  }
}

// Ein Indexlauf je Projekt; ein zweiter Aufruf liefert den laufenden Job.
export async function indexieren(projectId) {
  pruefeAn()
  const sammlung = await jobs()
  const offen = await sammlung.findOne(laufend(projectId))
  if (offen) return { job_id: offen._id }
  const job = { _id: new ObjectId(), projectId, art: 'semantik', status: 'laeuft', angelegtAm: jetzt() }
  await sammlung.insertOne(job)
  const ende = abarbeiten(job)
    .then(() => sammlung.updateOne({ _id: job._id }, { $set: { status: 'fertig', fertigAm: jetzt() } }))
    .catch(error => {
      logger.error({ err: error, projectId }, 'spur: Indexieren fehlgeschlagen')
      return sammlung.updateOne(
        { _id: job._id },
        { $set: { status: 'fehlgeschlagen', fehler: 'Das Indexieren ist fehlgeschlagen. Bitte erneut starten.' } }
      )
    })
  return { job_id: job._id, ende }
}

// Brute Force über alle Seitenvektoren des Projekts. Treffer sind Fundstellen, nie ein Prüfbeleg.
export async function suchen(projectId, anfrage) {
  pruefeAn()
  const text = String(anfrage ?? '').trim()
  if (!text) throw new Problem(400, 'anfrage_fehlt', 'Bitte beschreiben Sie, was Sie suchen.')
  const frage = await einbetten(text.slice(0, 1000), 'query')
  const seiten = await (await quellenSeiten())
    .find({ projectId, vektor: { $exists: true } }, { projection: { quelleId: 1, seite: 1, label: 1, text: 1, vektor: 1 } })
    .toArray()
  const beste = seiten
    .map(s => ({ s, wert: aehnlichkeit(frage, ausBinaer(s.vektor)) }))
    .sort((a, b) => b.wert - a.wert)
    .slice(0, TREFFER)
  const namen = new Map(
    (await (await quellen()).find({ _id: { $in: beste.map(b => b.s.quelleId) } }, { projection: { dateiname: 1 } }).toArray()).map(
      q => [String(q._id), q.dateiname]
    )
  )
  return beste.map(({ s, wert }) => ({
    quelleId: s.quelleId,
    dateiname: namen.get(String(s.quelleId)) ?? '',
    seite: s.seite,
    label: s.label,
    auszug: s.text.replace(/\s+/g, ' ').trim().slice(0, AUSZUG),
    aehnlichkeit: Math.round(wert * 100) / 100,
  }))
}
