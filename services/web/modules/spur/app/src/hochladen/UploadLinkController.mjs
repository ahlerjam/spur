// POST /spur/hochladen/:token – ohne Sitzung und CSRF; das Token entscheidet. Antwortet je Datei mit Quellen-ID
// oder Grund, im Format, das das Plugin-Skript spur-hochladen ausgibt; ein Link für Projektdateien (file_upload_link)
// legt die Datei unter dem Pfad aus dem Feld projektdatei an.
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
import { autorenAusText, eingabeUngueltig, kurz, metadatenOhneDoi, WERKFELDER } from '../recherche/ohneDoi.mjs'
import { doiPruefen } from '../recherche/Recherche.mjs'
import { literaturBefund } from '../recherche/autorenabgleich.mjs'
import { titelBefund } from '../recherche/titelabgleich.mjs'
import * as LaufManager from '../schreiben/LaufManager.mjs'
import * as Projektdatei from './Projektdatei.mjs'
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
  const titel = kurz(req.body?.titel, 500) || (await titelFeld(req.file.path).catch(() => null))
  return { titel: titel || stamm, art: 'misc' }
}

// Angaben zum Werk ohne DOI (Autoren, Jahr, Art, Institution) ergeben wie bei source_add mit pdf_url einen Key aus
// Nachname und Jahr und einen .bib-Eintrag passend zur Art.
function angabenOhneDoi(body) {
  const { autoren, ...felder } = body
  const angaben = metadatenOhneDoi({ ...felder, autoren: autorenAusText(autoren) })
  return angaben.url ? { ...angaben, abgerufenAm: jetzt() } : angaben
}

// Jeder Upload bekommt einen .bib-Eintrag: mit DOI aus Crossref wie bei source_add, mit Angaben zum Werk passend zur
// Art, ohne beides aus einer DOI im PDF, sonst @misc mit dem Vermerk metadaten: 'unvollstaendig' und einem Hinweis.
async function neueQuelle(link, req, dateiname) {
  const doi = req.body?.doi ? doiPruefen(String(req.body.doi)) : undefined
  const mitAngaben = !doi && WERKFELDER.some(feld => req.body?.[feld])
  const alle = await QuellenManager.alle(link.projectId)
  const vorhanden = alle.find(q => q.dateiname === dateiname || (doi && q.doi?.toLowerCase() === doi.toLowerCase()))
  if (vorhanden) return { vorhanden }
  const register = mitAngaben ? { meta: angabenOhneDoi(req.body) } : doi ? await doiMetadaten(doi) : { hinweis: meldung('spur_hinweis_metadaten_ohne_doi') }
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
    meta: register.meta,
    ...(!register.meta && { ersatz: await ersatzMeta(req, stamm) }),
  })
  await Aufnahme.mitBibEintrag(link.projectId, docs, quelle, link.menschId)
  return { quelle, hinweis: quelle.metadaten ? register.hinweis : null }
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
    const projektdatei = req.body?.projektdatei
    if (link.art === 'datei') {
      if (!projektdatei) throw eingabeUngueltig('projektdatei')
      const { projectId, menschId, botId } = link
      const { pfad } = await Projektdatei.anlegen({ projectId, menschId, botId, pfad: String(projektdatei), datei: req.file.path, groesse: req.file.size })
      return res.json({ datei: dateiname, status: 'angelegt', pfad })
    }
    if (projektdatei) throw new Problem(422, 'falscher_link', 'spur_fehler_link_nur_quellen')
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
    const { quelle, hinweis } = ergebnis
    const eintrag = await Beschaffung.perDoiZuordnen(link.projectId, quelle, link.menschId)
    const lauf = await LaufManager.laufFuerSchreiben(link.projectId, link.botId)
    await LaufManager.angelegtMerken(lauf, [{ art: 'quelle', quelleId: quelle._id, name: dateiname }])
    res.json({
      datei: dateiname,
      status: 'angelegt',
      quelle_id: String(quelle._id),
      key: quelle.key,
      ...titelBefund(quelle),
      ...literaturBefund(quelle),
      ...(hinweis && { metadaten_hinweis: hinweis }),
      ...(eintrag && { beschaffung_id: String(eintrag._id) }),
    })
  } finally {
    if (req.file) await rm(req.file.path, { force: true })
  }
})
