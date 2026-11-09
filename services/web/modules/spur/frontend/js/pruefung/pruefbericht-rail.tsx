import i18n from 'i18next'
import type { RailElement } from '@/features/ide-react/util/rail-types'
import PruefberichtPanel from './pruefbericht-panel'

const eintrag = {
  key: 'spur-pruefbericht',
  // Seitenbilder, Befehle und Formulare brauchen mehr Platz als Overleafs 15 %.
  defaultSize: 25,
  icon: 'check_circle',
  get title() {
    return i18n.t('spur_pruefbericht')
  },
  component: <PruefberichtPanel />,
} as unknown as RailElement

export default eintrag
