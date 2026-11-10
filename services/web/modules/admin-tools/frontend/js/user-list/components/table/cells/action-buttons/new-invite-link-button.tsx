import { memo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import OLTooltip from '@/shared/components/ol/ol-tooltip'
import OLIconButton from '@/shared/components/ol/ol-icon-button'
import OLButton from '@/shared/components/ol/ol-button'
import Notification from '@/shared/components/notification'
import {
  OLModal,
  OLModalBody,
  OLModalFooter,
  OLModalHeader,
  OLModalTitle,
} from '@/shared/components/ol/ol-modal'
import { getUserFacingMessage, postJSON } from '@/infrastructure/fetch-json'
import useAsync from '@/shared/hooks/use-async'
import EinladungsLink from '@modules/spur/frontend/js/einladung/einladungs-link'
import { User } from '../../../../../../../types/user/api'

type NewLinkResult = { activationUrl: string; emailConfigured: boolean }

// spur: creates a fresh one-week activation link, also for accounts that are already active.
function NewInviteLinkButton({ user }: { user: User }) {
  const { t } = useTranslation()
  const text = t('spur_neuer_einladungslink')
  const [show, setShow] = useState(false)
  const { data, error, isLoading, runAsync, reset } = useAsync<NewLinkResult>()

  if (user.deleted || !user.authMethods.includes('local')) return null

  const open = () => {
    reset()
    setShow(true)
    runAsync(postJSON(`/admin/user/${user.id}/activation-link`)).catch(() => {})
  }

  return (
    <>
      <OLTooltip
        id={`new-invite-link-${user.id}`}
        description={text}
        overlayProps={{ placement: 'top', trigger: ['hover', 'focus'] }}
      >
        <OLIconButton
          onClick={open}
          variant="link"
          accessibilityLabel={text}
          className="action-btn"
          icon="link"
        />
      </OLTooltip>
      {show && (
        <OLModal show animation onHide={() => setShow(false)} id="new-invite-link-modal">
          <OLModalHeader>
            <OLModalTitle>{text}</OLModalTitle>
          </OLModalHeader>
          <OLModalBody>
            <p>{user.email}</p>
            {isLoading && <p role="status">{t('loading')}…</p>}
            {error && <Notification type="error" content={getUserFacingMessage(error) ?? ''} />}
            {data && (
              <EinladungsLink
                url={data.activationUrl}
                perMail={data.emailConfigured ? undefined : false}
              />
            )}
          </OLModalBody>
          <OLModalFooter>
            <OLButton variant="secondary" onClick={() => setShow(false)}>
              {t('close')}
            </OLButton>
          </OLModalFooter>
        </OLModal>
      )}
    </>
  )
}

export default memo(NewInviteLinkButton)
