import fs from 'node:fs/promises'
import os from 'node:os'
import Path from 'node:path'
import { isIP } from 'node:net'
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

function erlaubteAdresse(url) {
  let adresse
  try {
    adresse = new URL(url)
  } catch {
    return false
  }
  // Der Paper-Fake liegt im eigenen Stack; echte Volltexte kommen nur von öffentlichen https-Adressen.
  if (paperApiBasis()) return true
  const host = adresse.hostname.replace(/^\[|\]$/g, '')
  return adresse.protocol === 'https:' && !isIP(host) && host !== 'localhost' && !host.endsWith('.localhost')
}

const pdfFehlt = () =>
  new Problem(
    502,
    'pdf_fehlt',
    'Der freie Volltext ließ sich nicht laden. Bitte später erneut versuchen oder das PDF selbst hochladen.'
  )

const zuGross = () => new Problem(413, 'zu_gross', 'Der Volltext ist größer als 50 MB. Bitte selbst beschaffen.')

async function pdfLaden(url, ziel) {
  if (!erlaubteAdresse(url)) throw pdfFehlt()
  let antwort
  try {
    antwort = await fetch(url, { signal: AbortSignal.timeout(60000) })
  } catch (error) {
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
    await ZitatManager.bibSicherstellen(projectId, docs, quelle, userId)
    return quelle
  } finally {
    await fs.rm(ordner, { recursive: true, force: true })
  }
}
