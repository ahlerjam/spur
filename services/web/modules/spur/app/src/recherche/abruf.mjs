import { AsyncLocalStorage } from 'node:async_hooks'
import logger from '@overleaf/logger'
import { meldung } from '../meldungen.mjs'
import { drossel, paperCache } from '../sammlungen.mjs'
import { jetzt } from '../schalter.mjs'
import { pauseMs, VERSUCHE } from './wiederholen.mjs'

const TAG_MS = 24 * 60 * 60 * 1000
const MAX_WARTEN_MS = 20000

export class DienstFehler extends Error {
  // art: 'nicht_erreichbar' oder 'limit'
  constructor(dienst, art) {
    super(
      art === 'limit'
        ? meldung('spur_fehler_dienst_limit', { dienst: dienst.anzeige })
        : meldung('spur_fehler_dienst_nicht_erreichbar', { dienst: dienst.anzeige })
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

const FRIST_MS = 20000

// Austauschbar für Tests ohne echte Pausen.
export const zeit = { warten: ms => new Promise(fertig => setTimeout(fertig, ms)) }

const zaehler = new AsyncLocalStorage()

// Führt einen Dienstaufruf aus und hält in stand.versuche fest, wie oft der Dienst für eine seiner Anfragen
// gefragt wurde (0: alles kam aus dem Cache).
export const gezaehlt = (stand, aufruf) => zaehler.run(stand, aufruf)

// Ein Abruf: die Antwort oder die Art des Fehlers; nochmal, wenn sich ein weiterer Versuch lohnt.
async function einmal(dienst, url, headers, frist) {
  let antwort
  try {
    antwort = await fetch(url, { headers, signal: AbortSignal.timeout(Math.max(1, Math.min(15000, frist - Date.now()))) })
  } catch (error) {
    logger.warn({ err: error, dienst: dienst.name }, 'Paper-Dienst nicht erreichbar')
    return { art: 'nicht_erreichbar', nochmal: true }
  }
  if (antwort.status === 429 || antwort.status === 503) {
    return { art: antwort.status === 429 ? 'limit' : 'nicht_erreichbar', nochmal: true, retryAfter: antwort.headers.get('retry-after') }
  }
  if (antwort.status !== 404 && !antwort.ok) {
    logger.warn({ dienst: dienst.name, status: antwort.status }, 'Paper-Dienst antwortet mit Fehler')
    return { art: 'nicht_erreichbar', nochmal: false }
  }
  return { antwort }
}

// Holt eine Antwort aus dem Cache oder gedrosselt vom Dienst. 404 ergibt null. Bei 429, 503 und Netzfehlern fragt
// spur bis zu dreimal, insgesamt höchstens 20 s; erst danach gilt der Dienst als gedrosselt oder nicht erreichbar.
export async function abrufen(dienst, url, { headers = {}, text = false, cacheSchluessel = url } = {}) {
  const cache = await paperCache()
  const eintrag = await cache.findOne({ _id: cacheSchluessel })
  if (eintrag && jetzt() - eintrag.abgerufenAm < TAG_MS) return eintrag.antwort
  const stand = zaehler.getStore()
  const frist = Date.now() + FRIST_MS
  for (let versuch = 1; ; versuch++) {
    await platzHolen(dienst)
    if (stand) stand.versuche = Math.max(stand.versuche, versuch)
    const { antwort, art, nochmal, retryAfter } = await einmal(dienst, url, headers, frist)
    if (antwort) {
      if (antwort.status === 404) return null
      const inhalt = text ? await antwort.text() : await antwort.json()
      await cache.updateOne(
        { _id: cacheSchluessel },
        { $set: { antwort: inhalt, abgerufenAm: jetzt() } },
        { upsert: true }
      )
      return inhalt
    }
    const pause = pauseMs(retryAfter, versuch)
    if (!nochmal || versuch === VERSUCHE || Date.now() + pause > frist) throw new DienstFehler(dienst, art)
    await zeit.warten(pause)
  }
}
