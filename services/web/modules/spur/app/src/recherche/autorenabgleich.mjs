import { meldung } from '../meldungen.mjs'
import { normal } from './titelabgleich.mjs'

function vorkommen(text, name) {
  const stellen = []
  for (let i = text.indexOf(` ${name} `); i >= 0; i = text.indexOf(` ${name} `, i + 1)) stellen.push(i)
  return stellen
}

// Der Autorenblock ist das kürzeste Textstück, in dem jeder Nachname vorkommt: Ein Name im Titel oder in einer
// Korrespondenzzeile davor verschiebt die Reihenfolge so nicht. Ergebnis: je Name seine Stelle in diesem Block.
function autorenblock(fundstellen) {
  const alle = fundstellen.flatMap((stellen, name) => stellen.map(stelle => ({ stelle, name }))).sort((a, b) => a.stelle - b.stelle)
  let bester = null
  for (let start = 0; start < alle.length; start++) {
    const letzte = new Map()
    for (let ende = start; ende < alle.length; ende++) {
      letzte.set(alle[ende].name, alle[ende].stelle)
      if (letzte.size < fundstellen.length) continue
      const spanne = alle[ende].stelle - alle[start].stelle
      if (!bester || spanne < bester.spanne) bester = { spanne, letzte }
      break
    }
  }
  return fundstellen.map((_, name) => bester.letzte.get(name))
}

// Vergleicht die Autoren aus den Metadaten mit der ersten Seite des PDFs. Stehen alle Nachnamen dort, gilt die
// Reihenfolge des PDFs ('aus_pdf', wenn sie anders ist, sonst 'bestaetigt'); fehlt einer, bleibt die Reihenfolge der
// Metadaten ('abweichend'). null: nichts zu vergleichen.
export function autorenAbgleich(autoren, ersteSeite) {
  const text = ` ${normal(ersteSeite)} `
  const namen = (autoren ?? []).map(a => normal(a.family))
  if (!namen.length || namen.some(name => !name) || !text.trim()) return null
  const fundstellen = namen.map(name => vorkommen(text, name))
  if (fundstellen.some(stellen => !stellen.length)) return { zustand: 'abweichend', autoren }
  const stellen = autorenblock(fundstellen)
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
