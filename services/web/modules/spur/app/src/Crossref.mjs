import logger from '@overleaf/logger'
import { crossrefCache } from './sammlungen.mjs'
import { jetzt, paperApiBasis, umgebung } from './schalter.mjs'

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
// Nach einem Abruf, der trotz aller Versuche gedrosselt blieb, versucht spur eine Minute lang je DOI nur einmal:
// Sonst wartet ein Prüfbericht mit vielen DOIs bei einem Ausfall für jede DOI die vollen Pausen ab.
const AUSFALL_MS = 60 * 1000
let ausfallBis = 0
// Nach einem Netzfehler oder Timeout (keine HTTP-Antwort) fragt spur 30 s lang nicht: Jeder Versuch kostete bis zu
// 10 s. Eine HTTP-Antwort wie 503 sperrt dagegen nicht, damit die DOI gleich nach der Erholung aufgenommen wird.
const NETZFEHLER_MS = 30 * 1000
let netzfehlerBis = 0

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
  if (umgebung('CROSSREF_MAILTO')) {
    url.searchParams.set('mailto', umgebung('CROSSREF_MAILTO'))
  }
  const versuche = Date.now() < ausfallBis ? 1 : VERSUCHE
  for (let versuch = 1; ; versuch++) {
    const antwort = await fetch(url, { signal: AbortSignal.timeout(10000) }).catch(error => {
      netzfehlerBis = Date.now() + NETZFEHLER_MS
      throw error
    })
    if (antwort.status === 404) return { gefunden: false }
    if (WIEDERHOLEN.has(antwort.status) && versuch < versuche) {
      await new Promise(weiter => setTimeout(weiter, pauseMs(antwort, versuch)))
      continue
    }
    // Nur ein voller Satz Versuche öffnet das Fenster; Einzelversuche darin verlängern es nicht.
    if (WIEDERHOLEN.has(antwort.status) && versuche > 1) ausfallBis = Date.now() + AUSFALL_MS
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
  if (Date.now() < netzfehlerBis) return eintrag?.werk ?? null
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

const DOI_ORG = 'https://doi.org'
const DATACITE = 'https://api.datacite.org'
const NICHT_ERREICHBAR = { nichtPruefbar: 'registrierstelle_nicht_erreichbar' }
const NICHT_REGISTRIERT = { gefunden: false, registrierstelle: null }

// Jeder Pfadteil einzeln kodiert: Der Schrägstrich der DOI bleibt, ?, # und % nicht; `.` und `..` nie.
function doiPfad(doi) {
  const teile = doi.split('/')
  return teile.some(t => t === '.' || t === '..') ? null : teile.map(encodeURIComponent).join('/')
}

async function jsonHolen(url) {
  const antwort = await fetch(url, { signal: AbortSignal.timeout(10000) })
  if (!antwort.ok) throw new Error(`${url.host} antwortet ${antwort.status}`)
  return await antwort.json()
}

async function dataciteWerk(pfad) {
  const { data } = await jsonHolen(new URL(`${paperApiBasis() ? `${paperApiBasis()}/datacite` : DATACITE}/dois/${pfad}`))
  const a = data?.attributes ?? {}
  return {
    titel: a.titles?.[0]?.title ?? null,
    autoren: (a.creators ?? []).map(c => ({
      family: c.familyName ?? c.name ?? '',
      given: c.familyName ? (c.givenName ?? '') : '',
    })),
    jahr: a.publicationYear ? Number(a.publicationYear) : null,
  }
}

async function registrierung(doi) {
  const pfad = doiPfad(doi)
  if (!pfad) return NICHT_REGISTRIERT
  const [eintrag] = await jsonHolen(new URL(`${paperApiBasis() ? `${paperApiBasis()}/doiorg` : DOI_ORG}/doiRA/${pfad}`))
  if (!eintrag?.RA) return NICHT_REGISTRIERT
  const name = String(eintrag.RA)
  const registrierstelle = name.toLowerCase()
  if (registrierstelle !== 'datacite') {
    return { gefunden: true, registrierstelle, registrierstelleName: name, metadaten: false, retraction: null }
  }
  return { gefunden: true, registrierstelle, registrierstelleName: name, ...(await dataciteWerk(pfad)), retraction: null }
}

// Für den Prüfbericht: Kennt Crossref die DOI nicht, entscheidet doi.org, wo sie registriert ist.
// null: Crossref nicht erreichbar; { nichtPruefbar }: doi.org oder DataCite nicht erreichbar (nie gecacht).
export async function pruefen(doi) {
  const crossref = await werk(doi)
  if (!crossref) return null
  if (crossref.gefunden) return { ...crossref, registrierstelle: 'crossref' }
  const _id = `ra:${doi.toLowerCase()}`
  const cache = await crossrefCache()
  const eintrag = await cache.findOne({ _id })
  if (eintrag && jetzt() - eintrag.abgerufenAm < TAG_MS) return eintrag.werk
  try {
    const neu = await registrierung(doi)
    await cache.updateOne({ _id }, { $set: { werk: neu, abgerufenAm: jetzt() } }, { upsert: true })
    return neu
  } catch (error) {
    logger.warn({ err: error, doi }, 'Registrierstelle nicht erreichbar')
    return NICHT_ERREICHBAR
  }
}
