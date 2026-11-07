import { AUSLASSUNG, BUCHSTABE } from './latex.mjs'

const LIGATUREN = { ﬀ: 'ff', ﬁ: 'fi', ﬂ: 'fl', ﬃ: 'ffi', ﬄ: 'ffl', ﬅ: 'st', ﬆ: 'st' }

export function normalisieren(text) {
  return text
    .normalize('NFC')
    .replace(/[ﬀ-ﬆ]/g, c => LIGATUREN[c] ?? c)
    .replace(/[“”„‟«»‹›"‘’‚‛']/g, '"')
    .replace(/[‐‑‒–—―−]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
}

const ZEILENTRENNUNG = /(\p{L})- (\p{Ll})/gu

// Trennungen lassen sich ohne Wörterbuch nicht von echten Bindestrichen unterscheiden: beide Lesarten gelten.
function textFassungen(seiten) {
  const fassungen = { exakt: seiten, ohne: [], mit: [] }
  for (const seite of seiten) {
    fassungen.ohne.push(seite.replace(ZEILENTRENNUNG, '$1$2'))
    fassungen.mit.push(seite.replace(ZEILENTRENNUNG, '$1-$2'))
  }
  return fassungen
}

function segmentMuster(segment) {
  const zeichen = segment
    .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    .replace(new RegExp(`${BUCHSTABE}(\\p{L})`, 'gu'), (_, b) => {
      return `[${b.toLowerCase()}${b.toUpperCase()}]`
    })
  return new RegExp(zeichen, 'gu')
}

function segmentAb(text, muster, pos) {
  muster.lastIndex = pos
  return muster.exec(text)
}

function seitenFinden(seiten, segmente) {
  const gesamt = seiten.join(' ')
  const muster = segmente.map(segmentMuster)
  const treffer = []
  const anfaenge = []
  let summe = 0
  for (const seite of seiten) {
    anfaenge.push(summe)
    summe += seite.length + 1
  }
  const seiteAn = pos => {
    let i = anfaenge.length - 1
    while (i > 0 && anfaenge[i] > pos) i--
    return i
  }
  for (
    let erster = segmentAb(gesamt, muster[0], 0);
    erster;
    erster = segmentAb(gesamt, muster[0], erster.index + 1)
  ) {
    let pos = erster.index + erster[0].length
    const passt = muster.slice(1).every(m => {
      const t = segmentAb(gesamt, m, pos)
      if (t) pos = t.index + t[0].length
      return t
    })
    if (passt) treffer.push(seiteAn(erster.index))
  }
  return treffer
}

export function wortlautPruefen(zitat, seitenTexte) {
  if (seitenTexte.length === 0 || seitenTexte.some(s => s.includes('�'))) {
    return { wortlaut: 'nicht_pruefbar', seiten: [] }
  }
  const segmente = zitat
    .split(AUSLASSUNG)
    .map(normalisieren)
    .filter(Boolean)
  if (segmente.length === 0) return { wortlaut: 'nicht_pruefbar', seiten: [] }

  const seiten = seitenTexte.map(normalisieren)
  if (seiten.join('').length === 0) {
    return { wortlaut: 'nicht_pruefbar', seiten: [] }
  }
  const fassungen = textFassungen(seiten)
  const exakt = seitenFinden(fassungen.exakt, segmente)
  if (exakt.length) return { wortlaut: 'exakt', seiten: exakt }
  const getrennt = [
    ...seitenFinden(fassungen.ohne, segmente),
    ...seitenFinden(fassungen.mit, segmente),
  ]
  if (getrennt.length) return { wortlaut: 'trennung', seiten: getrennt }
  return { wortlaut: 'abweichend', seiten: [] }
}
