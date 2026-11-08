import { ObjectId } from '../../../../../app/src/infrastructure/mongodb.mjs'
import { csv } from '../csv.mjs'
import { Problem } from '../probleme.mjs'
import * as QuellenManager from '../QuellenManager.mjs'
import * as ZitatManager from '../ZitatManager.mjs'
import * as PruefManager from '../pruefung/PruefManager.mjs'
import { bibEintrag } from '../pruefung/bib.mjs'
import { beschaffungen, einstellungen, quellen } from '../sammlungen.mjs'
import { jetzt } from '../schalter.mjs'
import * as Aufnahme from './Aufnahme.mjs'
import { freierKey, keyVorschlag } from './keys.mjs'

const SEITE = 50
export const STANDARD_VORLAGE = 'https://doi.org/{doi}'

const fehlt = () =>
  new Problem(404, 'beschaffung_fehlt', 'Diesen Eintrag gibt es nicht mehr. Bitte die Liste neu laden.')

export async function hinzufuegen({ projectId, userId, doi }) {
  const wert = Aufnahme.doiNormal(doi)
  if ((await QuellenManager.alle(projectId)).some(q => q.doi?.toLowerCase() === wert)) {
    throw new Problem(409, 'quelle_vorhanden', 'Bereits als Quelle vorhanden')
  }
  const { meta } = await Aufnahme.metadaten(wert)
  if (!meta.gefunden) throw new Problem(404, 'doi_nicht_gefunden', 'DOI nicht gefunden')
  const eintrag = { _id: new ObjectId(), projectId, doi: wert, meta, status: 'offen', angelegtVon: userId, angelegtAm: jetzt() }
  try {
    await (await beschaffungen()).insertOne(eintrag)
  } catch (error) {
    if (error.code === 11000) {
      throw new Problem(409, 'beschaffung_vorhanden', 'Steht schon auf der Beschaffungsliste')
    }
    throw error
  }
  return eintrag
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
      'Die Vorlage braucht eine http- oder https-Adresse mit {doi}, etwa https://bibliothek.example/?doi={doi}.'
    )
  }
  await (await einstellungen()).updateOne({ projectId: null, userId }, { $set: { bibliothek: text } }, { upsert: true })
  return text
}

// Der Schrägstrich der DOI bleibt lesbar; Resolver und doi.org verstehen ihn so.
export const link = (vorlage, doi) => vorlage.replaceAll('{doi}', encodeURIComponent(doi).replace(/%2F/gi, '/'))

function risEintrag({ doi, meta }) {
  const zeilen = [
    ['TY', 'JOUR'],
    ['TI', meta.titel],
    ...(meta.autoren ?? []).map(a => ['AU', [a.family, a.given].filter(Boolean).join(', ')]),
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
      (e.meta.autoren ?? []).map(a => [a.family, a.given].filter(Boolean).join(', ')).join('; '),
      e.meta.jahr,
      e.status === 'offen' ? 'Offen' : 'Beschafft',
    ])
    return { dateiname: datei, typ: 'text/csv', inhalt: csv(['DOI', 'Titel', 'Autoren', 'Jahr', 'Status'], zeilen) }
  }
  throw new Problem(400, 'format_ungueltig', 'Exportformate: bib, ris oder csv.')
}

async function beschaffen(projectId, eintrag, quelle, userId) {
  const ergebnis = await (await beschaffungen()).findOneAndUpdate(
    { _id: eintrag._id, status: 'offen' },
    { $set: { status: 'beschafft', quelleId: quelle._id, beschafftAm: jetzt() } },
    { returnDocument: 'after' }
  )
  if (!ergebnis) throw new Problem(409, 'schon_beschafft', 'Dieser Eintrag ist schon beschafft.')
  const mitDoi = { ...quelle, doi: eintrag.doi, meta: eintrag.meta }
  await (await quellen()).updateOne({ _id: quelle._id }, { $set: { doi: eintrag.doi, meta: eintrag.meta } })
  await ZitatManager.bibSicherstellen(projectId, await PruefManager.dokumente(projectId), mitDoi, userId)
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
  if (eintrag.status !== 'offen') throw new Problem(409, 'schon_beschafft', 'Dieser Eintrag ist schon beschafft.')
  const quelle = await QuellenManager.holen(projectId, quelleId)
  return await beschaffen(projectId, eintrag, quelle, userId)
}
