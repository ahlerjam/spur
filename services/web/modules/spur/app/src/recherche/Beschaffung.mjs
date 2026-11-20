import logger from '@overleaf/logger'
import { ObjectId } from '../../../../../app/src/infrastructure/mongodb.mjs'
import { csv } from '../csv.mjs'
import { Problem } from '../probleme.mjs'
import * as QuellenManager from '../QuellenManager.mjs'
import * as ZitatManager from '../ZitatManager.mjs'
import * as PruefManager from '../pruefung/PruefManager.mjs'
import { autorName, bibEintrag } from '../pruefung/bib.mjs'
import { beschaffungen, einstellungen, quellen } from '../sammlungen.mjs'
import { jetzt } from '../schalter.mjs'
import * as Aufnahme from './Aufnahme.mjs'
import { doiPfad } from './dienste.mjs'
import { freierKey, keyVorschlag } from './keys.mjs'
import * as Suchprotokoll from './Suchprotokoll.mjs'

const SEITE = 50
const STANDARD_VORLAGE = 'https://doi.org/{doi}'

const fehlt = () =>
  new Problem(404, 'beschaffung_fehlt', 'spur_fehler_beschaffung_fehlt')

export async function hinzufuegen({ projectId, userId, doi }) {
  const wert = Aufnahme.doiNormal(doi)
  if ((await QuellenManager.alle(projectId)).some(q => q.doi?.toLowerCase() === wert)) {
    throw new Problem(409, 'quelle_vorhanden', 'spur_fehler_doi_als_quelle_vorhanden')
  }
  const { meta } = await Aufnahme.metadaten(wert)
  if (!meta.gefunden) throw new Problem(404, 'doi_nicht_gefunden', 'spur_fehler_doi_nicht_gefunden')
  const eintrag = { _id: new ObjectId(), projectId, doi: wert, meta, status: 'offen', angelegtVon: userId, angelegtAm: jetzt() }
  try {
    await (await beschaffungen()).insertOne(eintrag)
  } catch (error) {
    if (error.code === 11000) {
      throw new Problem(409, 'beschaffung_vorhanden', 'spur_fehler_beschaffung_vorhanden')
    }
    throw error
  }
  return eintrag
}

// Legt die DOI mit dem Grund auf die Liste; steht sie schon dort, bekommt der Eintrag nur Grund und Adresse.
async function vormerken({ projectId, userId, doi, grund, adresse }) {
  const sammlung = await beschaffungen()
  const { matchedCount } = await sammlung.updateOne({ projectId, doi }, { $set: { grund, adresse } })
  if (matchedCount) return
  const { meta } = await Aufnahme.metadaten(doi)
  try {
    await sammlung.insertOne({ _id: new ObjectId(), projectId, doi, meta, status: 'offen', grund, adresse, angelegtVon: userId, angelegtAm: jetzt() })
  } catch (error) {
    // Ein gleichzeitiger Aufruf hat den Eintrag schon angelegt.
    if (error.code !== 11000) throw error
  }
}

// Aufnahme per DOI. Scheitert sie an der Bezahlschranke (nicht_frei) oder am Bot-Schutz der Server (bot_schutz),
// steht die DOI danach mit diesem Grund auf der Beschaffungsliste; der Fehler geht trotzdem an den Aufrufer.
export async function aufnehmenOderVormerken({ projectId, userId, doi }) {
  try {
    return await Aufnahme.perDoi({ projectId, userId, doi })
  } catch (error) {
    const wert = Aufnahme.doiNormal(doi)
    if (error.typ === 'pdf_fehlt') {
      await Suchprotokoll.aufnahmeFehlerMerken(projectId, wert, 'pdf_fehlt').catch(merkFehler =>
        logger.warn({ err: merkFehler, doi: wert }, 'spur: gescheiterte Aufnahme nicht im Suchprotokoll vermerkt')
      )
    }
    if (!['nicht_frei', 'bot_schutz'].includes(error.typ)) throw error
    try {
      await vormerken({ projectId, userId, doi: wert, grund: error.typ, adresse: error.zusatz?.adresse ?? null })
    } catch (vormerkFehler) {
      logger.warn({ err: vormerkFehler, doi }, 'spur: DOI nicht auf die Beschaffungsliste gesetzt')
      throw error
    }
    throw error.typ === 'bot_schutz'
      ? new Problem(502, 'bot_schutz', 'spur_fehler_bot_schutz_vorgemerkt', undefined, error.zusatz)
      : new Problem(409, 'nicht_frei', 'spur_fehler_nicht_frei_vorgemerkt')
  }
}

export async function liste(projectId, { seite = 0 } = {}) {
  const sammlung = await beschaffungen()
  const [eintraege, offen, beschafft] = await Promise.all([
    sammlung.find({ projectId }).sort({ angelegtAm: -1, _id: -1 }).skip(seite * SEITE).limit(SEITE).toArray(),
    sammlung.countDocuments({ projectId, status: 'offen' }),
    sammlung.countDocuments({ projectId, status: 'beschafft' }),
  ])
  return { eintraege, offen, beschafft, weiter: (seite + 1) * SEITE < offen + beschafft }
}

export async function vorlage(userId) {
  const eintrag = await (await einstellungen()).findOne({ projectId: null, userId })
  return eintrag?.bibliothek ?? STANDARD_VORLAGE
}

export async function vorlageSetzen(userId, wert) {
  const text = String(wert ?? '').trim()
  let gueltig = false
  try {
    gueltig = ['http:', 'https:'].includes(new URL(text.replaceAll('{doi}', 'x')).protocol)
  } catch {}
  if (!gueltig || !text.includes('{doi}')) {
    throw new Problem(
      400,
      'vorlage_ungueltig',
      'spur_fehler_vorlage_ungueltig'
    )
  }
  await (await einstellungen()).updateOne({ projectId: null, userId }, { $set: { bibliothek: text } }, { upsert: true })
  return text
}

export const link = (vorlage, doi) => vorlage.replaceAll('{doi}', doiPfad(doi))

function risEintrag({ doi, meta }) {
  const zeilen = [
    ['TY', 'JOUR'],
    ['TI', meta.titel],
    ...(meta.autoren ?? []).map(a => ['AU', autorName(a)]),
    ['PY', meta.jahr],
    ['JO', meta.journal],
    ['SP', meta.seiten],
    ['DO', doi],
    ['ER', ''],
  ].filter(([feld, wert]) => feld === 'ER' || wert)
  return zeilen.map(([feld, wert]) => `${feld}  - ${String(wert).replace(/\s+/g, ' ')}`.trimEnd()).join('\n')
}

export async function exportieren(projectId, format) {
  const eintraege = await (await beschaffungen()).find({ projectId }).sort({ angelegtAm: 1, _id: 1 }).toArray()
  const datei = `beschaffungsliste.${format}`
  if (format === 'bib') {
    const belegt = new Set()
    const bloecke = eintraege.map(e => {
      const key = freierKey(keyVorschlag(e.meta), belegt)
      belegt.add(key)
      return bibEintrag(key, { meta: e.meta, doi: e.doi, dateiname: e.doi })
    })
    return { dateiname: datei, typ: 'application/x-bibtex', inhalt: `${bloecke.join('\n\n')}\n` }
  }
  if (format === 'ris') {
    return { dateiname: datei, typ: 'application/x-research-info-systems', inhalt: `${eintraege.map(risEintrag).join('\n')}\n` }
  }
  if (format === 'csv') {
    const zeilen = eintraege.map(e => [
      e.doi,
      e.meta.titel,
      (e.meta.autoren ?? []).map(autorName).join('; '),
      e.meta.jahr,
      e.status === 'offen' ? 'Offen' : 'Beschafft',
    ])
    return { dateiname: datei, typ: 'text/csv', inhalt: csv(['DOI', 'Titel', 'Autoren', 'Jahr', 'Status'], zeilen) }
  }
  throw new Problem(400, 'format_ungueltig', 'spur_fehler_format_ungueltig')
}

// Erst Quelle und .bib, dann der Status: Scheitert ein Schritt, bleibt der Eintrag offen und wiederholbar.
async function beschaffen(projectId, eintrag, quelle, userId) {
  if (quelle.doi && quelle.doi.toLowerCase() !== eintrag.doi) {
    throw new Problem(409, 'andere_doi', 'spur_fehler_andere_doi', { dateiname: quelle.dateiname, doi: quelle.doi })
  }
  // Metadaten der Quelle sind frischer als die der Liste und tragen schon die Reihenfolge der Autoren aus dem PDF.
  const meta = quelle.meta?.gefunden ? quelle.meta : eintrag.meta
  const mitDoi = { ...quelle, doi: eintrag.doi, meta }
  // Ein Upload mit Ersatzangaben behält metadaten: 'unvollstaendig': Sein @misc-Eintrag bleibt, spur ändert keine Einträge.
  await (await quellen()).updateOne({ _id: quelle._id }, { $set: { doi: eintrag.doi, meta } })
  await ZitatManager.bibSicherstellen(projectId, await PruefManager.dokumente(projectId), mitDoi, userId)
  const ergebnis = await (await beschaffungen()).findOneAndUpdate(
    { _id: eintrag._id, status: 'offen' },
    { $set: { status: 'beschafft', quelleId: quelle._id, beschafftAm: jetzt() } },
    { returnDocument: 'after' }
  )
  if (!ergebnis) throw new Problem(409, 'schon_beschafft', 'spur_fehler_schon_beschafft')
  return ergebnis
}

// Nach dem Hochladen: Trägt das PDF die DOI eines offenen Eintrags, ist er beschafft. Sonst null.
export async function perDoiZuordnen(projectId, quelle, userId) {
  if (!quelle.doi) return null
  const eintrag = await (await beschaffungen()).findOne({ projectId, doi: quelle.doi.toLowerCase(), status: 'offen' })
  return eintrag ? await beschaffen(projectId, eintrag, quelle, userId) : null
}

export async function zuordnen(projectId, eintragId, quelleId, userId) {
  if (!ObjectId.isValid(eintragId)) throw fehlt()
  const eintrag = await (await beschaffungen()).findOne({ _id: new ObjectId(eintragId), projectId })
  if (!eintrag) throw fehlt()
  if (eintrag.status !== 'offen') throw new Problem(409, 'schon_beschafft', 'spur_fehler_schon_beschafft')
  const quelle = await QuellenManager.holen(projectId, quelleId)
  return await beschaffen(projectId, eintrag, quelle, userId)
}
