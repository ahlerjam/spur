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

async function abrufen(doi) {
  const url = new URL(
    `${paperApiBasis() ?? BASIS}/works/${encodeURIComponent(doi)}`
  )
  if (process.env.CROSSREF_MAILTO) {
    url.searchParams.set('mailto', process.env.CROSSREF_MAILTO)
  }
  const antwort = await fetch(url, { signal: AbortSignal.timeout(10000) })
  if (antwort.status === 404) return { gefunden: false }
  if (!antwort.ok) throw new Error(`Crossref antwortet ${antwort.status}`)
  const { message } = await antwort.json()
  return werkAuswerten(message)
}

// DOIs, deren Abruf gerade gescheitert ist: nicht bei jedem Bericht erneut 10 s warten.
const FEHLER_PAUSE_MS = 5 * 60 * 1000
const zuletztGescheitert = new Map()

export async function werk(doi) {
  const _id = doi.toLowerCase()
  const cache = await crossrefCache()
  const eintrag = await cache.findOne({ _id })
  if (eintrag && jetzt() - eintrag.abgerufenAm < TAG_MS) return eintrag.werk
  if (Date.now() - (zuletztGescheitert.get(_id) ?? 0) < FEHLER_PAUSE_MS) return eintrag?.werk ?? null
  try {
    const neu = await abrufen(doi)
    zuletztGescheitert.delete(_id)
    await cache.updateOne(
      { _id },
      { $set: { werk: neu, abgerufenAm: jetzt() } },
      { upsert: true }
    )
    return neu
  } catch (error) {
    logger.warn({ err: error, doi }, 'Crossref nicht erreichbar')
    zuletztGescheitert.set(_id, Date.now())
    return eintrag?.werk ?? null
  }
}
