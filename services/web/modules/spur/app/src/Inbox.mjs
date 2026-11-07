import { EventEmitter, once } from 'node:events'
import { ObjectId } from '../../../../app/src/infrastructure/mongodb.mjs'
import { ereignisse, herzschlaege, nachrichten } from './sammlungen.mjs'
import { jetzt } from './schalter.mjs'

// Wecker im selben Prozess; der Takt fängt Ereignisse aus anderen Prozessen auf.
const wecker = new EventEmitter()
wecker.setMaxListeners(0)

const TAKT_MS = 5000
const HERZSCHLAG_MS = 5000
const VERBUNDEN_MS = 45 * 1000
const FORTSCHRITT_MS = 30 * 1000

export async function auftragAnlegen({ projectId, botId, text }) {
  const nachricht = { projectId, botId, von: 'mensch', text, am: jetzt() }
  await (await nachrichten()).insertOne(nachricht)
  await (await ereignisse()).insertOne({
    botId,
    projectId,
    typ: 'task_created',
    daten: { text, nachricht_id: nachricht._id },
    am: jetzt(),
    zugestellt: false,
  })
  wecker.emit(String(botId))
  return nachricht
}

export async function antwortSpeichern({ projectId, botId, text }) {
  const nachricht = { projectId, botId, von: 'claude', text, am: jetzt() }
  await (await nachrichten()).insertOne(nachricht)
  return nachricht
}

export async function verlauf(projectId, botId) {
  return await (await nachrichten())
    .find({ projectId, botId })
    .sort({ _id: -1 })
    .limit(100)
    .toArray()
}

const fuerClient = e => ({
  id: e._id,
  typ: e.typ,
  project_id: e.projectId,
  daten: e.daten,
  am: e.am,
})

export async function seit(botId, cursor) {
  const filter = { botId }
  if (cursor && ObjectId.isValid(cursor)) filter._id = { $gt: new ObjectId(cursor) }
  const liste = await (await ereignisse()).find(filter).sort({ _id: 1 }).limit(100).toArray()
  return {
    ereignisse: liste.map(fuerClient),
    cursor: liste.at(-1)?._id ?? cursor ?? null,
  }
}

async function herzschlag(botId) {
  await (await herzschlaege()).updateOne(
    { _id: botId },
    { $set: { zuletzt: jetzt() } },
    { upsert: true }
  )
}

export async function verbunden(botId) {
  const eintrag = await (await herzschlaege()).findOne({ _id: botId })
  return Boolean(eintrag && jetzt() - eintrag.zuletzt < VERBUNDEN_MS)
}

function bisWeckerOderTakt(botId, ms, signal) {
  const abbruch = new AbortController()
  const ende = () => abbruch.abort()
  signal?.addEventListener('abort', ende, { once: true })
  const zeit = setTimeout(ende, ms)
  return once(wecker, String(botId), { signal: abbruch.signal })
    .catch(() => {})
    .finally(() => {
      clearTimeout(zeit)
      signal?.removeEventListener('abort', ende)
    })
}

// Long-Poll: liefert das nächste nicht zugestellte Ereignis des Bots. Laufende Aufrufe sind der Herzschlag.
export async function warteAufEreignis(botId, { signal, maxMs, fortschritt }) {
  const sammlung = await ereignisse()
  const start = Date.now()
  let letzterSchlag = 0
  let letzterFortschritt = start
  while (!signal?.aborted && Date.now() - start < maxMs) {
    if (Date.now() - letzterSchlag >= HERZSCHLAG_MS) {
      await herzschlag(botId)
      letzterSchlag = Date.now()
    }
    const ereignis = await sammlung.findOneAndUpdate(
      { botId, zugestellt: false },
      { $set: { zugestellt: true } },
      { sort: { _id: 1 }, returnDocument: 'after' }
    )
    if (ereignis) return fuerClient(ereignis)
    if (Date.now() - letzterFortschritt >= FORTSCHRITT_MS) {
      letzterFortschritt = Date.now()
      await fortschritt(Math.round((Date.now() - start) / 1000))
    }
    const bisFortschritt = FORTSCHRITT_MS - (Date.now() - letzterFortschritt)
    await bisWeckerOderTakt(botId, Math.max(10, Math.min(TAKT_MS, bisFortschritt)), signal)
  }
  return null
}
