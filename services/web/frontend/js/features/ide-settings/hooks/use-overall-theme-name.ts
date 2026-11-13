import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'

// Die Namen kommen vom Server auf Englisch (Dark, Light, System); spur zeigt sie übersetzt.
export default function useOverallThemeName() {
  const { t } = useTranslation()
  return useCallback(
    (name: string) => {
      switch (name) {
        case 'Dark':
          return t('overall_theme_dark')
        case 'Light':
          return t('overall_theme_light')
        case 'System':
          return t('overall_theme_system')
        default:
          return name
      }
    },
    [t]
  )
}
