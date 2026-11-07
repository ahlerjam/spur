import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { db, ObjectId } from '../../../../app/src/infrastructure/mongodb.mjs'
import UserCreator from '../../../../app/src/Features/User/UserCreator.mjs'
import { Problem } from './probleme.mjs'
import { jetzt } from './schalter.mjs'

export const SCOPE = 'spur_mcp'
const GUELTIG_MS = 90 * 24 * 60 * 60 * 1000

const hashVon = token => createHash('sha256').update(token).digest('hex')

export async function botFuer(mensch) {
  const vorhanden = await db.users.findOne({ 'spur.botFuer': mensch._id })
  if (vorhanden) return vorhanden
  const name = mensch.first_name || mensch.email.split('@')[0]
  const bot = await UserCreator.promises.createNewUser({
    email: `claude-${mensch._id}@bot.spur.invalid`,
    first_name: 'Claude',
    last_name: `(${name})`,
    holdingAccount: false,
    analyticsId: randomUUID(),
  })
  await db.users.updateOne(
    { _id: bot._id },
    { $set: { 'spur.botFuer': mensch._id }, $unset: { hashedPassword: '' } }
  )
  // createNewUser liefert ein Mongoose-Dokument; ein Spread verlöre dessen _id.
  return await db.users.findOne({ _id: bot._id })
}

export async function tokenErzeugen(menschId) {
  const mensch = await db.users.findOne({ _id: new ObjectId(menschId) })
  const bot = await botFuer(mensch)
  const token = `spur_${randomBytes(32).toString('base64url')}`
  const angelegt = jetzt()
  const eintrag = {
    accessToken: hashVon(token),
    accessTokenExpiresAt: new Date(angelegt.getTime() + GUELTIG_MS),
    scope: SCOPE,
    user_id: mensch._id,
    spurBotId: bot._id,
    createdAt: angelegt,
  }
  const { insertedId } = await db.oauthAccessTokens.insertOne(eintrag)
  return { id: insertedId, token, ablauf: eintrag.accessTokenExpiresAt }
}

export async function tokens(menschId) {
  const liste = await db.oauthAccessTokens
    .find({ user_id: new ObjectId(menschId), scope: SCOPE })
    .sort({ createdAt: -1 })
    .toArray()
  const nun = jetzt()
  return liste.map(t => ({
    id: t._id,
    angelegt: t.createdAt,
    ablauf: t.accessTokenExpiresAt,
    abgelaufen: t.accessTokenExpiresAt <= nun,
  }))
}

export async function widerrufen(menschId, tokenId) {
  if (!ObjectId.isValid(tokenId)) throw tokenFehlt()
  const { deletedCount } = await db.oauthAccessTokens.deleteOne({
    _id: new ObjectId(tokenId),
    user_id: new ObjectId(menschId),
    scope: SCOPE,
  })
  if (!deletedCount) throw tokenFehlt()
}

function tokenFehlt() {
  return new Problem(404, 'token_fehlt', 'Dieses Token gibt es nicht mehr.')
}

export async function pruefen(token) {
  if (!token) return null
  const eintrag = await db.oauthAccessTokens.findOne({
    accessToken: hashVon(token),
    scope: SCOPE,
  })
  if (!eintrag || eintrag.accessTokenExpiresAt <= jetzt()) return null
  // Wie GitBridgePATManager: gesperrte Konten verlieren auch den Token-Zugang.
  const mensch = await db.users.findOne(
    { _id: eintrag.user_id },
    { projection: { suspended: 1, first_name: 1, email: 1 } }
  )
  if (!mensch || mensch.suspended) return null
  if (!eintrag.spurBotId) {
    // Tokens aus der Zeit vor der Korrektur in botFuer tragen keinen Bot: nachträglich verknüpfen.
    eintrag.spurBotId = (await botFuer(mensch))._id
    await db.oauthAccessTokens.updateOne({ _id: eintrag._id }, { $set: { spurBotId: eintrag.spurBotId } })
  }
  return { menschId: eintrag.user_id, botId: eintrag.spurBotId, tokenId: eintrag._id }
}

export async function kontoAufraeumen(menschId) {
  const id = new ObjectId(menschId)
  await db.oauthAccessTokens.deleteMany({ user_id: id, scope: SCOPE })
  await db.users.deleteMany({ 'spur.botFuer': id })
}
