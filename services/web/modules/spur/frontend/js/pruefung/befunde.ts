import type { TFunction } from 'i18next'
import type { Zeile } from './pruef-store'

export type Stufe = 'success' | 'warning' | 'danger' | 'info'

// Dieselben Texte stehen als Abzeichen im Bericht und als Tooltip an der Markierung im Editor.
export function befunde(zeile: Zeile, t: TFunction) {
  const badges: { text: string; stufe: Stufe }[] = []
  const add = (text: string, stufe: Stufe) => badges.push({ text, stufe })

  if (zeile.wortlaut === 'exakt') add(t('spur_wortlaut_exakt'), 'success')
  if (zeile.wortlaut === 'trennung') add(t('spur_wortlaut_trennung'), 'success')
  if (zeile.wortlaut === 'abweichend') add(t('spur_wortlaut_abweichend'), 'danger')
  if (zeile.wortlaut === 'nicht_pruefbar') add(t('spur_nicht_pruefbar'), 'warning')
  if (zeile.wortlaut === 'quelle_fehlt') add(t('spur_quelle_fehlt'), 'danger')
  if (zeile.wortlaut === 'ocr_unbestaetigt') add(t('spur_wortlaut_ocr'), 'warning')
  if (zeile.wortlaut === 'bestaetigt') add(t('spur_wortlaut_bestaetigt'), 'success')

  if (zeile.status === 'beleg_ohne_wortlaut') add(t('spur_beleg_ohne_wortlaut'), 'info')

  if (zeile.seite === 'stimmt') add(t('spur_seite_stimmt'), 'success')
  if (zeile.seite === 'bestaetigt') add(t('spur_seite_bestaetigt'), 'success')
  if (zeile.seite === 'nicht_pruefbar') add(t('spur_seite_nicht_pruefbar'), 'warning')
  if (zeile.seite === 'gefunden') {
    add(t('spur_gefunden_auf', { seite: zeile.gefundenAuf }), 'warning')
  }

  if (zeile.referenz === 'nicht_gefunden') add(t('spur_referenz_nicht_gefunden'), 'danger')
  // Ein Ausfall bei Crossref oder der Registrierstelle ist kein Befund über die Arbeit: neutral, nicht als Fehler.
  if (zeile.referenz === 'nicht_pruefbar') {
    add(
      t(zeile.grund === 'registrierstelle_nicht_erreichbar' ? 'spur_referenz_registrierstelle_nicht_erreichbar' : 'spur_referenz_nicht_pruefbar'),
      'info'
    )
  }
  if (zeile.registrierstelle === 'datacite' && zeile.referenz === 'gefunden') add(t('spur_referenz_datacite'), 'success')
  if (zeile.referenz === 'registriert') add(t('spur_referenz_registriert', { name: zeile.registrierstelleName }), 'info')
  if (zeile.retraction === 'zurueckgezogen') add(t('spur_zurueckgezogen'), 'danger')
  if (zeile.retraction === 'korrektur') add(t('spur_korrektur'), 'warning')
  if (zeile.retraction === 'keine_meldung') add(t('spur_keine_meldung'), 'info')
  return badges
}
