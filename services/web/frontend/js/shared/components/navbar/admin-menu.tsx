import type { DefaultNavbarMetadata } from '@/shared/components/types/default-navbar-metadata'
import NavDropdownMenu from '@/shared/components/navbar/nav-dropdown-menu'
import NavDropdownLinkItem from '@/shared/components/navbar/nav-dropdown-link-item'
import { useSendProjectListMB } from '@/features/project-list/components/project-list-events'
import { useTranslation } from 'react-i18next'

export default function AdminMenu({
  canDisplayAdminMenu,
  canDisplayAdminRedirect,
  canDisplayProjectUrlLookup,
  canDisplaySplitTestMenu,
  canDisplaySurveyMenu,
  canDisplayScriptLogMenu,
  adminUrl,
}: Pick<
  DefaultNavbarMetadata,
  | 'canDisplayAdminMenu'
  | 'canDisplayAdminRedirect'
  | 'canDisplayProjectUrlLookup'
  | 'canDisplaySplitTestMenu'
  | 'canDisplaySurveyMenu'
  | 'canDisplayScriptLogMenu'
  | 'adminUrl'
>) {
  const sendProjectListMB = useSendProjectListMB()
  const { t } = useTranslation()
  return (
    <NavDropdownMenu
      title="Admin"
      className="subdued"
      onToggle={nextShow => {
        if (nextShow) {
          sendProjectListMB('menu-expand', {
            item: 'admin',
            location: 'top-menu',
          })
        }
      }}
    >
      {canDisplayAdminMenu ? (
        <>
          <NavDropdownLinkItem href="/admin">Manage Site</NavDropdownLinkItem>
          <NavDropdownLinkItem href="/admin/user">
            Manage Users
          </NavDropdownLinkItem>
          {/* spur: the registration page shows invitation links to copy when email is not set up */}
          <NavDropdownLinkItem href="/admin/register">
            Register Users
          </NavDropdownLinkItem>
          {/* spur: Seiten des spur-Moduls, übersetzt wie die übrige Oberfläche */}
          <NavDropdownLinkItem href="/spur/admin/grenzen">
            {t('spur_grenzen')}
          </NavDropdownLinkItem>
          <NavDropdownLinkItem href="/spur/admin/workflows">
            {t('spur_workflows')}
          </NavDropdownLinkItem>
        </>
      ) : null}
      {canDisplayProjectUrlLookup ? (
        <NavDropdownLinkItem href="/admin/project">
          Manage Projects
        </NavDropdownLinkItem>
      ) : null}
      {canDisplayAdminRedirect && adminUrl ? (
        <NavDropdownLinkItem href={adminUrl}>
          Switch to Admin
        </NavDropdownLinkItem>
      ) : null}
      {canDisplaySplitTestMenu ? (
        <NavDropdownLinkItem href="/admin/split-test">
          Manage Feature Flags
        </NavDropdownLinkItem>
      ) : null}
      {canDisplaySurveyMenu ? (
        <NavDropdownLinkItem href="/admin/survey">
          Manage Surveys
        </NavDropdownLinkItem>
      ) : null}
      {canDisplayScriptLogMenu ? (
        <NavDropdownLinkItem href="/admin/script-logs">
          View Script Logs
        </NavDropdownLinkItem>
      ) : null}
    </NavDropdownMenu>
  )
}
