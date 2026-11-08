import logger from '@overleaf/logger'
import { drossel, paperCache } from '../sammlungen.mjs'
import { jetzt } from '../schalter.mjs'

const TAG_MS = 24 * 60 * 60 * 1000
const MAX_WARTEN_MS = 20000

export class DienstFehler extends Error {
  // art: 'nicht_erreichbar' oder 'limit'
  constructor(dienst, art) {
    super(
      art === 'limit'
        ? `${dienst.anzeige}: Limit erreicht. Bitte in einigen Minuten erneut suchen.`
        : `${dienst.anzeige} nicht erreichbar`
    )
    this.dienst = dienst.name
    this.art = art
  }
}

// Vergibt Zeitfenster je Dienst über alle Prozesse der Installation: Jeder Aufruf bekommt das
// nächste freie Fenster und schiebt es um den Abstand weiter.
export async function platzHolen(dienst) {
  const sammlung = await drossel()
  const nun = Date.now()
  // Ein abgewiesener Aufruf darf kein Fenster belegen, sonst sperrt sich der Dienst bei Last selbst.
  const stand = await sammlung.findOne({ _id: dienst.name })
  if ((stand?.naechster ?? 0) - nun > MAX_WARTEN_MS) throw new DienstFehler(dienst, 'limit')
  const eintrag = await sammlung.findOneAndUpdate(
    { _id: dienst.name },
    [
      { $set: { slot: { $max: [{ $ifNull: ['$naechster', 0] }, nun] } } },
      { $set: { naechster: { $add: ['$slot', dienst.abstandMs] } } },
    ],
    { upsert: true, returnDocument: 'after' }
  )
  const warten = eintrag.slot - nun
  if (warten > MAX_WARTEN_MS) throw new DienstFehler(dienst, 'limit')
  if (warten > 0) await new Promise(fertig => setTimeout(fertig, warten))
}

// Holt eine Antwort aus dem Cache oder gedrosselt vom Dienst. 404 ergibt null.
export async function abrufen(dienst, url, { headers = {}, text = false, cacheSchluessel = url } = {}) {
  const cache = await paperCache()
  const eintrag = await cache.findOne({ _id: cacheSchluessel })
  if (eintrag && jetzt() - eintrag.abgerufenAm < TAG_MS) return eintrag.antwort
  await platzHolen(dienst)
  let antwort
  try {
    antwort = await fetch(url, { headers, signal: AbortSignal.timeout(15000) })
  } catch (error) {
    logger.warn({ err: error, dienst: dienst.name }, 'Paper-Dienst nicht erreichbar')
    throw new DienstFehler(dienst, 'nicht_erreichbar')
  }
  if (antwort.status === 404) return null
  if (antwort.status === 429) throw new DienstFehler(dienst, 'limit')
  if (!antwort.ok) {
    logger.warn({ dienst: dienst.name, status: antwort.status }, 'Paper-Dienst antwortet mit Fehler')
    throw new DienstFehler(dienst, 'nicht_erreichbar')
  }
  const inhalt = text ? await antwort.text() : await antwort.json()
  await cache.updateOne(
    { _id: cacheSchluessel },
    { $set: { antwort: inhalt, abgerufenAm: jetzt() } },
    { upsert: true }
  )
  return inhalt
}
