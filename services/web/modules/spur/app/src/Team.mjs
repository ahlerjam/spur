import CollaboratorsGetter from '../../../../app/src/Features/Collaborators/CollaboratorsGetter.mjs'
import { db, ObjectId } from '../../../../app/src/infrastructure/mongodb.mjs'

const anzeigeName = nutzer =>
  [nutzer.first_name, nutzer.last_name].filter(Boolean).join(' ').trim() || nutzer.email

export async function namen(ids) {
  const eindeutig = [...new Set(ids.map(String))]
  const nutzer = await db.users
    .find(
      { _id: { $in: eindeutig.map(id => new ObjectId(id)) } },
      { projection: { email: 1, first_name: 1, last_name: 1 } }
    )
    .toArray()
  return new Map(nutzer.map(n => [String(n._id), anzeigeName(n)]))
}

export const nameAus = (namenMap, id) => namenMap.get(String(id)) ?? 'Gelöschtes Konto'

// Eingeladene Mitglieder samt Owner; Nutzer mit Freigabelink zählen nicht zum Team.
export async function mitgliederIds(projectId) {
  return (await CollaboratorsGetter.promises.getInvitedMemberIds(projectId)).map(String)
}

export async function mitglieder(projectId) {
  const ids = await mitgliederIds(projectId)
  const namenMap = await namen(ids)
  return ids.map(id => ({ id: String(id), name: nameAus(namenMap, id) }))
}
