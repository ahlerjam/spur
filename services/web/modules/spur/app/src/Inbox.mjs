import { setTimeout as warten } from 'node:timers/promises'
import { ObjectId } from '../../../../app/src/infrastructure/mongodb.mjs'
import { ereignisse, herzschlaege, nachrichten } from './sammlungen.mjs'
import { jetzt } from './schalter.mjs'

const VERBUNDEN_MS = 60 * 1000
const TAKT_MS = 1000
const HERZSCHLAG_MS = 5000

export const FORTSCHRITT_MS = 30 * 1000

export async function auftragAnlegen({ projectId, botId, menschId, text }) {
  const nachricht = {
    projectId,
    botId,
    von: 'mensch',
    menschId,
    text,
    am: jetzt(),
  }
  await (await nachrichten()).insertOne(nachricht)
  const ereignis = {
    botId,
    projectId,
    typ: 'task_created',
    daten: { text, nachricht_id: nachricht._id },
    am: jetzt(),
    zugestellt: false,
  }
  await (await ereignisse()).insertOne(ereignis)
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
    .sort({ am: 1 })
    .limit(200)
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
    await warten(TAKT_MS, undefined, { signal }).catch(() => {})
  }
  return null
}
