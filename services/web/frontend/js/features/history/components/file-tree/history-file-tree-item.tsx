import classNames from 'classnames'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import type { FileOperation } from '../../services/types/file-operation'
import OLTag from '@/shared/components/ol/ol-tag'

type FileTreeItemProps = {
  name: string
  operation?: FileOperation
  icons: ReactNode
}

export default function HistoryFileTreeItem({
  name,
  operation,
  icons,
}: FileTreeItemProps) {
  const { t } = useTranslation()
  const operationen = {
    added: t('history_operation_added'),
    edited: t('history_operation_edited'),
    renamed: t('history_operation_renamed'),
    removed: t('history_operation_removed'),
  }
  return (
    <div className="history-file-tree-item" role="presentation">
      {icons}
      <div className="history-file-tree-item-name-wrapper">
        <div
          className={classNames('history-file-tree-item-name', {
            strikethrough: operation === 'removed',
          })}
        >
          {name}
        </div>
        {operation && (
          <OLTag className="history-file-tree-item-badge">{operationen[operation]}</OLTag>
        )}
      </div>
    </div>
  )
}
