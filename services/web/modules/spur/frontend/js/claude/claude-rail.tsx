import i18n from 'i18next'
import type { RailElement } from '@/features/ide-react/util/rail-types'
import ClaudePanel from './claude-panel'

const eintrag = {
  key: 'spur-claude',
  icon: 'smart_toy',
  get title() {
    return i18n.t('spur_claude')
  },
  component: <ClaudePanel />,
} as unknown as RailElement

export default eintrag
