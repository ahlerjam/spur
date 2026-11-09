// Meldungen des spur-Servers in der Sprache der Installation (OVERLEAF_SITE_LANGUAGE), nicht des Browsers:
// Problems entstehen oft ohne Anfrage, und Claude sieht dieselben Texte über MCP.
import Settings from '@overleaf/settings'

// Nur die Sprache der Installation laden; andere Sprachen fallen auf Englisch zurück.
const sprache = Settings.i18n?.defaultLng === 'de' ? 'de' : 'en'
const { default: texte } = await import(`../../../../locales/${sprache}.json`, { with: { type: 'json' } })

export function meldung(schluessel, werte = {}) {
  const text = texte[schluessel]
  if (text === undefined) throw new Error(`spur-Meldung ohne Sprachschlüssel: ${schluessel}`)
  return text.replace(/__(\w+)__/g, (ganz, name) => (name in werte ? String(werte[name]) : ganz))
}
