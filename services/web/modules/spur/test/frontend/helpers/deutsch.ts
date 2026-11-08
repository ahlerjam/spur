import i18n from 'i18next'
import de from '../../../../../locales/de.json'

// Die Test-Bootstrap lädt nur Englisch; die spur-Oberfläche wird auf Deutsch geprüft.
export function deutschAktivieren() {
  const vorher = i18n.language
  before(async function () {
    i18n.addResourceBundle('de', 'translation', de, true, true)
    await i18n.changeLanguage('de')
  })
  after(async function () {
    await i18n.changeLanguage(vorher)
  })
}
