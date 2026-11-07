import { createReadStream } from 'node:fs'
import SessionManager from '../../../../app/src/Features/Authentication/SessionManager.mjs'
import CollaboratorsGetter from '../../../../app/src/Features/Collaborators/CollaboratorsGetter.mjs'
import { ObjectId } from '../../../../app/src/infrastructure/mongodb.mjs'
import * as PruefManager from './pruefung/PruefManager.mjs'
import * as QuellenManager from './QuellenManager.mjs'
import { Problem, mitProblemen } from './probleme.mjs'

const projektId = req => new ObjectId(req.params.project_id)
const nutzerId = req => SessionManager.getLoggedInUserId(req.session)

function quelleFuerClient(q) {
  return {
    id: q._id,
    dateiname: q.dateiname,
    key: q.key,
    art: q.art,
    seitenzahl: q.seitenzahl,
    status: q.status,
    doi: q.doi,
    titel: q.meta?.titel ?? null,
    fassung: q.fassung,
    versatz: q.versatz,
    versatzQuelle: q.versatzQuelle,
  }
}

async function nurMitglieder(req) {
  const mitglied = await CollaboratorsGetter.promises.isUserInvitedMemberOfProject(
    nutzerId(req),
    req.params.project_id
  )
  if (!mitglied) {
    throw new Problem(
      403,
      'nur_mitglieder',
      'Quelldateien können nur Projektmitglieder herunterladen. Bitte um eine Einladung.'
    )
  }
}

export const quellenListe = mitProblemen(async (req, res) => {
  const seite = Math.max(0, Number.parseInt(req.query.seite, 10) || 0)
  const ergebnis = await QuellenManager.liste(projektId(req), { seite })
  res.json({ ...ergebnis, quellen: ergebnis.quellen.map(quelleFuerClient) })
})

export const quelleHochladen = mitProblemen(async (req, res) => {
  if (!req.file) {
    throw new Problem(400, 'datei_fehlt', 'Es kam keine Datei an. Bitte erneut hochladen.')
  }
  const quelle = await QuellenManager.aufnehmen({
    projectId: projektId(req),
    userId: new ObjectId(nutzerId(req)),
    dateiname: Buffer.from(req.file.originalname, 'latin1').toString('utf8'),
    tempPfad: req.file.path,
    groesse: req.file.size,
  })
  res.status(201).json(quelleFuerClient(quelle))
})

export const quellenSuche = mitProblemen(async (req, res) => {
  const begriff = String(req.query.q ?? '').trim()
  if (!begriff) return res.json({ treffer: [] })
  res.json({ treffer: await QuellenManager.suchen(projektId(req), begriff) })
})

export const quelleSeite = mitProblemen(async (req, res) => {
  const quelle = await QuellenManager.holen(projektId(req), req.params.quelle_id)
  const nummer = Number.parseInt(req.params.seite, 10)
  const { text, label, seite } = await QuellenManager.seite(quelle, nummer)
  res.json({ text, label, seite, seitenzahl: quelle.seitenzahl, art: quelle.art })
})

export const quelleBild = mitProblemen(async (req, res) => {
  const quelle = await QuellenManager.holen(projektId(req), req.params.quelle_id)
  const nummer = Number.parseInt(req.params.seite, 10)
  await QuellenManager.seite(quelle, nummer)
  res.type('png').sendFile(await QuellenManager.bild(quelle, nummer))
})

export const quelleDatei = mitProblemen(async (req, res) => {
  await nurMitglieder(req)
  const quelle = await QuellenManager.holen(projektId(req), req.params.quelle_id)
  res.attachment(quelle.dateiname)
  createReadStream(QuellenManager.dateiPfad(quelle)).pipe(res)
})

export const quelleAendern = mitProblemen(async (req, res) => {
  const quelle = await QuellenManager.holen(projektId(req), req.params.quelle_id)
  const { fassung, versatz } = req.body
  if (fassung !== undefined && (typeof fassung !== 'string' || fassung.length > 200)) {
    throw new Problem(422, 'fassung', 'Die Fassung darf höchstens 200 Zeichen lang sein.')
  }
  if (versatz !== undefined && versatz !== null && !Number.isInteger(versatz)) {
    throw new Problem(422, 'versatz', 'Der Versatz muss eine ganze Zahl sein.')
  }
  res.json(quelleFuerClient(await QuellenManager.aendern(quelle, { fassung, versatz })))
})

export const pruefbericht = mitProblemen(async (req, res) => {
  res.json(await PruefManager.bericht(projektId(req)))
})
