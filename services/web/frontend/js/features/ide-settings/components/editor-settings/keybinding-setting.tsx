import { useMemo } from 'react'
import { useProjectSettingsContext } from '@/features/ide-settings/context/project-settings-context'
import { useTranslation } from 'react-i18next'
import DropdownSetting from '../dropdown-setting'
import { Keybindings } from '../../../../../../types/user-settings'

export default function KeybindingSetting() {
  const { mode, setMode } = useProjectSettingsContext()
  const { t } = useTranslation()
  const options = useMemo<{ value: Keybindings; label: string }[]>(
    () => [
      { value: 'default', label: t('none') },
      { value: 'vim', label: 'Vim' },
      { value: 'emacs', label: 'Emacs' },
    ],
    [t]
  )

  return (
    <DropdownSetting
      id="mode"
      label={t('keybindings')}
      description={t('work_in_vim_or_emacs_emulation_mode')}
      options={options}
      onChange={setMode}
      value={mode}
    />
  )
}
