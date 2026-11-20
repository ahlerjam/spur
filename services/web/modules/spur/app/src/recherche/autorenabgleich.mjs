import { meldung } from '../meldungen.mjs'
import { normal } from './titelabgleich.mjs'

// Vergleicht die Autoren aus den Metadaten mit der ersten Seite des PDFs. Stehen alle Nachnamen dort, gilt die
// Reihenfolge des PDFs ('aus_pdf', wenn sie anders ist, sonst 'bestaetigt'); fehlt einer, bleibt die Reihenfolge der
// Metadaten ('abweichend'). null: nichts zu vergleichen.
export function autorenAbgleich(autoren, ersteSeite) {
  const text = ` ${normal(ersteSeite)} `
  const namen = (autoren ?? []).map(a => normal(a.family))
  if (!namen.length || namen.some(name => !name) || !text.trim()) return null
  const stellen = namen.map(name => text.indexOf(` ${name} `))
  if (stellen.some(stelle => stelle < 0)) return { zustand: 'abweichend', autoren }
  const imPdf = autoren.map((autor, i) => ({ autor, stelle: stellen[i] })).sort((a, b) => a.stelle - b.stelle).map(e => e.autor)
  return { zustand: imPdf.every((a, i) => a === autoren[i]) ? 'bestaetigt' : 'aus_pdf', autoren: imPdf }
}

// Für Antworten an Claude: Zustand des Autorenabgleichs und der Metadaten; nur abweichend ist ein Hinweis.
export function literaturBefund(quelle) {
  return {
    ...(quelle.autoren && { autoren: quelle.autoren }),
    ...(quelle.autoren === 'abweichend' && { autoren_hinweis: meldung('spur_hinweis_autoren_abweichend') }),
    ...(quelle.metadaten && { metadaten: quelle.metadaten }),
  }
}
