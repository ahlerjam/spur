import SessionManager from '../../../../app/src/Features/Authentication/SessionManager.mjs'
import { db, ObjectId } from '../../../../app/src/infrastructure/mongodb.mjs'

export const projektId = req => new ObjectId(req.params.project_id)
export const menschId = req => new ObjectId(String(SessionManager.getLoggedInUserId(req.session)))

// Nur lesen: Den Bot legt erst ein Token an (ClaudeZugang.botFuer).
export async function botVon(menschId) {
  return await db.users.findOne({ 'spur.botFuer': menschId }, { projection: { _id: 1 } })
}
