// Holt eine Webseite für einen datierten Schnappschuss. Die Adresse kommt von Nutzern: Sie darf
// nicht ins lokale Netz zeigen (SSRF), auch nicht über DNS oder eine Umleitung.
import _ from 'lodash'
import sanitizeHtml from 'sanitize-html'
import { adresseGesperrt, geschuetztHolen } from './netz.mjs'
import { Problem } from './probleme.mjs'

export { adresseGesperrt }

const MAX_URL = 2000
const MAX_BYTES = 5 * 1024 * 1024
const MAX_UMLEITUNGEN = 5
const UMLEITUNG = new Set([301, 302, 303, 307, 308])
const ERLAUBTE_TYPEN = /^(text\/html|application\/xhtml\+xml|text\/plain)\b/i

const nichtErreichbar = () =>
  new Problem(
    502,
    'seite_nicht_erreichbar',
    'Seite nicht erreichbar. Bitte die Adresse prüfen oder später erneut versuchen.'
  )

function adressePruefen(eingabe) {
  let url
  try {
    url = typeof eingabe === 'string' && eingabe.length <= MAX_URL ? new URL(eingabe.trim()) : null
  } catch {
    url = null
  }
  if (!url || !['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new Problem(
      422,
      'adresse_ungueltig',
      'Bitte eine vollständige Adresse mit http:// oder https:// eingeben.'
    )
  }
  return url
}

async function anfrage(url, gesperrt, signal) {
  try {
    return await geschuetztHolen(url, {
      gesperrt,
      signal,
      headers: { 'User-Agent': 'spur (Schnappschuss)', Accept: 'text/html, text/plain;q=0.9' },
    })
  } catch (error) {
    throw error instanceof Problem ? error : nichtErreichbar()
  }
}

async function koerperLesen(antwort) {
  const teile = []
  let laenge = 0
  for await (const teil of antwort) {
    laenge += teil.length
    if (laenge > MAX_BYTES) {
      antwort.destroy()
      throw new Problem(413, 'seite_zu_gross', 'Die Seite ist größer als 5 MB und lässt sich nicht aufnehmen.')
    }
    teile.push(teil)
  }
  const zeichensatz = /charset=["']?([\w-]+)/i.exec(antwort.headers['content-type'] ?? '')?.[1]
  let dekodierer
  try {
    dekodierer = new TextDecoder(zeichensatz ?? 'utf-8')
  } catch {
    dekodierer = new TextDecoder('utf-8')
  }
  return dekodierer.decode(Buffer.concat(teile))
}

// sanitize-html maskiert im Text nur &, < und >; _.unescape macht das rückgängig.
const ohneMarkup = html =>
  _.unescape(
    sanitizeHtml(html, {
      allowedTags: [],
      allowedAttributes: {},
      nonTextTags: ['head', 'script', 'style', 'noscript', 'template', 'textarea', 'option', 'title'],
    })
  )

const BLOCK = /<\/?(p|div|h[1-6]|ul|ol|table|section|article|header|footer|nav|main|aside|blockquote|pre|dl|figure|figcaption|form|hr)\b[^>]*>/gi
const ZEILE = /<(br|li|tr|dt|dd)\b[^>]*>/gi

function leerraumOrdnen(text) {
  return text
    .replace(/[^\S\n]+/g, ' ')
    .split('\n')
    .map(z => z.trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

export function htmlZuText(html) {
  const titelRoh = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1]
  const titel = titelRoh ? leerraumOrdnen(ohneMarkup(titelRoh)).replace(/\n+/g, ' ') : ''
  const text = leerraumOrdnen(ohneMarkup(html.replace(ZEILE, '\n$&').replace(BLOCK, '\n\n$&')))
  return { titel: titel || null, text }
}

export async function abrufen(eingabe, { gesperrt = adresseGesperrt, zeitMs = 15000 } = {}) {
  let url = adressePruefen(eingabe)
  const signal = AbortSignal.timeout(zeitMs)
  for (let schritt = 0; schritt <= MAX_UMLEITUNGEN; schritt++) {
    const antwort = await anfrage(url, gesperrt, signal)
    const ziel = antwort.headers.location
    if (UMLEITUNG.has(antwort.statusCode) && ziel) {
      antwort.resume()
      url = adressePruefen(new URL(ziel, url).href)
      continue
    }
    if (antwort.statusCode >= 400) {
      antwort.resume()
      throw nichtErreichbar()
    }
    const typ = antwort.headers['content-type'] ?? ''
    if (!ERLAUBTE_TYPEN.test(typ)) {
      antwort.resume()
      throw new Problem(
        415,
        'keine_webseite',
        'Unter dieser Adresse liegt keine Webseite. PDFs bitte herunterladen und hochladen.'
      )
    }
    const inhalt = await koerperLesen(antwort).catch(error => {
      throw error instanceof Problem ? error : nichtErreichbar()
    })
    const { titel, text } = /^text\/plain/i.test(typ)
      ? { titel: null, text: leerraumOrdnen(inhalt) }
      : htmlZuText(inhalt)
    return { url: url.href, titel, text, html: inhalt }
  }
  throw nichtErreichbar()
}
