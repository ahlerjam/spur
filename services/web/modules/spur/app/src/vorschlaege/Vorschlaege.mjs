import { db, ObjectId } from '../../../../../app/src/infrastructure/mongodb.mjs'
import * as Inbox from '../Inbox.mjs'
import { Problem } from '../probleme.mjs'
import { einstellungen, ereignisse, vorschlaege } from '../sammlungen.mjs'
import { jetzt } from '../schalter.mjs'

export const ARTEN = ['compile_fehler', 'belegloses_argument']
const WERTE = ['aus', 'vorschlag']
const STANDARD_LIMIT = 50
const MAX_LIMIT = 1000

function artPruefen(art) {
  if (!ARTEN.includes(art)) {
    throw new Problem(422, 'schalter', `Unbekannter Schalter. Erlaubt: ${ARTEN.join(', ')}.`)
  }
}

function wertPruefen(wert, { leerErlaubt }) {
  if (WERTE.includes(wert) || (leerErlaubt && wert === null)) return
  throw new Problem(422, 'schalter_wert', `Der Wert muss ${WERTE.join(' oder ')}${leerErlaubt ? ' oder null' : ''} sein.`)
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

async function botVon(menschId) {
  return await db.users.findOne({ 'spur.botFuer': menschId }, { projection: { _id: 1 } })
}

async function heuteAusgeloest(botId) {
  if (!botId) return 0
  return await (await ereignisse()).countDocuments({
    botId,
    typ: 'suggest_trigger',
    am: { $gte: tagesbeginn() },
  })
}

export async function stand(projectId, menschId) {
  const sammlung = await einstellungen()
  const [projekt, eigene, limitEintrag, bot] = await Promise.all([
    sammlung.findOne(projektFilter(projectId)),
    sammlung.findOne(eigenerFilter(projectId, menschId)),
    sammlung.findOne(limitFilter(menschId)),
    botVon(menschId),
  ])
  const p = nachArt(projekt?.vorschlaege)
  const e = nachArt(eigene?.vorschlaege)
  const limit = limitEintrag?.vorschlagLimit ?? STANDARD_LIMIT
  const heute = await heuteAusgeloest(bot?._id)
  return {
    eigene: e,
    projekt: p,
    wirksam: Object.fromEntries(ARTEN.map(art => [art, e[art] ?? p[art] ?? 'aus'])),
    limit,
    heute,
    limitErreicht: heute >= limit,
  }
}

export async function eigeneSetzen(projectId, menschId, art, wert) {
  artPruefen(art)
  wertPruefen(wert, { leerErlaubt: true })
  const aenderung = wert === null ? { $unset: { [`vorschlaege.${art}`]: '' } } : { $set: { [`vorschlaege.${art}`]: wert } }
  await (await einstellungen()).updateOne(eigenerFilter(projectId, menschId), aenderung, { upsert: true })
}

export async function projektSetzen(projectId, art, wert) {
  artPruefen(art)
  wertPruefen(wert, { leerErlaubt: false })
  await (await einstellungen()).updateOne(
    projektFilter(projectId),
    { $set: { [`vorschlaege.${art}`]: wert } },
    { upsert: true }
  )
}

export async function limitSetzen(menschId, limit) {
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
    throw new Problem(422, 'limit', `Das Tageslimit muss eine ganze Zahl von 1 bis ${MAX_LIMIT} sein.`)
  }
  await (await einstellungen()).updateOne(limitFilter(menschId), { $set: { vorschlagLimit: limit } }, { upsert: true })
}

// Prüft Schalter und Tageslimit; nur dann bekommt der eigene Claude ein suggest_trigger.
// `daten` darf eine Funktion sein, die erst nach den Prüfungen läuft und mit null „kein Anlass“ meldet.
export async function ausloesen({ projectId, menschId, art, daten }) {
  const s = await stand(projectId, menschId)
  if (s.wirksam[art] !== 'vorschlag') return { ausgeloest: false, grund: 'aus' }
  const bot = await botVon(menschId)
  if (!bot) return { ausgeloest: false, grund: 'kein_claude' }
  if (s.limitErreicht) return { ausgeloest: false, grund: 'limit' }
  const inhalt = typeof daten === 'function' ? await daten() : daten
  if (!inhalt) return { ausgeloest: false, grund: 'kein_anlass' }
  await Inbox.ereignisAnlegen({ projectId, botId: bot._id, typ: 'suggest_trigger', daten: { art, ...inhalt } })
  return { ausgeloest: true }
}

export async function vorschlagen({ projectId, botId, art, titel, text, pfad }) {
  const { insertedId } = await (await vorschlaege()).insertOne({
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

const fuerClient = v => ({ id: v._id, art: v.art, titel: v.titel, text: v.text, pfad: v.pfad, am: v.am })

export async function liste(projectId, menschId) {
  const bot = await botVon(menschId)
  if (!bot) return []
  const offen = await (await vorschlaege())
    .find({ projectId, botId: bot._id, status: 'offen' })
    .sort({ am: -1 })
    .limit(100)
    .toArray()
  return offen.map(fuerClient)
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
  if (!vorschlag) throw new Problem(404, 'vorschlag_fehlt', 'Diesen Vorschlag gibt es nicht mehr. Bitte das Panel neu laden.')
  return { vorschlag, botId: bot._id }
}

export async function verwerfen(projectId, menschId, id) {
  await erledigen(projectId, menschId, id, 'verworfen')
}

export async function uebernehmen(projectId, menschId, id) {
  const { vorschlag, botId } = await erledigen(projectId, menschId, id, 'uebernommen')
  const ort = vorschlag.pfad ? ` (${vorschlag.pfad})` : ''
  await Inbox.auftragAnlegen({
    projectId,
    botId,
    text: `Bitte diesen Vorschlag umsetzen${ort}: ${vorschlag.titel}\n\n${vorschlag.text}`,
    daten: { vorschlag_id: vorschlag._id },
  })
}
