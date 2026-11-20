import { createHash } from 'node:crypto'
import fs from 'node:fs/promises'
import os from 'node:os'
import Path from 'node:path'
import dns from 'node:dns'
import { isIP } from 'node:net'
import logger from '@overleaf/logger'
import * as Crossref from '../Crossref.mjs'
import { adresseGesperrt, geschuetztHolen, gesperrtFehler } from '../netz.mjs'
import { Problem } from '../probleme.mjs'
import * as QuellenManager from '../QuellenManager.mjs'
import * as ZitatManager from '../ZitatManager.mjs'
import * as PruefManager from '../pruefung/PruefManager.mjs'
import { ARXIV_DOI, bibLesen, doiNormal as bibDoi } from '../pruefung/bib.mjs'
import { jetzt, paperApiBasis } from '../schalter.mjs'
import { arxivMetadaten, europepmc, unpaywall } from './dienste.mjs'
import { freierKey, keyVorschlag } from './keys.mjs'
import { metadatenOhneDoi } from './ohneDoi.mjs'
import { pauseMs, VERSUCHE } from './wiederholen.mjs'

export const doiNormal = doi => bibDoi(doi)?.toLowerCase() ?? ''

// Austauschbar für Tests ohne Netz.
export const netz = { holen: geschuetztHolen, lookup: dns.lookup, warten: ms => new Promise(fertig => setTimeout(fertig, ms)) }

// Der Paper-Fake liegt im eigenen Stack: Nur Adressen unter seiner Basis dürfen ins lokale Netz.
function imFake(adresse) {
  const basis = paperApiBasis()
  if (!basis) return false
  const wurzel = new URL(basis)
  return adresse.origin === wurzel.origin && adresse.pathname.startsWith(`${wurzel.pathname.replace(/\/$/, '')}/`)
}

// Echte Volltexte kommen nur von öffentlichen https-Adressen. Die Auflösung des Namens prüft erst die Anfrage
// selbst, an der Stelle, an der sie verbindet. Ergebnis: { adresse, lokal } oder null; lokal heißt Paper-Fake.
function erlaubteAdresse(url) {
  let adresse
  try {
    adresse = new URL(url)
  } catch {
    return null
  }
  if (imFake(adresse)) return { adresse, lokal: true }
  const host = adresse.hostname.replace(/^\[|\]$/g, '')
  const oeffentlich = adresse.protocol === 'https:' && !isIP(host) && host !== 'localhost' && !host.endsWith('.localhost')
  return oeffentlich ? { adresse, lokal: false } : null
}

// Redirects selbst folgen, damit jede Station dieselbe Prüfung durchläuft.
async function holenMitPruefung(url, signal) {
  let ziel = url
  for (let i = 0; i < 5; i++) {
    const erlaubt = erlaubteAdresse(ziel)
    if (!erlaubt) throw gesperrtFehler()
    const antwort = await netz.holen(erlaubt.adresse, {
      gesperrt: erlaubt.lokal ? () => false : adresseGesperrt,
      signal,
      lookup: netz.lookup,
      headers: { 'User-Agent': 'spur (Volltext)', Accept: 'application/pdf' },
    })
    const weiter = antwort.headers.location
    if (antwort.statusCode < 300 || antwort.statusCode >= 400 || !weiter) return antwort
    antwort.resume()
    ziel = new URL(weiter, ziel).toString()
  }
  throw new Error('Zu viele Umleitungen')
}

const zuGross = () => new Problem(413, 'zu_gross', 'spur_fehler_volltext_zu_gross')

const istHtml = (inhalt, typ) => /html/i.test(typ ?? '') || /^\s*<(!doctype|html|head|body)\b/i.test(inhalt.subarray(0, 200).toString('latin1'))

// Ein Abruf. Ergebnis: 'pdf' (Datei liegt unter ziel), 'html', der HTTP-Status als Text, 'kein_pdf', 'zu_gross',
// 'gesperrt' (Adresse nicht erlaubt) oder 'netzfehler'. fundortLaden ergänzt 'zeit_abgelaufen', wenn die Frist des
// Aufrufs schon vor dem ersten Versuch um war.
async function einmalLaden(url, ziel, signal) {
  let antwort
  try {
    antwort = await holenMitPruefung(url, signal)
  } catch (error) {
    // Auch ein gesperrtes Ziel meldet der Nutzer nur als nicht ladbar.
    if (error instanceof Problem && error.typ === 'adresse_gesperrt') return { ergebnis: 'gesperrt' }
    logger.warn({ err: error, url }, 'Volltext nicht erreichbar')
    return { ergebnis: 'netzfehler' }
  }
  if (antwort.statusCode < 200 || antwort.statusCode >= 300) {
    antwort.resume()
    return { ergebnis: String(antwort.statusCode), retryAfter: antwort.headers['retry-after'] }
  }
  if (Number(antwort.headers['content-length'] ?? 0) > QuellenManager.MAX_BYTES) {
    antwort.destroy()
    return { ergebnis: 'zu_gross' }
  }
  const teile = []
  const pruefsumme = createHash('sha256')
  let groesse = 0
  try {
    for await (const teil of antwort) {
      pruefsumme.update(teil)
      groesse += teil.length
      if (groesse > QuellenManager.MAX_BYTES) {
        antwort.destroy()
        return { ergebnis: 'zu_gross' }
      }
      teile.push(teil)
    }
  } catch (error) {
    logger.warn({ err: error, url }, 'Volltext abgebrochen')
    return { ergebnis: 'netzfehler' }
  }
  const inhalt = Buffer.concat(teile)
  if (!inhalt.subarray(0, 5).equals(Buffer.from('%PDF-'))) {
    return { ergebnis: istHtml(inhalt, antwort.headers['content-type']) ? 'html' : 'kein_pdf' }
  }
  await fs.writeFile(ziel, inhalt)
  return { ergebnis: 'pdf', groesse, hash: pruefsumme.digest('hex') }
}

const FRIST_MS = 60000
// Antworten, mit denen Verlagsseiten Server abweisen, obwohl das Paper frei ist.
const ABGEWIESEN = ['html', '401', '403', '429', '503']
const WIEDERHOLBAR = ['netzfehler', '429', '503']

// Wiederholt einen Fundort bei Netzfehlern, 429 und 503, solange die Frist des ganzen Aufrufs reicht.
async function fundortLaden(url, ziel, frist) {
  for (let versuch = 1; ; versuch++) {
    const rest = frist - Date.now()
    if (rest <= 0) return { ergebnis: 'zeit_abgelaufen' }
    const abruf = await einmalLaden(url, ziel, AbortSignal.timeout(rest))
    if (!WIEDERHOLBAR.includes(abruf.ergebnis) || versuch === VERSUCHE) return abruf
    const pause = pauseMs(abruf.retryAfter, versuch)
    if (Date.now() + pause >= frist) return abruf
    await netz.warten(pause)
  }
}

// Alle Fundorte in der Reihenfolge, in der sie versucht werden; Europe PMC wird erst gefragt, wenn die anderen scheitern.
async function* fundorteVon(doi, zugang) {
  yield* zugang.fundorte
  if (zugang.nurDiese) return
  let ort = null
  try {
    ort = await europepmc.fundort(doi)
  } catch (error) {
    // Ohne Europe PMC bleibt es bei den Fundorten von Unpaywall.
    logger.warn({ err: error, doi }, 'Europe PMC nicht erreichbar')
  }
  if (ort && !zugang.fundorte.some(f => f.url === ort.url)) yield ort
}

function hostVon(url) {
  try {
    return new URL(url).host
  } catch {
    return null
  }
}

// Metadaten aus dem DOI-Register: Crossref, für arXiv-DOIs (DataCite) die arXiv-API.
export async function metadaten(doi) {
  const arxiv = ARXIV_DOI.test(doi) ? doi.replace(ARXIV_DOI, '') || null : null
  const meta = await Crossref.werk(doi)
  if (meta === null) {
    throw new Problem(502, 'dienst_fehlt', 'spur_fehler_crossref_nicht_erreichbar')
  }
  if (meta.gefunden || !arxiv) return { meta, arxiv: null }
  return { meta: await arxivMetadaten(arxiv), arxiv }
}

// Ein freier Key aus erstem Nachnamen und Jahr, dazu die Dokumente des Projekts für den .bib-Eintrag.
export async function neuerKey(projectId, quellen, meta) {
  const docs = await PruefManager.dokumente(projectId)
  const belegt = new Set(quellen.map(q => q.key))
  for (const d of docs.filter(d => d.pfad.endsWith('.bib'))) {
    for (const key of bibLesen(d.text).keys()) belegt.add(key)
  }
  return { key: freierKey(keyVorschlag(meta), belegt), docs }
}

// Ergänzt die .bib um die neue Quelle. Ohne .bib-Eintrag keine Quelle: Sonst schlüge jede Wiederholung mit
// „Bereits vorhanden“ fehl.
export async function mitBibEintrag(projectId, docs, quelle, userId) {
  try {
    await ZitatManager.bibSicherstellen(projectId, docs, quelle, userId)
  } catch (error) {
    await QuellenManager.loeschen(quelle).catch(aufraeumFehler =>
      logger.error({ err: aufraeumFehler, quelleId: quelle._id }, 'spur: Quelle nach gescheiterter Aufnahme nicht gelöscht')
    )
    throw error
  }
  return quelle
}

const nichtFrei = () => new Problem(409, 'nicht_frei', 'spur_fehler_nicht_frei')

// Kein Fundort lieferte das PDF. Frei, aber abgewiesen (bot_schutz) heißt: Im Browser lässt es sich laden.
function gescheitert(versucht, adresse) {
  if (!versucht.length) return nichtFrei()
  if (adresse) return new Problem(502, 'bot_schutz', 'spur_fehler_bot_schutz', undefined, { versucht, adresse })
  if (versucht.some(v => v.ergebnis === 'zu_gross')) return zuGross()
  return new Problem(502, 'pdf_fehlt', 'spur_fehler_volltext_laden', undefined, { versucht })
}

export async function perDoi({ projectId, userId, doi }) {
  const wert = doiNormal(doi)
  const quellen = await QuellenManager.alle(projectId)
  if (quellen.some(q => q.doi?.toLowerCase() === wert)) {
    throw new Problem(409, 'quelle_vorhanden', 'spur_fehler_quelle_vorhanden')
  }
  const { meta, arxiv } = await metadaten(wert)
  if (!meta.gefunden) throw new Problem(404, 'doi_nicht_gefunden', 'spur_fehler_doi_nicht_gefunden')
  const zugang = arxiv ? { frei: true, nurDiese: true, fundorte: meta.pdf ? [{ url: meta.pdf, art: 'repository', lizenz: null, seite: null }] : [] } : await unpaywall.status(wert)
  if (!zugang?.frei) throw nichtFrei()
  const { key, docs } = await neuerKey(projectId, quellen, meta)
  const ordner = await fs.mkdtemp(Path.join(os.tmpdir(), 'spur-doi-'))
  try {
    const tempPfad = Path.join(ordner, 'volltext.pdf')
    const frist = Date.now() + FRIST_MS
    const versucht = []
    // Beste Adresse für den Browser: die Artikelseite des ersten Fundorts, der den Server abgewiesen hat.
    let abgewiesen = null
    let quelle
    for await (const ort of fundorteVon(wert, zugang)) {
      let { ergebnis, groesse } = await fundortLaden(ort.url, tempPfad, frist)
      if (ergebnis === 'pdf') {
        try {
          quelle = await QuellenManager.aufnehmen({
            projectId,
            userId,
            dateiname: `${key}.pdf`,
            tempPfad,
            groesse,
            key,
            doi: wert,
            meta,
            lizenz: ort.lizenz,
            // Ein Ausweichweg kann das PDF eines anderen Werks liefern: dann den nächsten Fundort nehmen.
            titelStreng: true,
            // Open Access heißt nicht weiterverwendbar: ohne Lizenzangabe bleibt der Volltext in diesem Projekt.
            nurProjekt: !ort.lizenz,
          })
          break
        } catch (error) {
          if (!['falsches_pdf', 'datei_unlesbar'].includes(error.typ)) throw error
          ergebnis = error.typ === 'falsches_pdf' ? 'falsches_pdf' : 'kein_pdf'
        }
      }
      versucht.push({ url: ort.url, host: hostVon(ort.url), art: ort.art, ergebnis })
      if (ABGEWIESEN.includes(ergebnis)) abgewiesen ??= ort.seite ?? ort.url
    }
    if (!quelle) throw gescheitert(versucht, abgewiesen)
    return await mitBibEintrag(projectId, docs, quelle, userId)
  } finally {
    await fs.rm(ordner, { recursive: true, force: true })
  }
}

// Quelle ohne DOI (Abschlussarbeit, Report, Working Paper): lädt das PDF von einer https-Adresse und legt die Quelle
// mit den angegebenen Metadaten und einem passenden .bib-Eintrag an.
export async function perUrl({ projectId, userId, pdfUrl, metadaten }) {
  const angaben = metadatenOhneDoi(metadaten)
  const url = String(pdfUrl).trim()
  const quellen = await QuellenManager.alle(projectId)
  const vorhanden = () => new Problem(409, 'quelle_vorhanden', 'spur_fehler_quelle_vorhanden')
  if (quellen.some(q => q.pdfUrl === url)) throw vorhanden()
  const meta = { ...angaben, url: angaben.url ?? url, abgerufenAm: jetzt() }
  const { key, docs } = await neuerKey(projectId, quellen, meta)
  const ordner = await fs.mkdtemp(Path.join(os.tmpdir(), 'spur-url-'))
  try {
    const tempPfad = Path.join(ordner, 'volltext.pdf')
    const { ergebnis, groesse, hash } = await fundortLaden(url, tempPfad, Date.now() + FRIST_MS)
    if (ergebnis === 'zu_gross') throw zuGross()
    if (ergebnis !== 'pdf') {
      throw new Problem(502, 'pdf_fehlt', 'spur_fehler_pdf_url_laden', undefined, {
        versucht: [{ url, host: hostVon(url), art: 'pdf_url', ergebnis }],
      })
    }
    if (quellen.some(q => q.hash === hash)) throw vorhanden()
    const quelle = await QuellenManager.aufnehmen({
      projectId,
      userId,
      dateiname: `${key}.pdf`,
      tempPfad,
      groesse,
      key,
      meta,
      // Ohne Lizenzangabe bleibt der Volltext wie bei der Aufnahme per DOI in diesem Projekt.
      nurProjekt: true,
      pdfUrl: url,
      hash,
    })
    return await mitBibEintrag(projectId, docs, quelle, userId)
  } finally {
    await fs.rm(ordner, { recursive: true, force: true })
  }
}
