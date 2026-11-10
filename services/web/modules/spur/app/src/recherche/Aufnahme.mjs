import fs from 'node:fs/promises'
import os from 'node:os'
import Path from 'node:path'
import dns from 'node:dns'
import { isIP } from 'node:net'
import logger from '@overleaf/logger'
import * as Crossref from '../Crossref.mjs'
import { adresseGesperrt, geschuetztHolen } from '../netz.mjs'
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
export const netz = { holen: geschuetztHolen, lookup: dns.lookup }

// Der Paper-Fake liegt im eigenen Stack; echte Volltexte kommen nur von öffentlichen https-Adressen.
// Die Auflösung des Namens prüft erst die Anfrage selbst, an der Stelle, an der sie verbindet.
function erlaubteAdresse(url) {
  let adresse
  try {
    adresse = new URL(url)
  } catch {
    return false
  }
  if (paperApiBasis()) return true
  const host = adresse.hostname.replace(/^\[|\]$/g, '')
  return adresse.protocol === 'https:' && !isIP(host) && host !== 'localhost' && !host.endsWith('.localhost')
}

// Redirects selbst folgen, damit jede Station dieselbe Prüfung durchläuft.
async function holenMitPruefung(url) {
  const gesperrt = paperApiBasis() ? () => false : adresseGesperrt
  const signal = AbortSignal.timeout(60000)
  let ziel = url
  for (let i = 0; i < 5; i++) {
    if (!erlaubteAdresse(ziel)) throw pdfFehlt()
    const antwort = await netz.holen(new URL(ziel), {
      gesperrt,
      signal,
      lookup: netz.lookup,
      headers: { 'User-Agent': 'spur (Volltext)', Accept: 'application/pdf' },
    })
    const weiter = antwort.headers.location
    if (antwort.statusCode < 300 || antwort.statusCode >= 400 || !weiter) return antwort
    antwort.resume()
    ziel = new URL(weiter, ziel).toString()
  }
  throw pdfFehlt()
}

const pdfFehlt = () =>
  new Problem(
    502,
    'pdf_fehlt',
    'spur_fehler_volltext_laden'
  )

const zuGross = () => new Problem(413, 'zu_gross', 'spur_fehler_volltext_zu_gross')

async function pdfLaden(url, ziel) {
  let antwort
  try {
    antwort = await holenMitPruefung(url)
  } catch (error) {
    if (error instanceof Problem && error.typ === 'pdf_fehlt') throw error
    // Auch ein gesperrtes Ziel meldet der Nutzer nur als nicht ladbar.
    logger.warn({ err: error, url }, 'Volltext nicht erreichbar')
    throw pdfFehlt()
  }
  if (antwort.statusCode < 200 || antwort.statusCode >= 300) {
    antwort.resume()
    throw pdfFehlt()
  }
  if (Number(antwort.headers['content-length'] ?? 0) > QuellenManager.MAX_BYTES) {
    antwort.destroy()
    throw zuGross()
  }
  const teile = []
  let groesse = 0
  try {
    for await (const teil of antwort) {
      groesse += teil.length
      if (groesse > QuellenManager.MAX_BYTES) {
        antwort.destroy()
        throw zuGross()
      }
      teile.push(teil)
    }
  } catch (error) {
    if (error instanceof Problem) throw error
    logger.warn({ err: error, url }, 'Volltext abgebrochen')
    throw pdfFehlt()
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
    throw new Problem(502, 'dienst_fehlt', 'spur_fehler_crossref_nicht_erreichbar')
  }
  if (meta.gefunden || !arxiv) return { meta, arxiv: null }
  return { meta: await arxivMetadaten(arxiv), arxiv }
}

export async function perDoi({ projectId, userId, doi }) {
  const wert = doiNormal(doi)
  const quellen = await QuellenManager.alle(projectId)
  if (quellen.some(q => q.doi?.toLowerCase() === wert)) {
    throw new Problem(409, 'quelle_vorhanden', 'spur_fehler_quelle_vorhanden')
  }
  const { meta, arxiv } = await metadaten(wert)
  if (!meta.gefunden) throw new Problem(404, 'doi_nicht_gefunden', 'spur_fehler_doi_nicht_gefunden')
  const zugang = arxiv ? { frei: true, pdf: meta.pdf, lizenz: null } : await unpaywall.status(wert)
  if (!zugang?.frei || !zugang.pdf) {
    throw new Problem(409, 'nicht_frei', 'spur_fehler_nicht_frei')
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
      await QuellenManager.loeschen(quelle).catch(aufraeumFehler =>
        logger.error({ err: aufraeumFehler, quelleId: quelle._id }, 'spur: Quelle nach gescheiterter Aufnahme nicht gelöscht')
      )
      throw error
    }
    return quelle
  } finally {
    await fs.rm(ordner, { recursive: true, force: true })
  }
}
