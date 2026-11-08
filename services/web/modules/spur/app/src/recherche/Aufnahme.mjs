import fs from 'node:fs/promises'
import os from 'node:os'
import Path from 'node:path'
import { lookup } from 'node:dns/promises'
import { BlockList, isIP } from 'node:net'
import logger from '@overleaf/logger'
import * as Crossref from '../Crossref.mjs'
import { Problem } from '../probleme.mjs'
import * as QuellenManager from '../QuellenManager.mjs'
import * as ZitatManager from '../ZitatManager.mjs'
import * as PruefManager from '../pruefung/PruefManager.mjs'
import { bibLesen, doiNormal as bibDoi } from '../pruefung/bib.mjs'
import { paperApiBasis } from '../schalter.mjs'
import { arxivMetadaten, unpaywall } from './dienste.mjs'
import { freierKey, keyVorschlag } from './keys.mjs'

const ARXIV_DOI = /^10\.48550\/arxiv\.(.+)$/

export const doiNormal = doi => bibDoi(doi)?.toLowerCase() ?? ''

// Austauschbar für Tests ohne Netz.
export const namen = { lookup }

const INTERN = new BlockList()
for (const [netz, laenge] of [['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.168.0.0', 16]]) {
  INTERN.addSubnet(netz, laenge, 'ipv4')
}
// IPv4-gemappte IPv6-Adressen prüft BlockList mit den IPv4-Regeln.
for (const [netz, laenge] of [['::', 127], ['fc00::', 7], ['fe80::', 10]]) INTERN.addSubnet(netz, laenge, 'ipv6')

// Der Paper-Fake liegt im eigenen Stack; echte Volltexte kommen nur von öffentlichen https-Adressen,
// auch nach der Namensauflösung.
async function erlaubteAdresse(url) {
  let adresse
  try {
    adresse = new URL(url)
  } catch {
    return false
  }
  if (paperApiBasis()) return true
  const host = adresse.hostname.replace(/^\[|\]$/g, '')
  if (adresse.protocol !== 'https:' || isIP(host) || host === 'localhost' || host.endsWith('.localhost')) return false
  const ziele = await namen.lookup(host, { all: true }).catch(() => [])
  return ziele.length > 0 && ziele.every(z => !INTERN.check(z.address, z.family === 6 ? 'ipv6' : 'ipv4'))
}

// Redirects selbst folgen, damit jede Station dieselbe Prüfung durchläuft.
async function holenMitPruefung(url) {
  let ziel = url
  for (let i = 0; i < 5; i++) {
    if (!(await erlaubteAdresse(ziel))) throw pdfFehlt()
    const antwort = await fetch(ziel, { redirect: 'manual', signal: AbortSignal.timeout(60000) })
    const weiter = antwort.headers.get('location')
    if (antwort.status < 300 || antwort.status >= 400 || !weiter) return antwort
    ziel = new URL(weiter, ziel).toString()
  }
  throw pdfFehlt()
}

const pdfFehlt = () =>
  new Problem(
    502,
    'pdf_fehlt',
    'Der freie Volltext ließ sich nicht laden. Bitte später erneut versuchen oder das PDF selbst hochladen.'
  )

const zuGross = () => new Problem(413, 'zu_gross', 'Der Volltext ist größer als 50 MB. Bitte selbst beschaffen.')

async function pdfLaden(url, ziel) {
  let antwort
  try {
    antwort = await holenMitPruefung(url)
  } catch (error) {
    if (error instanceof Problem) throw error
    logger.warn({ err: error, url }, 'Volltext nicht erreichbar')
    throw pdfFehlt()
  }
  if (!antwort.ok) throw pdfFehlt()
  if (Number(antwort.headers.get('content-length') ?? 0) > QuellenManager.MAX_BYTES) throw zuGross()
  const teile = []
  let groesse = 0
  for await (const teil of antwort.body) {
    groesse += teil.length
    if (groesse > QuellenManager.MAX_BYTES) throw zuGross()
    teile.push(teil)
  }
  const inhalt = Buffer.concat(teile)
  if (!inhalt.subarray(0, 5).equals(Buffer.from('%PDF-'))) throw pdfFehlt()
  await fs.writeFile(ziel, inhalt)
  return groesse
}

// Metadaten aus dem DOI-Register: Crossref, für arXiv-DOIs (DataCite) die arXiv-API.
export async function metadaten(doi) {
  const arxiv = ARXIV_DOI.exec(doi)?.[1]
  const meta = await Crossref.werk(doi)
  if (meta === null) {
    throw new Problem(502, 'dienst_fehlt', 'Crossref nicht erreichbar. Bitte später erneut versuchen.')
  }
  if (meta.gefunden || !arxiv) return { meta, arxiv: null }
  return { meta: await arxivMetadaten(arxiv), arxiv }
}

export async function perDoi({ projectId, userId, doi }) {
  const wert = doiNormal(doi)
  const quellen = await QuellenManager.alle(projectId)
  if (quellen.some(q => q.doi?.toLowerCase() === wert)) {
    throw new Problem(409, 'quelle_vorhanden', 'Bereits vorhanden')
  }
  const { meta, arxiv } = await metadaten(wert)
  if (!meta.gefunden) throw new Problem(404, 'doi_nicht_gefunden', 'DOI nicht gefunden')
  if (!arxiv && !process.env.UNPAYWALL_EMAIL && !paperApiBasis()) {
    throw new Problem(
      503,
      'unpaywall_aus',
      'Unpaywall ist auf dieser Installation nicht eingerichtet (UNPAYWALL_EMAIL fehlt). Bitte den Betreiber fragen oder das PDF selbst hochladen.'
    )
  }
  const zugang = arxiv ? { frei: true, pdf: meta.pdf, lizenz: null } : await unpaywall.status(wert)
  if (!zugang?.frei || !zugang.pdf) {
    throw new Problem(409, 'nicht_frei', 'Kein freier Volltext gefunden. Bitte auf die Beschaffungsliste setzen.')
  }
  const docs = await PruefManager.dokumente(projectId)
  const belegt = new Set(quellen.map(q => q.key))
  for (const d of docs.filter(d => d.pfad.endsWith('.bib'))) {
    for (const key of bibLesen(d.text).keys()) belegt.add(key)
  }
  const key = freierKey(keyVorschlag(meta), belegt)
  const ordner = await fs.mkdtemp(Path.join(os.tmpdir(), 'spur-doi-'))
  try {
    const tempPfad = Path.join(ordner, 'volltext.pdf')
    const groesse = await pdfLaden(zugang.pdf, tempPfad)
    const quelle = await QuellenManager.aufnehmen({
      projectId,
      userId,
      dateiname: `${key}.pdf`,
      tempPfad,
      groesse,
      key,
      doi: wert,
      meta,
      // Open Access heißt nicht weiterverwendbar: ohne Lizenzangabe bleibt der Volltext in diesem Projekt.
      nurProjekt: !zugang.lizenz,
    })
    try {
      await ZitatManager.bibSicherstellen(projectId, docs, quelle, userId)
    } catch (error) {
      // Ohne .bib-Eintrag keine Quelle: Sonst schlüge jede Wiederholung mit „Bereits vorhanden“ fehl.
      await QuellenManager.loeschen(quelle)
      throw error
    }
    return quelle
  } finally {
    await fs.rm(ordner, { recursive: true, force: true })
  }
}
