import i18n from 'i18next'
import type { RailElement } from '@/features/ide-react/util/rail-types'
import VorschlaegePanel from './vorschlaege-panel'

const eintrag = {
  key: 'spur-vorschlaege',
  // Seitenbilder, Befehle und Formulare brauchen mehr Platz als Overleafs 15 %.
  defaultSize: 25,
  icon: 'lightbulb',
  get title() {
    return i18n.t('spur_vorschlaege')
  },
  component: <VorschlaegePanel />,
} as unknown as RailElement

export default eintrag
