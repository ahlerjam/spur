import logger from '@overleaf/logger'
import { crossrefCache } from './sammlungen.mjs'
import { jetzt, paperApiBasis } from './schalter.mjs'

const BASIS = 'https://api.crossref.org'
const TAG_MS = 24 * 60 * 60 * 1000
const ZURUECKGEZOGEN = new Set(['retraction', 'withdrawal', 'removal'])
const KORREKTUR = new Set([
  'correction',
  'erratum',
  'corrigendum',
  'addendum',
  'clarification',
])

export function werkAuswerten(message) {
  const updates = (message['updated-by'] ?? []).map(u =>
    (u.type ?? '').toLowerCase()
  )
  let retraction = 'keine_meldung'
  if (updates.some(t => KORREKTUR.has(t))) retraction = 'korrektur'
  if (updates.some(t => ZURUECKGEZOGEN.has(t))) retraction = 'zurueckgezogen'
  const issued = message.issued?.['date-parts']?.[0]?.[0]
  return {
    gefunden: true,
    titel: message.title?.[0] ?? null,
    autoren: (message.author ?? []).map(a => ({
      family: a.family ?? a.name ?? '',
      given: a.given ?? '',
    })),
    jahr: issued ?? null,
    journal: message['container-title']?.[0] ?? null,
    seiten: message.page ?? null,
    typ: message.type ?? null,
    retraction,
  }
}

// Crossref drosselt mit 429 und ist zeitweise mit 503 weg: wenige Versuche mit Pause, Retry-After zuerst.
const VERSUCHE = 4
const MAX_PAUSE_MS = 5000
const WIEDERHOLEN = new Set([429, 503])

function pauseMs(antwort, versuch) {
  const kopf = antwort.headers.get('retry-after')
  const sekunden = kopf == null ? NaN : Number(kopf)
  const ms = Number.isFinite(sekunden) && sekunden >= 0 ? sekunden * 1000 : 1000 * 2 ** (versuch - 1)
  return Math.min(ms, MAX_PAUSE_MS)
}

async function abrufen(doi) {
  const url = new URL(
    `${paperApiBasis() ?? BASIS}/works/${encodeURIComponent(doi)}`
  )
  if (process.env.CROSSREF_MAILTO) {
    url.searchParams.set('mailto', process.env.CROSSREF_MAILTO)
  }
  for (let versuch = 1; ; versuch++) {
    const antwort = await fetch(url, { signal: AbortSignal.timeout(10000) })
    if (antwort.status === 404) return { gefunden: false }
    if (WIEDERHOLEN.has(antwort.status) && versuch < VERSUCHE) {
      await new Promise(weiter => setTimeout(weiter, pauseMs(antwort, versuch)))
      continue
    }
    if (!antwort.ok) throw new Error(`Crossref antwortet ${antwort.status}`)
    const { message } = await antwort.json()
    return werkAuswerten(message)
  }
}

// null heißt: Crossref gerade nicht erreichbar (nicht prüfbar), { gefunden: false }: DOI unbekannt (404).
export async function werk(doi) {
  const _id = doi.toLowerCase()
  const cache = await crossrefCache()
  const eintrag = await cache.findOne({ _id })
  if (eintrag && jetzt() - eintrag.abgerufenAm < TAG_MS) return eintrag.werk
  try {
    const neu = await abrufen(doi)
    await cache.updateOne(
      { _id },
      { $set: { werk: neu, abgerufenAm: jetzt() } },
      { upsert: true }
    )
    return neu
  } catch (error) {
    logger.warn({ err: error, doi }, 'Crossref nicht erreichbar')
    return eintrag?.werk ?? null
  }
}
