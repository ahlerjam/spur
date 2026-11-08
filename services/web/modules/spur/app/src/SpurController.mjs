import { createReadStream } from 'node:fs'
import { rm } from 'node:fs/promises'
import { pipeline } from 'node:stream/promises'
import logger from '@overleaf/logger'
import SessionManager from '../../../../app/src/Features/Authentication/SessionManager.mjs'
import CollaboratorsGetter from '../../../../app/src/Features/Collaborators/CollaboratorsGetter.mjs'
import { db, ObjectId } from '../../../../app/src/infrastructure/mongodb.mjs'
import * as PruefManager from './pruefung/PruefManager.mjs'
import * as QuellenManager from './QuellenManager.mjs'
import * as ZitatManager from './ZitatManager.mjs'
import * as Team from './Team.mjs'
import * as ClaudeZugang from './ClaudeZugang.mjs'
import * as Inbox from './Inbox.mjs'
import * as LaufAktionen from './schreiben/LaufAktionen.mjs'
import * as LaufManager from './schreiben/LaufManager.mjs'
import AuthorizationManager from '../../../../app/src/Features/Authorization/AuthorizationManager.mjs'
import { Problem, mitProblemen } from './probleme.mjs'

// Bricht der Browser ab, darf das den Prozess nicht beenden.
async function dateiSenden(pfad, res) {
  if (res.destroyed) return
  await pipeline(createReadStream(pfad), res).catch(error => {
    if (error.code !== 'ERR_STREAM_PREMATURE_CLOSE') {
      logger.warn({ err: error, pfad }, 'Quelldatei nicht lesbar')
    }
  })
}

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
  try {
    const quelle = await QuellenManager.aufnehmen({
      projectId: projektId(req),
      userId: new ObjectId(nutzerId(req)),
      dateiname: Buffer.from(req.file.originalname, 'latin1').toString('utf8'),
      tempPfad: req.file.path,
      groesse: req.file.size,
    })
    res.status(201).json(quelleFuerClient(quelle))
  } finally {
    await rm(req.file.path, { force: true })
  }
})

export const quellenSuche = mitProblemen(async (req, res) => {
  const begriff = String(req.query.q ?? '').trim()
  if (!begriff) return res.json({ treffer: [] })
  const [namen, imText] = await Promise.all([
    QuellenManager.dateinamenSuchen(projektId(req), begriff),
    QuellenManager.suchen(projektId(req), begriff),
  ])
  // Treffer im Dateinamen bringen die Quelle mit: Sie steht nicht unbedingt in der geladenen Liste.
  const imNamen = namen.map(q => ({
    quelleId: q._id,
    dateiname: q.dateiname,
    art: q.art,
    seite: 1,
    label: null,
    auszug: '',
    imDateinamen: true,
    quelle: quelleFuerClient(q),
  }))
  res.json({ treffer: [...imNamen, ...imText] })
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
  if (quelle.art !== 'pdf') {
    throw new Problem(404, 'kein_bild', 'Nur PDF-Quellen haben Seitenbilder.')
  }
  const pfad = await QuellenManager.bild(quelle, nummer)
  res.type('png')
  await dateiSenden(pfad, res)
})

export const quelleDatei = mitProblemen(async (req, res) => {
  await nurMitglieder(req)
  const quelle = await QuellenManager.holen(projektId(req), req.params.quelle_id)
  res.attachment(quelle.dateiname)
  await dateiSenden(QuellenManager.dateiPfad(quelle), res)
})

export const quelleAendern = mitProblemen(async (req, res) => {
  const quelle = await QuellenManager.holen(projektId(req), req.params.quelle_id)
  const { fassung, versatz } = req.body
  if (fassung !== undefined && (typeof fassung !== 'string' || fassung.length > 200)) {
    throw new Problem(422, 'fassung', 'Die Fassung darf höchstens 200 Zeichen lang sein.')
  }
  if (versatz !== undefined && quelle.art !== 'pdf') {
    throw new Problem(422, 'versatz', 'Nur PDF-Quellen haben Seitenzahlen.')
  }
  // Gedruckte Seitenzahlen liegen in Zeitschriften weit über der PDF-Seite, aber nie über 100000.
  if (versatz !== undefined && versatz !== null && !(Number.isInteger(versatz) && Math.abs(versatz) <= 100000)) {
    throw new Problem(422, 'versatz', 'Der Versatz muss eine ganze Zahl zwischen -100000 und 100000 sein.')
  }
  res.json(quelleFuerClient(await QuellenManager.aendern(quelle, { fassung, versatz })))
})

export const quelleLoeschen = mitProblemen(async (req, res) => {
  const quelle = await QuellenManager.holen(projektId(req), req.params.quelle_id)
  await QuellenManager.loeschen(quelle)
  res.sendStatus(204)
})

export const quellenExport = mitProblemen(async (req, res) => {
  await nurMitglieder(req)
  res.attachment('quellen.zip')
  await QuellenManager.zipSchreiben(projektId(req), res)
})

export const andereProjekte = mitProblemen(async (req, res) => {
  res.json({
    projekte: await QuellenManager.projekteMitQuellen(
      new ObjectId(nutzerId(req)),
      projektId(req)
    ),
    klonVon: await QuellenManager.klonHinweis(projektId(req)),
  })
})

export const quellenHolen = mitProblemen(async (req, res) => {
  const { projekt } = req.body
  if (!ObjectId.isValid(projekt)) {
    throw new Problem(422, 'projekt', 'Bitte ein Projekt auswählen.')
  }
  const darf = await CollaboratorsGetter.promises.isUserInvitedMemberOfProject(
    nutzerId(req),
    projekt
  )
  if (!darf) {
    throw new Problem(
      403,
      'nur_mitglieder',
      'Quellen lassen sich nur aus Projekten holen, in denen Sie Mitglied sind.'
    )
  }
  const anzahl = await QuellenManager.uebernehmen(
    projektId(req),
    new ObjectId(projekt),
    new ObjectId(nutzerId(req))
  )
  res.json({ anzahl })
})

async function zitateFuerClient(liste) {
  const ids = liste.flatMap(z => [
    z.angelegtVon,
    ...(z.kommentare ?? []).map(k => k.von),
    ...(z.zugewiesen ? [z.zugewiesen.an, z.zugewiesen.von] : []),
  ])
  const namen = await Team.namen(ids.filter(Boolean))
  const person = id => ({ id, name: Team.nameAus(namen, id) })
  return liste.map(z => ({
    id: z._id,
    seite: z.seite,
    label: z.label,
    text: z.text,
    von: person(z.angelegtVon),
    kommentare: (z.kommentare ?? []).map(k => ({ id: k._id, von: person(k.von), text: k.text, am: k.am })),
    zugewiesen: z.zugewiesen
      ? { an: person(z.zugewiesen.an), von: person(z.zugewiesen.von), am: z.zugewiesen.am }
      : null,
  }))
}

export const zitate = mitProblemen(async (req, res) => {
  const quelle = await QuellenManager.holen(projektId(req), req.params.quelle_id)
  res.json({ zitate: await zitateFuerClient(await ZitatManager.liste(quelle)) })
})

export const zitatMarkieren = mitProblemen(async (req, res) => {
  const quelle = await QuellenManager.holen(projektId(req), req.params.quelle_id)
  const seite = Number.parseInt(req.body.seite, 10)
  const zitat = await ZitatManager.markieren(
    quelle,
    { seite, text: req.body.text },
    new ObjectId(nutzerId(req))
  )
  res.status(201).json((await zitateFuerClient([zitat]))[0])
})

export const zitatKommentieren = mitProblemen(async (req, res) => {
  const quelle = await QuellenManager.holen(projektId(req), req.params.quelle_id)
  const { text, zuweisen } = req.body
  const zitat = await ZitatManager.kommentieren(
    quelle,
    req.params.zitat_id,
    { text, zuweisen },
    new ObjectId(nutzerId(req))
  )
  res.status(201).json((await zitateFuerClient([zitat]))[0])
})

export const zuweisungLoesen = mitProblemen(async (req, res) => {
  const quelle = await QuellenManager.holen(projektId(req), req.params.quelle_id)
  await ZitatManager.zuweisungLoesen(quelle, req.params.zitat_id)
  res.sendStatus(204)
})

export const team = mitProblemen(async (req, res) => {
  res.json({ ich: nutzerId(req), mitglieder: await Team.mitglieder(projektId(req)) })
})

export const zugewiesen = mitProblemen(async (req, res) => {
  const liste = await ZitatManager.zugewiesenAn(projektId(req), new ObjectId(nutzerId(req)))
  const fuerClient = await zitateFuerClient(liste)
  const quellen = await Promise.all(liste.map(z => QuellenManager.holen(projektId(req), z.quelleId)))
  res.json({
    zitate: fuerClient.map((z, i) => ({ ...z, quelle: quelleFuerClient(quellen[i]) })),
  })
})

export const zitatEinfuegen = mitProblemen(async (req, res) => {
  const quelle = await QuellenManager.holen(projektId(req), req.params.quelle_id)
  const zitat = await ZitatManager.holen(quelle, req.params.zitat_id)
  res.json(
    await ZitatManager.einfuegen(
      projektId(req),
      quelle,
      zitat,
      new ObjectId(nutzerId(req))
    )
  )
})

export const pruefbericht = mitProblemen(async (req, res) => {
  res.json(await PruefManager.bericht(projektId(req)))
})

export const claudeTokens = mitProblemen(async (req, res) => {
  res.json({ tokens: await ClaudeZugang.tokens(nutzerId(req)) })
})

export const claudeTokenErzeugen = mitProblemen(async (req, res) => {
  res.status(201).json(await ClaudeZugang.tokenErzeugen(nutzerId(req)))
})

export const claudeTokenWiderrufen = mitProblemen(async (req, res) => {
  await ClaudeZugang.widerrufen(nutzerId(req), req.params.token_id)
  res.sendStatus(204)
})

async function botDesNutzers(req) {
  const mensch = await db.users.findOne({ _id: new ObjectId(nutzerId(req)) })
  return await ClaudeZugang.botFuer(mensch)
}

export const claudeStatus = mitProblemen(async (req, res) => {
  const bot = await botDesNutzers(req)
  const liste = await Inbox.verlauf(projektId(req), bot._id)
  const [lauf, verbunden, automatik] = await Promise.all([
    LaufManager.letzterLauf(projektId(req), bot._id),
    Inbox.verbunden(bot._id),
    LaufAktionen.automatik(projektId(req), new ObjectId(nutzerId(req))),
  ])
  res.json({
    verbunden,
    nachrichten: liste.reverse().map(n => ({ id: n._id, von: n.von, text: n.text, am: n.am })),
    automatik,
    ...(await LaufAktionen.laufDaten(projektId(req), lauf)),
  })
})

export const claudeAuftrag = mitProblemen(async (req, res) => {
  const text = typeof req.body.text === 'string' ? req.body.text.trim() : ''
  if (!text || text.length > 20000) {
    throw new Problem(422, 'auftrag', 'Bitte einen Auftrag mit 1 bis 20000 Zeichen schreiben.')
  }
  const bot = await botDesNutzers(req)
  const nachricht = await Inbox.auftragAnlegen({ projectId: projektId(req), botId: bot._id, text })
  res.status(201).json({ id: nachricht._id })
})

const changeIds = req => {
  const ids = req.body?.change_ids
  if (ids === undefined) return undefined
  if (!Array.isArray(ids) || !ids.every(id => typeof id === 'string')) {
    throw new Problem(422, 'change_ids', 'change_ids muss eine Liste von Texten sein.')
  }
  return ids
}

export const laufAnnehmen = mitProblemen(async (req, res) => {
  const lauf = await LaufAktionen.laufHolen(projektId(req), req.params.lauf_id)
  res.json(
    await LaufAktionen.annehmen(projektId(req), lauf, new ObjectId(nutzerId(req)), changeIds(req))
  )
})

// review darf nur Changes des eigenen Bots ablehnen.
export const laufAblehnen = mitProblemen(async (req, res) => {
  const userId = new ObjectId(nutzerId(req))
  const stufe = await AuthorizationManager.promises.getPrivilegeLevelForProject(
    userId,
    req.params.project_id,
    null
  )
  const nurBot = stufe === 'review' ? (await botDesNutzers(req))._id : undefined
  const lauf = await LaufAktionen.laufHolen(projektId(req), req.params.lauf_id, nurBot)
  res.json(await LaufAktionen.ablehnen(projektId(req), lauf, userId, changeIds(req)))
})

export const laufZuruecknehmen = mitProblemen(async (req, res) => {
  const lauf = await LaufAktionen.laufHolen(projektId(req), req.params.lauf_id)
  await LaufAktionen.zuruecknehmen(projektId(req), lauf, new ObjectId(nutzerId(req)))
  res.sendStatus(204)
})

export const automatikSetzen = mitProblemen(async (req, res) => {
  if (typeof req.body.an !== 'boolean') {
    throw new Problem(422, 'automatik', 'an muss true oder false sein.')
  }
  await LaufAktionen.automatikSetzen(projektId(req), new ObjectId(nutzerId(req)), req.body.an)
  res.sendStatus(204)
})
