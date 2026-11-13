import { EventEmitter } from 'node:events'
import { ObjectId } from '../../../../app/src/infrastructure/mongodb.mjs'
import { ereignisse, herzschlaege, nachrichten } from './sammlungen.mjs'
import { jetzt, testSchalter } from './schalter.mjs'

// Wecker im selben Prozess; der Takt fängt Ereignisse aus anderen Prozessen auf.
const wecker = new EventEmitter()
wecker.setMaxListeners(0)

const TAKT_MS = 5000
const HERZSCHLAG_MS = 5000
const VERBUNDEN_MS = 45 * 1000
const FORTSCHRITT_MS = 30 * 1000
// Unter Claude Codes 120 s, nach denen ein MCP-Aufruf in den Hintergrund wandert.
const STANDARD_WARTEN_S = 100

export function standardWarteSekunden() {
  return Number(testSchalter('SPUR_WARTEN_S')) || STANDARD_WARTEN_S
}

export async function ereignisAnlegen({ projectId, botId, typ, daten }) {
  await (await ereignisse()).insertOne({ botId, projectId, typ, daten, am: jetzt(), zugestellt: false })
  wecker.emit(String(botId))
}

// `anzeige` ersetzt im Chat einen langen Auftragstext (etwa einen Workflow) durch eine kurze Zeile.
export async function auftragAnlegen({ projectId, botId, text, anzeige = text, daten = {} }) {
  const nachricht = { projectId, botId, von: 'mensch', text: anzeige, am: jetzt() }
  await (await nachrichten()).insertOne(nachricht)
  await ereignisAnlegen({
    projectId,
    botId,
    typ: 'task_created',
    daten: { ...daten, text, nachricht_id: nachricht._id },
  })
  return nachricht
}

export async function antwortSpeichern({ projectId, botId, text }) {
  const nachricht = { projectId, botId, von: 'claude', text, am: jetzt() }
  await (await nachrichten()).insertOne(nachricht)
  return nachricht
}

const VERLAUF_GRENZE = 500

// Neueste zuerst; `aeltere` sagt dem Panel, dass es frühere Nachrichten nicht zeigt.
export async function verlauf(projectId, botId) {
  const liste = await (await nachrichten())
    .find({ projectId, botId })
    // Nachrichten kommen aus web (Panel) und web-api (MCP); ObjectIds beider Prozesse sortieren nicht nach Zeit.
    .sort({ am: -1, _id: -1 })
    .limit(VERLAUF_GRENZE + 1)
    .toArray()
  return { nachrichten: liste.slice(0, VERLAUF_GRENZE), aeltere: liste.length > VERLAUF_GRENZE }
}

const fuerClient = e => ({
  id: e._id,
  typ: e.typ,
  project_id: e.projectId,
  daten: e.daten,
  am: e.am,
})

// Mit Cursor die Ereignisse danach, ohne Cursor die neuesten. Was hier gelesen wird, gilt als zugestellt.
export async function seit(botId, cursor) {
  const sammlung = await ereignisse()
  const liste =
    cursor && ObjectId.isValid(cursor)
      ? await sammlung.find({ botId, _id: { $gt: new ObjectId(cursor) } }).sort({ _id: 1 }).limit(100).toArray()
      : (await sammlung.find({ botId }).sort({ _id: -1 }).limit(100).toArray()).reverse()
  const offen = liste.filter(e => !e.zugestellt).map(e => e._id)
  if (offen.length) await sammlung.updateMany({ _id: { $in: offen } }, { $set: { zugestellt: true } })
  return {
    ereignisse: liste.map(fuerClient),
    cursor: liste.at(-1)?._id ?? cursor ?? null,
  }
}

export async function letzterCursor(botId) {
  const [neuestes] = await (await ereignisse()).find({ botId }).sort({ _id: -1 }).limit(1).toArray()
  return neuestes?._id ?? null
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

// Der Wecker hört ab dem Start des Wartens mit: Ein Auftrag, der zwischen Abfrage und Schlaf eintrifft, weckt sofort.
function weckerFuer(botId, signal) {
  let geweckt = false
  let aufwachen = () => {}
  const wecken = () => {
    geweckt = true
    aufwachen()
  }
  wecker.on(String(botId), wecken)
  signal?.addEventListener('abort', wecken, { once: true })
  return {
    vorAbfrage: () => (geweckt = false),
    schlafen: ms =>
      geweckt
        ? Promise.resolve()
        : new Promise(weiter => {
            const zeit = setTimeout(weiter, ms)
            aufwachen = () => {
              clearTimeout(zeit)
              weiter()
            }
          }),
    ende: () => {
      wecker.off(String(botId), wecken)
      signal?.removeEventListener('abort', wecken)
    },
  }
}

// Long-Poll: liefert das nächste nicht zugestellte Ereignis des Bots. Laufende Aufrufe sind der Herzschlag.
// Pro Bot höchstens ein offener Long-Poll: Ein neuer Aufruf beendet den älteren.
const wartende = new Map()

// `abgeloest`: Ein neuerer Aufruf desselben Bots wartet jetzt; dieser endet still.
export async function warteAufEreignis(botId, { signal: aussen, maxMs, fortschritt }) {
  const schluessel = String(botId)
  wartende.get(schluessel)?.abort()
  const eigener = new AbortController()
  wartende.set(schluessel, eigener)
  const signal = aussen ? AbortSignal.any([aussen, eigener.signal]) : eigener.signal
  try {
    const ereignis = await warten(botId, { signal, maxMs, fortschritt })
    return { ereignis, abgeloest: !ereignis && eigener.signal.aborted && !aussen?.aborted }
  } finally {
    if (wartende.get(schluessel) === eigener) wartende.delete(schluessel)
  }
}

async function warten(botId, { signal, maxMs, fortschritt }) {
  const takt = weckerFuer(botId, signal)
  try {
    return await abfragen(botId, { signal, maxMs, fortschritt, takt })
  } finally {
    takt.ende()
  }
}

async function abfragen(botId, { signal, maxMs, fortschritt, takt }) {
  const sammlung = await ereignisse()
  const start = Date.now()
  let letzterSchlag = 0
  let letzterFortschritt = start
  while (!signal?.aborted && Date.now() - start < maxMs) {
    takt.vorAbfrage()
    if (Date.now() - letzterSchlag >= HERZSCHLAG_MS) {
      await herzschlag(botId)
      letzterSchlag = Date.now()
    }
    const ereignis = await sammlung.findOneAndUpdate(
      { botId, zugestellt: false },
      { $set: { zugestellt: true } },
      { sort: { _id: 1 }, returnDocument: 'after' }
    )
    if (ereignis && signal?.aborted) {
      // Ein verdrängter oder abgebrochener Aufruf darf den Auftrag nicht verschlucken.
      await sammlung.updateOne({ _id: ereignis._id }, { $set: { zugestellt: false } })
      return null
    }
    if (ereignis) return fuerClient(ereignis)
    if (Date.now() - letzterFortschritt >= FORTSCHRITT_MS) {
      letzterFortschritt = Date.now()
      await fortschritt(Math.round((Date.now() - start) / 1000))
    }
    const bisFortschritt = FORTSCHRITT_MS - (Date.now() - letzterFortschritt)
    await takt.schlafen(Math.max(10, Math.min(TAKT_MS, bisFortschritt, maxMs - (Date.now() - start))))
  }
  return null
}
