// Holt eine Webseite für einen datierten Schnappschuss. Die Adresse kommt von Nutzern: Sie darf
// nicht ins lokale Netz zeigen (SSRF), auch nicht über DNS oder eine Umleitung.
import dns from 'node:dns'
import http from 'node:http'
import https from 'node:https'
import net from 'node:net'
import sanitizeHtml from 'sanitize-html'
import { Problem } from './probleme.mjs'

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
const gesperrtFehler = () =>
  new Problem(
    422,
    'adresse_gesperrt',
    'Adressen im lokalen Netz lassen sich nicht aufnehmen. Bitte eine öffentliche Webseite angeben.'
  )

const V4_GESPERRT = [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['224.0.0.0', 3],
]

const v4Zahl = ip => ip.split('.').reduce((summe, teil) => summe * 256 + Number(teil), 0)

function v4Gesperrt(ip) {
  const zahl = v4Zahl(ip)
  return V4_GESPERRT.some(([netz, bits]) => {
    const groesse = 2 ** (32 - bits)
    return Math.floor(zahl / groesse) === Math.floor(v4Zahl(netz) / groesse)
  })
}

export function adresseGesperrt(ip) {
  if (net.isIPv4(ip)) return v4Gesperrt(ip)
  const klein = ip.toLowerCase()
  const v4 = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(klein)
  if (v4) return v4Gesperrt(v4[1])
  return (
    klein === '::' ||
    klein === '::1' ||
    /^f[cd]/.test(klein) ||
    /^fe[89ab]/.test(klein) ||
    klein.startsWith('ff')
  )
}

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

function anfrage(url, gesperrt, signal) {
  const host = url.hostname.replace(/^\[|\]$/g, '')
  if (net.isIP(host) && gesperrt(host)) return Promise.reject(gesperrtFehler())
  // Prüft die Adresse, mit der sich der Socket wirklich verbindet, nicht eine frühere Auflösung.
  const lookup = (name, optionen, fertig) =>
    dns.lookup(name, optionen, (error, adresse, familie) => {
      if (error) return fertig(error)
      const liste = Array.isArray(adresse) ? adresse : [{ address: adresse }]
      if (liste.some(a => gesperrt(a.address))) return fertig(gesperrtFehler())
      fertig(null, adresse, familie)
    })
  const modul = url.protocol === 'https:' ? https : http
  return new Promise((resolve, reject) => {
    modul
      .get(
        url,
        {
          lookup,
          signal,
          headers: { 'User-Agent': 'spur (Schnappschuss)', Accept: 'text/html, text/plain;q=0.9' },
        },
        resolve
      )
      .on('error', error => reject(error instanceof Problem ? error : nichtErreichbar()))
  })
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

const ohneMarkup = html =>
  sanitizeHtml(html, {
    allowedTags: [],
    allowedAttributes: {},
    nonTextTags: ['head', 'script', 'style', 'noscript', 'template', 'textarea', 'option', 'title'],
  })
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')

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
