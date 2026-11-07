import AuthorizationManager from '../../../../app/src/Features/Authorization/AuthorizationManager.mjs'
import CollaboratorsGetter from '../../../../app/src/Features/Collaborators/CollaboratorsGetter.mjs'
import CollaboratorsHandler from '../../../../app/src/Features/Collaborators/CollaboratorsHandler.mjs'
import Errors from '../../../../app/src/Features/Errors/Errors.js'

// Namen der Rollen nach docs/mcp-vertrag.md statt Overleafs interner Stufen.
const IM_VERTRAG = { readOnly: 'read', review: 'review', readAndWrite: 'write', owner: 'owner' }
export const rolleImVertrag = stufe => IM_VERTRAG[stufe] ?? null

// Rolle für alles, was Claude tut (MCP-Werkzeuge, Automatik am Laufende), oder null.
// - Kein Admin-Sonderrecht: Was Claude liest, geht an Anthropic, ein Admin-Token gäbe sonst fremde
//   Projekte per ID preis (ADR 0003: nie mehr Rechte als das Konto, weniger ist erlaubt).
// - Wie im Web zählt ein reiner Leselink nicht. Die Einschränkung wird aus der Stufe ohne
//   Admin-Recht berechnet, sonst gälte ein Admin mit Leselink als uneingeschränkt.
// - Ein unbekanntes Projekt sieht aus wie ein fremdes: keine Rolle.
export async function rolleFuerClaude(menschId, projectId) {
  try {
    const [stufe, isTokenMember, isInvitedMember] = await Promise.all([
      AuthorizationManager.promises.getPrivilegeLevelForProject(menschId, projectId, null, {
        ignoreSiteAdmin: true,
      }),
      CollaboratorsHandler.promises.userIsTokenMember(menschId, projectId),
      CollaboratorsGetter.promises.isUserInvitedMemberOfProject(menschId, projectId),
    ])
    if (!stufe) return null
    return AuthorizationManager.isRestrictedUser(menschId, stufe, isTokenMember, isInvitedMember)
      ? null
      : stufe
  } catch (error) {
    if (error instanceof Errors.NotFoundError) return null
    throw error
  }
}
