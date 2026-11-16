import { meldung } from '../meldungen.mjs'

const SEITEN = 3

const normal = text =>
  String(text ?? '')
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()

// Vergleicht den Titel aus den Metadaten mit dem Anfang des PDFs: 'passt', 'abweichend' oder 'nicht_pruefbar'.
// Drei Seiten statt nur der ersten, weil Repositorien oft ein Deckblatt voranstellen.
export function titelabgleich(titel, seitenTexte, pdfTitel) {
  const woerter = [...new Set(normal(titel).split(' ').filter(w => w.length >= 4))]
  const anfang = normal(seitenTexte.slice(0, SEITEN).join(' '))
  if (!woerter.length || !anfang) return 'nicht_pruefbar'
  const text = ` ${anfang} ${normal(pdfTitel)} `
  const gefunden = woerter.filter(w => text.includes(` ${w} `)).length
  const noetig = Math.max(Math.ceil(woerter.length / 2), Math.min(3, woerter.length))
  return gefunden >= noetig ? 'passt' : 'abweichend'
}

// Für Antworten an Claude: das Ergebnis des Abgleichs einer Quelle und bei Abweichung der Hinweis dazu.
export function titelBefund(quelle) {
  if (!quelle.titelabgleich) return {}
  return {
    titelabgleich: quelle.titelabgleich,
    ...(quelle.titelabgleich === 'abweichend' && { hinweis: meldung('spur_hinweis_titel_abweichend') }),
  }
}
