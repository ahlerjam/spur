import { FC, PropsWithChildren } from 'react'
import { PermissionsContext } from '@/features/ide-react/context/permissions-context'
import type { Permissions } from '@/features/ide-react/types/permissions'

const NUR_LESEN: Permissions = {
  read: true,
  comment: true,
  resolveOwnComments: false,
  resolveAllComments: false,
  trackedWrite: false,
  write: false,
  admin: false,
  labelVersion: false,
}

export const ROLLEN = {
  owner: { ...NUR_LESEN, write: true, trackedWrite: true, admin: true },
  review: { ...NUR_LESEN, trackedWrite: true },
  lesen: NUR_LESEN,
}

export function mitRolle(rolle: keyof typeof ROLLEN): FC<PropsWithChildren> {
  return function Rolle({ children }) {
    return (
      <PermissionsContext.Provider value={ROLLEN[rolle]}>
        {children}
      </PermissionsContext.Provider>
    )
  }
}
