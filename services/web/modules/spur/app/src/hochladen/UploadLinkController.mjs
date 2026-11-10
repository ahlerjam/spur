// POST /spur/hochladen/:token – ohne Sitzung und CSRF; das Token entscheidet. Antwortet je Datei mit Quellen-ID
// oder Grund, im Format, das das Plugin-Skript spur-hochladen ausgibt.
import { open, rm } from 'node:fs/promises'
import { meldung } from '../meldungen.mjs'
import { mitProblemen, Problem, problemSenden } from '../probleme.mjs'
import * as QuellenManager from '../QuellenManager.mjs'
import { quellen } from '../sammlungen.mjs'
import { rolleFuerClaude } from '../rechte.mjs'
import * as Beschaffung from '../recherche/Beschaffung.mjs'
import { doiPruefen } from '../recherche/Recherche.mjs'
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
  problemSenden(res, new Problem(401, 'token', 'spur_fehler_link_ungueltig'))
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

async function aufnehmen(link, req, dateiname) {
  const doi = req.body?.doi ? doiPruefen(String(req.body.doi)) : undefined
  const titel = req.body?.titel ? String(req.body.titel).slice(0, 500) : undefined
  try {
    return await QuellenManager.aufnehmen({
      projectId: link.projectId,
      userId: link.menschId,
      dateiname,
      tempPfad: req.file.path,
      groesse: req.file.size,
      doi,
      meta: titel ? { titel } : undefined,
    })
  } catch (error) {
    if (error instanceof Problem && error.typ === 'quelle_vorhanden') {
      const vorhanden = await (await quellen()).findOne({ projectId: link.projectId, dateiname })
      return { vorhanden }
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
      ...(eintrag && { beschaffung_id: String(eintrag._id) }),
    })
  } finally {
    if (req.file) await rm(req.file.path, { force: true })
  }
})
