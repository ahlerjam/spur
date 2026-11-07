import { memo, useContext, useEffect, useMemo } from 'react'
import {
  ChangesUsersNachladenContext,
  useChangesUsersContext,
} from '@/shared/context/changes-users-context'
import { Change } from '../../../../../types/change'
import ReviewPanelEntryUser from './review-panel-entry-user'

export const ReviewPanelChangeUser = memo<{ change: Change }>(({ change }) => {
  const changesUsers = useChangesUsersContext()
  const userId = change.metadata?.user_id
  const user = useMemo(
    () => (userId ? changesUsers?.get(userId) : undefined),
    [changesUsers, userId]
  )
  const nachladen = useContext(ChangesUsersNachladenContext)
  useEffect(() => {
    if (changesUsers && userId && !user) nachladen(userId)
  }, [changesUsers, userId, user, nachladen])

  return <ReviewPanelEntryUser user={user} />
})
ReviewPanelChangeUser.displayName = 'ReviewPanelChangeUser'
