// Bildet nach, was Overleafs Rechteprüfung für spur liefert (AuthorizationManager, CollaboratorsGetter,
// CollaboratorsHandler), samt dem Verhalten, auf das sich rechte.mjs verlässt:
// - Ein Site-Admin bekommt ohne ignoreSiteAdmin überall „owner“, auch für Projekte, die es nicht gibt.
// - Ein unbekanntes Projekt wirft NotFoundError.
import { fileURLToPath } from 'node:url'

export function berechtigung() {
  const stand = {
    // projektId -> { stufe, tokenMember, invited }
    projekte: new Map(),
    admins: new Set(),
  }
  const schluessel = (nutzer, projekt) => `${nutzer}:${projekt}`
  const eintrag = (nutzer, projekt) => stand.projekte.get(schluessel(nutzer, projekt))

  const authorization = {
    promises: {
      getPrivilegeLevelForProject: async (nutzer, projekt, _token, optionen = {}) => {
        if (!optionen.ignoreSiteAdmin && stand.admins.has(String(nutzer))) return 'owner'
        const e = eintrag(nutzer, projekt)
        if (!e) {
          if (stand.bekannt?.has(String(projekt))) return false
          const { default: Errors } = await import('../../../../../app/src/Features/Errors/Errors.js')
          throw new Errors.NotFoundError(`no project found with id ${projekt}`)
        }
        return e.stufe
      },
    },
    isRestrictedUser: (nutzer, stufe, tokenMember, invited) =>
      stufe === false || (stufe === 'readOnly' && (tokenMember || !nutzer) && !invited),
  }
  return {
    stand,
    // Projekt existiert, der Nutzer hat aber nichts damit zu tun.
    projektOhneRechte(projekt) {
      stand.bekannt ??= new Set()
      stand.bekannt.add(String(projekt))
    },
    vergeben(nutzer, projekt, { stufe, tokenMember = false, invited = true }) {
      stand.projekte.set(schluessel(nutzer, projekt), { stufe, tokenMember, invited })
    },
    module: {
      authorization: () => ({ default: authorization }),
      getter: () => ({
        default: {
          promises: {
            isUserInvitedMemberOfProject: async (nutzer, projekt) => Boolean(eintrag(nutzer, projekt)?.invited),
          },
        },
      }),
      handler: () => ({
        default: {
          promises: {
            userIsTokenMember: async (nutzer, projekt) => Boolean(eintrag(nutzer, projekt)?.tokenMember),
          },
        },
      }),
    },
    // Hängt die drei Module an vi.doMock (Pfade absolut, vi löst relative Pfade ab dieser Datei auf).
    anmelden(vi) {
      const basis = fileURLToPath(new URL('../../../../../app/src/Features', import.meta.url))
      vi.doMock(`${basis}/Authorization/AuthorizationManager.mjs`, this.module.authorization)
      vi.doMock(`${basis}/Collaborators/CollaboratorsGetter.mjs`, this.module.getter)
      vi.doMock(`${basis}/Collaborators/CollaboratorsHandler.mjs`, this.module.handler)
    },
  }
}
