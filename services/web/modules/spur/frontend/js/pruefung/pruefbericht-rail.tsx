import i18n from 'i18next'
import type { RailElement } from '@/features/ide-react/util/rail-types'
import PruefberichtPanel from './pruefbericht-panel'

const eintrag = {
  key: 'spur-pruefbericht',
  icon: 'check_circle',
  get title() {
    return i18n.t('spur_pruefbericht')
  },
  component: <PruefberichtPanel />,
} as unknown as RailElement

export default eintrag
