import {
  createContext,
  FC,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { getJSON } from '@/infrastructure/fetch-json'
import { useProjectContext } from '@/shared/context/project-context'
import { UserId } from '@ol-types/user'
import { useEditorContext } from '@/shared/context/editor-context'
import { debugConsole } from '@/utils/debugging'
import { captureException } from '@/infrastructure/error-reporter'

export type ChangesUser = {
  id: UserId
  email: string
  first_name?: string
  last_name?: string
}

export type ChangesUsers = Map<UserId, ChangesUser>

export const ChangesUsersContext = createContext<ChangesUsers | undefined>(
  undefined
)

// spur: Autoren, die erst nach dem Laden Änderungen schreiben (etwa der Claude-Bot, der kein
// Mitglied ist), werden nachgeladen statt bis zum Neuladen als „Deleted user“ zu erscheinen.
export const ChangesUsersNachladenContext = createContext<
  (userId: UserId) => void
>(() => {})

export const ChangesUsersProvider: FC<React.PropsWithChildren> = ({
  children,
}) => {
  const { projectId, project } = useProjectContext()
  const { members, owner } = project || {}
  const { isRestrictedTokenMember } = useEditorContext()

  const [changesUsers, setChangesUsers] = useState<ChangesUsers>()
  const [stand, setStand] = useState(0)
  const nachgefragt = useRef(new Set<UserId>())

  useEffect(() => {
    if (isRestrictedTokenMember) {
      return
    }

    getJSON<ChangesUser[]>(`/project/${projectId}/changes/users`)
      .then(data => setChangesUsers(new Map(data.map(item => [item.id, item]))))
      .catch(error => {
        debugConsole.error(error)
        captureException(error)
      })
  }, [projectId, isRestrictedTokenMember, stand])

  // Je unbekannter ID höchstens einmal nachladen: wirklich gelöschte Nutzer bleiben unbekannt.
  const nachladen = useCallback((userId: UserId) => {
    if (nachgefragt.current.has(userId)) return
    nachgefragt.current.add(userId)
    setStand(n => n + 1)
  }, [])

  // add the project owner and members to the changes users data
  const value = useMemo(() => {
    if (!owner || !members) {
      return
    }
    const value: ChangesUsers = new Map(changesUsers)
    value.set(owner._id, { ...owner, id: owner._id })
    for (const member of members) {
      value.set(member._id, { ...member, id: member._id })
    }
    return value
  }, [members, owner, changesUsers])

  return (
    <ChangesUsersContext.Provider value={value}>
      <ChangesUsersNachladenContext.Provider value={nachladen}>
        {children}
      </ChangesUsersNachladenContext.Provider>
    </ChangesUsersContext.Provider>
  )
}

export const useChangesUsersContext = () => {
  return useContext(ChangesUsersContext)
}
