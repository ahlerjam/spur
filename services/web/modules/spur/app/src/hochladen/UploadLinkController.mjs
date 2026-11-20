// POST /spur/hochladen/:token – ohne Sitzung und CSRF; das Token entscheidet. Antwortet je Datei mit Quellen-ID
// oder Grund, im Format, das das Plugin-Skript spur-hochladen ausgibt.
import { open, rm } from 'node:fs/promises'
import Path from 'node:path'
import { meldung } from '../meldungen.mjs'
import { titelFeld } from '../pdf.mjs'
import { mitProblemen, Problem, problemSenden } from '../probleme.mjs'
import * as QuellenManager from '../QuellenManager.mjs'
import { quellen } from '../sammlungen.mjs'
import { rolleFuerClaude } from '../rechte.mjs'
import { jetzt } from '../schalter.mjs'
import * as Aufnahme from '../recherche/Aufnahme.mjs'
import * as Beschaffung from '../recherche/Beschaffung.mjs'
import { autorenAusText, metadatenOhneDoi, WERKFELDER } from '../recherche/ohneDoi.mjs'
import { doiPruefen } from '../recherche/Recherche.mjs'
import { literaturBefund } from '../recherche/autorenabgleich.mjs'
import { titelBefund } from '../recherche/titelabgleich.mjs'
import * as LaufManager from '../schreiben/LaufManager.mjs'
import * as UploadLink from './UploadLink.mjs'

const ANLEGEN = ['readAndWrite', 'owner']

// Vor dem Annehmen der Datei: Ein ungültiger, abgelaufener oder verbrauchter Link nimmt nichts an.
export async function linkPruefen(req, res, next) {
  try {
    await UploadLink.pruefen(req.params.token)
    next()
  } catch (error) {
    if (error instanceof Problem) return problemSenden(res, error)
    next(error)
  }
}

export function ohneToken(_req, res) {
  problemSenden(res, UploadLink.ungueltig())
}

async function istPdf(pfad) {
  const datei = await open(pfad)
  try {
    const { buffer, bytesRead } = await datei.read(Buffer.alloc(5), 0, 5, 0)
    return bytesRead === 5 && buffer.toString('latin1') === '%PDF-'
  } finally {
    await datei.close()
  }
}

// Metadaten der angegebenen DOI, damit Titel und .bib nicht von einer DOI im PDF-Text abhängen. Ohne Antwort des
// Registers entsteht die Quelle trotzdem; hinweis sagt dann, warum die Angaben fehlen.
async function doiMetadaten(doi) {
  try {
    const { meta } = await Aufnahme.metadaten(doi)
    return meta.gefunden ? { meta } : { hinweis: meldung('spur_hinweis_doi_nicht_gefunden', { doi }) }
  } catch (error) {
    if (error instanceof Problem) return { hinweis: meldung('spur_hinweis_doi_crossref_fehlt') }
    throw error
  }
}

// Ohne Metadaten: Titel aus dem Formular, sonst aus dem PDF, sonst der Dateiname; der Eintrag wird @misc.
async function ersatzMeta(req, stamm) {
  const titel = req.body?.titel ? String(req.body.titel).slice(0, 500) : await titelFeld(req.file.path).catch(() => null)
  return { titel: titel || stamm, art: 'misc' }
}

// Ohne DOI, aber mit Angaben zum Werk (Autoren, Jahr, Art, Institution): Die Quelle bekommt wie bei source_add mit
// pdf_url einen Key aus Nachname und Jahr und einen .bib-Eintrag passend zur Art.
async function ohneDoiAufnehmen(link, req, dateiname) {
  const { autoren, ...felder } = req.body
  const angaben = metadatenOhneDoi({ ...felder, autoren: autorenAusText(autoren) })
  const meta = angaben.url ? { ...angaben, abgerufenAm: jetzt() } : angaben
  const alle = await QuellenManager.alle(link.projectId)
  const vorhanden = alle.find(q => q.dateiname === dateiname)
  if (vorhanden) return { vorhanden }
  const { key, docs } = await Aufnahme.neuerKey(link.projectId, alle, meta)
  const quelle = await QuellenManager.aufnehmen({
    projectId: link.projectId,
    userId: link.menschId,
    dateiname,
    tempPfad: req.file.path,
    groesse: req.file.size,
    key,
    meta,
  })
  return await Aufnahme.mitBibEintrag(link.projectId, docs, quelle, link.menschId)
}

// Jeder Upload bekommt einen .bib-Eintrag: mit DOI aus Crossref wie bei source_add, sonst @misc mit dem Vermerk
// metadaten: 'unvollstaendig'.
async function neueQuelle(link, req, dateiname) {
  const doi = req.body?.doi ? doiPruefen(String(req.body.doi)) : undefined
  if (!doi && WERKFELDER.some(feld => req.body?.[feld])) return await ohneDoiAufnehmen(link, req, dateiname)
  const alle = await QuellenManager.alle(link.projectId)
  const vorhanden = alle.find(q => q.dateiname === dateiname || (doi && q.doi?.toLowerCase() === doi.toLowerCase()))
  if (vorhanden) return { vorhanden }
  const register = doi ? await doiMetadaten(doi) : { hinweis: meldung('spur_hinweis_metadaten_ohne_doi') }
  const stamm = Path.basename(dateiname, Path.extname(dateiname))
  const { key, docs } = await Aufnahme.neuerKey(link.projectId, alle, register.meta ?? { titel: stamm })
  const quelle = await QuellenManager.aufnehmen({
    projectId: link.projectId,
    userId: link.menschId,
    dateiname,
    tempPfad: req.file.path,
    groesse: req.file.size,
    key,
    doi,
    meta: register.meta ?? (await ersatzMeta(req, stamm)),
    ...(!register.meta && { metadaten: 'unvollstaendig' }),
  })
  const angelegt = await Aufnahme.mitBibEintrag(link.projectId, docs, quelle, link.menschId)
  return register.meta ? angelegt : { ...angelegt, metadatenHinweis: register.hinweis }
}

async function aufnehmen(link, req, dateiname) {
  try {
    return await neueQuelle(link, req, dateiname)
  } catch (error) {
    if (error instanceof Problem && error.typ === 'quelle_vorhanden') {
      const vorhanden = await (await quellen()).findOne({ projectId: link.projectId, dateiname })
      if (vorhanden) return { vorhanden }
    }
    throw error
  }
}

export const hochladen = mitProblemen(async (req, res) => {
  try {
    const link = await UploadLink.verbrauchen(req.params.token)
    // Das Recht kann sich seit dem Erzeugen des Links geändert haben.
    if (!ANLEGEN.includes(await rolleFuerClaude(link.menschId, link.projectId))) {
      throw new Problem(403, 'keine_rechte', 'spur_fehler_projektrolle')
    }
    if (!req.file) throw new Problem(400, 'datei_fehlt', 'spur_fehler_datei_fehlt')
    const dateiname = Buffer.from(req.file.originalname, 'latin1').toString('utf8')
    if (!(await istPdf(req.file.path))) {
      return res.json({ datei: dateiname, status: 'abgelehnt', grund: meldung('spur_fehler_keine_pdf') })
    }
    let ergebnis
    try {
      ergebnis = await aufnehmen(link, req, dateiname)
    } catch (error) {
      if (!(error instanceof Problem)) throw error
      return res.json({ datei: dateiname, status: 'abgelehnt', grund: error.message })
    }
    if (ergebnis.vorhanden) {
      return res.json({ datei: dateiname, status: 'vorhanden', quelle_id: String(ergebnis.vorhanden._id) })
    }
    const eintrag = await Beschaffung.perDoiZuordnen(link.projectId, ergebnis, link.menschId)
    const lauf = await LaufManager.laufFuerSchreiben(link.projectId, link.botId)
    await LaufManager.angelegtMerken(lauf, [{ art: 'quelle', quelleId: ergebnis._id, name: dateiname }])
    res.json({
      datei: dateiname,
      status: 'angelegt',
      quelle_id: String(ergebnis._id),
      key: ergebnis.key,
      ...titelBefund(ergebnis),
      ...literaturBefund(ergebnis),
      ...(ergebnis.metadatenHinweis && { metadaten_hinweis: ergebnis.metadatenHinweis }),
      ...(eintrag && { beschaffung_id: String(eintrag._id) }),
    })
  } finally {
    if (req.file) await rm(req.file.path, { force: true })
  }
})
