import i18n from 'i18next'
import type { RailElement } from '@/features/ide-react/util/rail-types'
import QuellenPanel from './quellen-panel'

const eintrag = {
  key: 'spur-quellen',
  icon: 'book_5',
  get title() {
    return i18n.t('spur_quellen')
  },
  component: <QuellenPanel />,
} as unknown as RailElement

export default eintrag
