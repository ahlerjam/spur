import { useTranslation } from 'react-i18next'
import MaterialIcon from '@/shared/components/material-icon'
import React from 'react'
import useCollapsibleFileTree from '@/features/file-tree/hooks/use-collapsible-file-tree'
import FileTreeActionButtons from './file-tree-action-buttons'

function FileTreeToolbar() {
  const { t } = useTranslation()
  const { fileTreeExpanded, toggleFileTreeExpanded } = useCollapsibleFileTree()
  const toggleLabel = fileTreeExpanded
    ? t('hide_file_tree')
    : t('show_file_tree')

  return (
    <div className="file-tree-toolbar">
      <button
        className="file-tree-expand-collapse-button"
        onClick={toggleFileTreeExpanded}
        aria-label={toggleLabel}
        title={toggleLabel}
      >
        <MaterialIcon
          type={
            fileTreeExpanded ? 'keyboard_arrow_down' : 'keyboard_arrow_right'
          }
        />
        <h4>{t('file_tree')}</h4>
      </button>
      <FileTreeActionButtons fileTreeExpanded={fileTreeExpanded} />
    </div>
  )
}

export default FileTreeToolbar
