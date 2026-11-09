import { Panel } from 'react-resizable-panels'
import { useRailContext } from '@/features/ide-react/context/rail-context'
import classNames from 'classnames'
import { useCallback, useMemo } from 'react'
import usePreviousValue from '@/shared/hooks/use-previous-value'
import { HistorySidebar } from '@/features/ide-react/components/history-sidebar'
import { Tab } from 'react-bootstrap'
import { RailElement } from '@/features/ide-react/util/rail-types'
import { shouldIncludeElement } from '@/features/ide-react/util/rail-utils'

// spur: Panels des Moduls zeigen Seitenbilder, Befehle und Formulare und starten breiter.
const standardBreite = (tab: string) =>
  tab === 'workbench' ? 20 : tab.startsWith('spur-') ? 25 : 15

export default function RailPanel({
  isReviewPanelOpen,
  isHistoryView,
  railTabs,
  focusMode,
}: {
  isReviewPanelOpen: boolean
  isHistoryView: boolean
  railTabs: RailElement[]
  focusMode: boolean
}) {
  const { selectedTab, panelRef, handlePaneExpand, handlePaneCollapse } =
    useRailContext()

  const prevTab = usePreviousValue(selectedTab)

  const tabHasChanged = useMemo(() => {
    return prevTab !== selectedTab
  }, [prevTab, selectedTab])

  const onCollapse = useCallback(() => {
    if (!tabHasChanged) {
      handlePaneCollapse()
    }
  }, [tabHasChanged, handlePaneCollapse])

  return (
    <Panel
      id={`ide-redesign-sidebar-panel-${isHistoryView ? 'file-tree' : selectedTab}`}
      className={classNames({ hidden: isReviewPanelOpen || focusMode })}
      order={1}
      defaultSize={standardBreite(selectedTab)}
      minSize={5}
      maxSize={80}
      ref={panelRef}
      collapsible
      onCollapse={onCollapse}
      onExpand={handlePaneExpand}
    >
      {isHistoryView && <HistorySidebar />}
      <div
        className={classNames('ide-rail-content', {
          hidden: isHistoryView,
        })}
      >
        <Tab.Content className="ide-rail-tab-content">
          {railTabs
            .filter(shouldIncludeElement)
            .map(({ key, component, mountOnFirstLoad }) => (
              <Tab.Pane
                eventKey={key}
                key={key}
                mountOnEnter={!mountOnFirstLoad}
              >
                {component}
              </Tab.Pane>
            ))}
        </Tab.Content>
      </div>
    </Panel>
  )
}
