import { ObjectId } from '../../../../../app/src/infrastructure/mongodb.mjs'
import { botVon } from '../anfrage.mjs'
import * as Inbox from '../Inbox.mjs'
import { Problem } from '../probleme.mjs'
import { einstellungen, ereignisse, vorschlaege } from '../sammlungen.mjs'
import { jetzt } from '../schalter.mjs'

export const ARTEN = ['compile_fehler', 'belegloses_argument']
const WERTE = ['aus', 'vorschlag']
const STANDARD_LIMIT = 50
const MAX_LIMIT = 1000
// So viele offene Vorschläge zeigt das Panel; mehr lehnt suggest ab.
const MAX_OFFEN = 100

function artPruefen(art) {
  if (!ARTEN.includes(art)) {
    throw new Problem(422, 'schalter', 'spur_fehler_schalter', { erlaubt: ARTEN.join(', ') })
  }
}

function wertPruefen(wert) {
  if (!WERTE.includes(wert)) throw new Problem(422, 'schalter_wert', 'spur_fehler_schalter_wert', { erlaubt: WERTE.join(' oder ') })
}

const nachArt = quelle => Object.fromEntries(ARTEN.map(art => [art, quelle?.[art] ?? null]))

// Der Projekt-Standard liegt ohne userId, die eigene Einstellung mit; das Limit gilt je Mensch für alle Projekte.
const projektFilter = projectId => ({ projectId, userId: null })
const eigenerFilter = (projectId, menschId) => ({ projectId, userId: menschId })
const limitFilter = menschId => ({ projectId: null, userId: menschId })

function tagesbeginn() {
  const tag = jetzt()
  tag.setHours(0, 0, 0, 0)
  return tag
}

async function heuteAusgeloest(bot) {
  if (!bot) return 0
  return await (await ereignisse()).countDocuments({ botId: bot._id, typ: 'suggest_trigger', am: { $gte: tagesbeginn() } })
}

async function schalterLesen(projectId, menschId) {
  const sammlung = await einstellungen()
  const [projekt, eigene, limitEintrag] = await Promise.all([
    sammlung.findOne(projektFilter(projectId)),
    sammlung.findOne(eigenerFilter(projectId, menschId)),
    sammlung.findOne(limitFilter(menschId)),
  ])
  const p = nachArt(projekt?.vorschlaege)
  const e = nachArt(eigene?.vorschlaege)
  return {
    eigene: e,
    projekt: p,
    wirksam: Object.fromEntries(ARTEN.map(art => [art, e[art] ?? p[art] ?? 'aus'])),
    limit: limitEintrag?.vorschlagLimit ?? STANDARD_LIMIT,
  }
}

async function standMitBot(projectId, menschId, bot) {
  const [schalter, heute] = await Promise.all([schalterLesen(projectId, menschId), heuteAusgeloest(bot)])
  return { ...schalter, heute, limitErreicht: heute >= schalter.limit }
}

async function offeneVorschlaege(projectId, bot) {
  if (!bot) return []
  const offen = await (await vorschlaege())
    .find({ projectId, botId: bot._id, status: 'offen' })
    .sort({ am: -1 })
    .limit(100)
    .toArray()
  return offen.map(v => ({ id: v._id, art: v.art, titel: v.titel, text: v.text, pfad: v.pfad, am: v.am }))
}

export async function stand(projectId, menschId) {
  return await standMitBot(projectId, menschId, await botVon(menschId))
}

export async function liste(projectId, menschId) {
  return await offeneVorschlaege(projectId, await botVon(menschId))
}

// Für das Panel, das alle 5 s fragt: den Bot nur einmal suchen.
export async function panel(projectId, menschId) {
  const bot = await botVon(menschId)
  const [s, offen] = await Promise.all([standMitBot(projectId, menschId, bot), offeneVorschlaege(projectId, bot)])
  return { stand: s, vorschlaege: offen }
}

export async function eigeneSetzen(projectId, menschId, art, wert) {
  artPruefen(art)
  if (wert !== null) wertPruefen(wert)
  const aenderung = wert === null ? { $unset: { [`vorschlaege.${art}`]: '' } } : { $set: { [`vorschlaege.${art}`]: wert } }
  await (await einstellungen()).updateOne(eigenerFilter(projectId, menschId), aenderung, { upsert: true })
}

export async function projektSetzen(projectId, art, wert) {
  artPruefen(art)
  wertPruefen(wert)
  await (await einstellungen()).updateOne(
    projektFilter(projectId),
    { $set: { [`vorschlaege.${art}`]: wert } },
    { upsert: true }
  )
}

export async function limitSetzen(menschId, limit) {
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
    throw new Problem(422, 'limit', 'spur_fehler_limit', { max: MAX_LIMIT })
  }
  await (await einstellungen()).updateOne(limitFilter(menschId), { $set: { vorschlagLimit: limit } }, { upsert: true })
}

// Prüft Schalter und Tageslimit; nur dann bekommt der eigene Claude ein suggest_trigger.
// `daten` läuft erst nach den Prüfungen (etwa das Log eines Compiles lesen) und meldet mit null „kein Anlass“.
export async function ausloesen({ projectId, menschId, art, daten }) {
  const schalter = await schalterLesen(projectId, menschId)
  if (schalter.wirksam[art] !== 'vorschlag') return { ausgeloest: false, grund: 'aus' }
  const bot = await botVon(menschId)
  if (!bot) return { ausgeloest: false, grund: 'kein_claude' }
  if ((await heuteAusgeloest(bot)) >= schalter.limit) return { ausgeloest: false, grund: 'limit' }
  const inhalt = await daten()
  if (!inhalt) return { ausgeloest: false, grund: 'kein_anlass' }
  await Inbox.ereignisAnlegen({ projectId, botId: bot._id, typ: 'suggest_trigger', daten: { art, ...inhalt } })
  return { ausgeloest: true }
}

export async function vorschlagen({ projectId, botId, art, titel, text, pfad }) {
  const sammlung = await vorschlaege()
  if ((await sammlung.countDocuments({ projectId, botId, status: 'offen' })) >= MAX_OFFEN) {
    throw new Problem(
      409,
      'vorschlaege_voll',
      'spur_fehler_vorschlaege_voll', { max: MAX_OFFEN }
    )
  }
  const { insertedId } = await sammlung.insertOne({
    projectId,
    botId,
    art,
    titel,
    text,
    pfad: pfad ?? null,
    status: 'offen',
    am: jetzt(),
  })
  return { vorschlag_id: insertedId }
}

async function erledigen(projectId, menschId, id, status) {
  const bot = await botVon(menschId)
  const vorschlag =
    bot && ObjectId.isValid(id)
      ? await (await vorschlaege()).findOneAndUpdate(
          { _id: new ObjectId(id), projectId, botId: bot._id, status: 'offen' },
          { $set: { status, erledigt: jetzt() } }
        )
      : null
  if (!vorschlag) throw new Problem(404, 'vorschlag_fehlt', 'spur_fehler_vorschlag_fehlt')
  return vorschlag
}

export async function verwerfen(projectId, menschId, id) {
  await erledigen(projectId, menschId, id, 'verworfen')
}

export async function uebernehmen(projectId, menschId, id) {
  const vorschlag = await erledigen(projectId, menschId, id, 'uebernommen')
  const ort = vorschlag.pfad ? ` (${vorschlag.pfad})` : ''
  try {
    await Inbox.auftragAnlegen({
      projectId,
      botId: vorschlag.botId,
      text: `Bitte diesen Vorschlag umsetzen${ort}: ${vorschlag.titel}\n\n${vorschlag.text}`,
      daten: { vorschlag_id: vorschlag._id },
    })
  } catch (error) {
    // Ohne Auftrag bliebe der Vorschlag sonst verloren: wieder offen, damit die Person es erneut versuchen kann.
    await (await vorschlaege()).updateOne({ _id: vorschlag._id }, { $set: { status: 'offen' }, $unset: { erledigt: '' } })
    throw error
  }
}
