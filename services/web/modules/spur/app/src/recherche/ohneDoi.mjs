// Metadaten für Quellen ohne DOI (Abschlussarbeiten, Reports, Working Papers), wie sie source_add und der Upload annehmen.
import { Problem } from '../probleme.mjs'

const ARTEN = ['thesis', 'report', 'working_paper', 'book', 'misc']

// Formularfelder des Uploads, an denen eine Quelle ohne DOI zu erkennen ist (der Titel allein reicht dafür nicht).
export const WERKFELDER = ['autoren', 'jahr', 'art', 'institution', 'abschluss', 'url']

export const eingabeUngueltig = feld => new Problem(422, 'eingabe_ungueltig', 'spur_fehler_eingabe_feld', { feld }, { feld })

export const kurz = (wert, max) => (typeof wert === 'string' ? wert.replace(/\s+/g, ' ').trim().slice(0, max) : '')

function httpAdresse(wert) {
  try {
    return ['http:', 'https:'].includes(new URL(wert).protocol)
  } catch {
    return false
  }
}

// „Meyer, Jana; Okafor, Chidi“ wird zur Autorenliste in dieser Reihenfolge.
export function autorenAusText(text) {
  return String(text ?? '')
    .split(';')
    .map(teil => {
      const [family, ...given] = teil.split(',')
      return { family: family.trim(), given: given.join(',').trim() }
    })
    .filter(a => a.family)
}

// Prüft die Eingabe und liefert die Metadaten in der Form, in der sie an der Quelle stehen. Fehlt der Titel oder
// ist ein Feld ungültig, nennt der Fehler das Feld.
export function metadatenOhneDoi(eingabe) {
  const titel = kurz(eingabe?.titel, 500)
  if (!titel) throw eingabeUngueltig('metadaten.titel')
  const art = eingabe.art == null || eingabe.art === '' ? 'misc' : eingabe.art
  if (!ARTEN.includes(art)) throw eingabeUngueltig('metadaten.art')
  const jahr = eingabe.jahr == null || eingabe.jahr === '' ? null : Number(eingabe.jahr)
  if (jahr !== null && !(Number.isInteger(jahr) && jahr >= 1000 && jahr <= 2100)) throw eingabeUngueltig('metadaten.jahr')
  const url = kurz(eingabe.url, 2000) || null
  if (url && !httpAdresse(url)) throw eingabeUngueltig('metadaten.url')
  if (eingabe.autoren != null && !Array.isArray(eingabe.autoren)) throw eingabeUngueltig('metadaten.autoren')
  const autoren = (eingabe.autoren ?? [])
    .slice(0, 100)
    .map(a => ({ family: kurz(a?.family, 200), given: kurz(a?.given, 200) }))
    .filter(a => a.family)
  return {
    titel,
    autoren,
    jahr,
    art,
    institution: kurz(eingabe.institution, 300) || null,
    abschluss: kurz(eingabe.abschluss, 200) || null,
    url,
  }
}
