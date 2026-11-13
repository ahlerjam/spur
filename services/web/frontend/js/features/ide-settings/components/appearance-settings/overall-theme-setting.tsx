import { useProjectSettingsContext } from '@/features/ide-settings/context/project-settings-context'
import DropdownSetting from '../dropdown-setting'
import getMeta from '@/utils/meta'
import { useMemo } from 'react'
import type { Option } from '../dropdown-setting'
import { useTranslation } from 'react-i18next'
import { OverallThemeMeta } from '@ol-types/project-settings'
import { isIEEEBranded } from '@/utils/is-ieee-branded'
import { useLayoutContext } from '@/shared/context/layout-context'
import { OverallTheme } from '@/shared/utils/styles'

export default function OverallThemeSetting() {
  const { t } = useTranslation()
  const overallThemes = getMeta('ol-overallThemes') as
    | OverallThemeMeta[]
    | undefined

  const { loadingStyleSheet } = useLayoutContext()
  const { overallTheme, setOverallTheme } = useProjectSettingsContext()

  // Die Namen kommen vom Server auf Englisch (Dark, Light, System); spur zeigt sie übersetzt.
  const options: Array<Option<OverallTheme>> = useMemo(() => {
    const namen: Record<string, string> = {
      Dark: t('overall_theme_dark'),
      Light: t('overall_theme_light'),
      System: t('overall_theme_system'),
    }
    return (
      overallThemes?.map(({ name, val }) => ({
        value: val,
        label: namen[name] ?? name,
      })) ?? []
    )
  }, [overallThemes, t])

  if (!overallThemes || isIEEEBranded()) {
    return null
  }

  return (
    <DropdownSetting
      id="overallTheme"
      label={t('overall_theme')}
      description={t('the_overleaf_color_scheme')}
      options={options}
      onChange={setOverallTheme}
      value={overallTheme}
      loading={loadingStyleSheet}
    />
  )
}
