import i18n from 'i18next'
import type { RailElement } from '@/features/ide-react/util/rail-types'
import RecherchePanel from './recherche-panel'

const eintrag = {
  key: 'spur-recherche',
  icon: 'find_in_page',
  get title() {
    return i18n.t('spur_recherche')
  },
  component: <RecherchePanel />,
} as unknown as RailElement

export default eintrag
