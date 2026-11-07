import { parser } from '../../../../../frontend/js/features/source-editor/lezer-latex/latex.mjs'

const BELEG_BEFEHLE = new Set([
  'cite',
  'autocite',
  'parencite',
  'textcite',
  'footcite',
  'citep',
  'citet',
])
const NICHT_ZITATE = new Set(['nocite', 'bibliography', 'printbibliography'])
const ZITAT_BEFEHLE = new Set(['enquote', 'textquote', 'textcquote', 'blockquote'])
const MASKIERT = new Set(['Comment', 'VerbatimContent', 'LstInlineContent'])

// Kommentare und Verbatim dürfen keine Zitate liefern. Leerzeichen erhalten die Positionen.
function maskieren(text) {
  const teile = []
  let pos = 0
  parser.parse(text).iterate({
    enter(node) {
      if (!MASKIERT.has(node.name)) return true
      teile.push(text.slice(pos, node.from), ' '.repeat(node.to - node.from))
      pos = node.to
      return false
    },
  })
  teile.push(text.slice(pos))
  return teile.join('')
}

function klammerEnde(text, start, auf, zu) {
  let tiefe = 0
  for (let i = start; i < text.length; i++) {
    const c = text[i]
    if (c === '\\') {
      i++
    } else if (c === auf) {
      tiefe++
    } else if (c === zu && --tiefe === 0) {
      return i
    }
  }
  return -1
}

function leerraumEnde(text, pos) {
  while (/\s|~/.test(text[pos] ?? '')) pos++
  return pos
}

function optionen(text, pos) {
  const werte = []
  let p = leerraumEnde(text, pos)
  while (text[p] === '[') {
    const ende = klammerEnde(text, p, '[', ']')
    if (ende < 0) break
    werte.push({ text: text.slice(p + 1, ende), von: p + 1, bis: ende })
    pos = ende + 1
    p = leerraumEnde(text, pos)
  }
  return { werte, pos }
}

function argument(text, pos) {
  const p = leerraumEnde(text, pos)
  if (text[p] !== '{') return null
  const ende = klammerEnde(text, p, '{', '}')
  if (ende < 0) return null
  return { text: text.slice(p + 1, ende), von: p + 1, bis: ende, pos: ende + 1 }
}

function belegLesen(befehl, opts, keys) {
  const seite = opts.length ? opts[opts.length - 1].text.trim() : ''
  return keys
    .split(',')
    .map(key => key.trim())
    .filter(Boolean)
    .map(key => ({ befehl, key, seite }))
}

const BELEG_MUSTER = /\\([a-zA-Z]+)\*?/y

function belegAn(text, pos) {
  BELEG_MUSTER.lastIndex = pos
  const m = BELEG_MUSTER.exec(text)
  if (!m || !BELEG_BEFEHLE.has(m[1])) return null
  const { werte, pos: nachOpts } = optionen(text, BELEG_MUSTER.lastIndex)
  const keys = argument(text, nachOpts)
  if (!keys) return null
  return { belege: belegLesen(m[1], werte, keys.text), bis: keys.pos }
}

function folgenderBeleg(text, pos) {
  let p = leerraumEnde(text, pos)
  if (/[.,;:]/.test(text[p] ?? '')) p = leerraumEnde(text, p + 1)
  return belegAn(text, p)
}

function zeileMitZitat(form, zitat, von, bis, beleg) {
  return {
    form,
    roh: zitat.text,
    zitatVon: zitat.von,
    zitatBis: zitat.bis,
    von,
    bis: Math.max(bis, beleg?.bis ?? 0),
    belege: beleg?.belege ?? [],
  }
}

function zitatBefehl(text, name, start, pos) {
  if (name === 'enquote') {
    const inhalt = argument(text, pos)
    if (!inhalt) return null
    const beleg = folgenderBeleg(text, inhalt.pos)
    return beleg
      ? zeileMitZitat('enquote', inhalt, start, inhalt.pos, beleg)
      : { ende: inhalt.pos }
  }
  if (name === 'textcquote') {
    const { werte, pos: nachOpts } = optionen(text, pos)
    const keys = argument(text, nachOpts)
    if (!keys) return null
    const { pos: nachPunkt } = optionen(text, keys.pos)
    const inhalt = argument(text, nachPunkt)
    if (!inhalt) return null
    return zeileMitZitat('textcquote', inhalt, start, inhalt.pos, {
      belege: belegLesen('textcquote', werte, keys.text),
      bis: inhalt.pos,
    })
  }
  const { werte, pos: nachOpts } = optionen(text, pos)
  const inhalt = argument(text, nachOpts)
  if (!inhalt) return null
  const innen = werte[0] && belegAn(werte[0].text, leerraumEnde(werte[0].text, 0))
  const beleg = innen
    ? { belege: innen.belege, bis: inhalt.pos }
    : folgenderBeleg(text, inhalt.pos)
  if (beleg) return zeileMitZitat(name, inhalt, start, inhalt.pos, beleg)
  // \textquote und \blockquote sind für Zitate gedacht: ohne Beleg nicht prüfbar statt unsichtbar.
  return { ...zeileMitZitat(name, inhalt, start, inhalt.pos, null), form: 'unbekannt', befehl: name }
}

function quoteUmgebung(text, start, pos) {
  const ende = text.indexOf('\\end{quote}', pos)
  if (ende < 0) return null
  const bis = ende + '\\end{quote}'.length
  let inhaltBis = ende
  while (/\s/.test(text[inhaltBis - 1])) inhaltBis--
  const roh = text.slice(pos, inhaltBis)
  const innen = /\\[a-zA-Z]+\*?(\s*\[[^\]]*\])*\s*\{[^{}]*\}\.?$/.exec(roh)
  const beleg = innen && belegAn(text, pos + innen.index)
  const zitat = {
    text: beleg ? roh.slice(0, innen.index) : roh,
    von: pos,
    bis: beleg ? pos + innen.index : inhaltBis,
  }
  const nachher = beleg ? null : folgenderBeleg(text, bis)
  if (!beleg && !nachher) return { ende: bis }
  return zeileMitZitat('quote', zitat, start, bis, beleg ?? nachher)
}

function anfuehrung(text, start) {
  const ende = text.indexOf('“', start + 1)
  if (ende < 0) return { ende: start + 1 }
  const zitat = { text: text.slice(start + 1, ende), von: start + 1, bis: ende }
  const beleg = folgenderBeleg(text, ende + 1)
  return beleg
    ? zeileMitZitat('anfuehrung', zitat, start, ende + 1, beleg)
    : { ende: ende + 1 }
}

function unbekannteForm(text, name, start, pos) {
  const { pos: nachOpts } = optionen(text, pos)
  const inhalt = argument(text, nachOpts)
  const bis = inhalt ? inhalt.pos : pos
  return {
    form: 'unbekannt',
    roh: text.slice(start, bis),
    zitatVon: start,
    zitatBis: bis,
    von: start,
    bis,
    belege: [],
    befehl: name,
  }
}

const IST_UNBEKANNT = name =>
  !NICHT_ZITATE.has(name) && (/cite/i.test(name) || /quote$/i.test(name))

export function zitateFinden(quelltext) {
  const text = maskieren(quelltext)
  const zeilen = []
  const muster = /\\([a-zA-Z]+)\*?|„/g
  for (let m = muster.exec(text); m; m = muster.exec(text)) {
    const start = m.index
    const name = m[1]
    const pos = muster.lastIndex
    let treffer = null
    if (!name) {
      treffer = anfuehrung(text, start)
    } else if (ZITAT_BEFEHLE.has(name)) {
      treffer = zitatBefehl(text, name, start, pos)
    } else if (name === 'begin' && text.startsWith('{quote}', pos)) {
      treffer = quoteUmgebung(text, start, pos + '{quote}'.length)
    } else if (BELEG_BEFEHLE.has(name)) {
      const beleg = belegAn(text, start)
      if (beleg) {
        treffer = {
          form: 'beleg',
          roh: '',
          zitatVon: start,
          zitatBis: beleg.bis,
          von: start,
          bis: beleg.bis,
          belege: beleg.belege,
        }
      }
    } else if (IST_UNBEKANNT(name)) {
      treffer = unbekannteForm(text, name, start, pos)
    }
    if (!treffer) continue
    if (treffer.form) zeilen.push(treffer)
    muster.lastIndex = treffer.ende ?? treffer.bis
  }
  return zeilen
}

export function zitierpaket(text) {
  if (/\\usepackage(\[[^\]]*\])?\{[^}]*\bnatbib\b/.test(text)) return 'natbib'
  if (/\\usepackage(\[[^\]]*\])?\{[^}]*\bbiblatex\b/.test(text)) return 'biblatex'
  return null
}

export const AUSLASSUNG = '\u0000'
export const BUCHSTABE = '\u0001'

export function latexZuText(roh) {
  return roh
    .replace(/\\textelp\s*\{[^{}]*\}/g, AUSLASSUNG)
    .replace(/\[(…|\.\.\.)\]/g, AUSLASSUNG)
    .replace(/\s*\[sic!?\]/g, '')
    .replace(/\\sic\s*\{\}/g, '')
    .replace(/\\textins\*?\s*\{(\p{L})\}/gu, `${BUCHSTABE}$1`)
    .replace(/\[(\p{L})\]/gu, `${BUCHSTABE}$1`)
    .replace(/\\-/g, '')
    .replace(/\\[,;: ]/g, ' ')
    .replace(/~/g, ' ')
    .replace(/---/g, '—')
    .replace(/--/g, '–')
    .replace(/``|''/g, '"')
    .replace(/\\([&%_#$])/g, '$1')
    .replace(/\\[a-zA-Z]+\*?\s*(\[[^\]]*\])?/g, '')
    .replace(/[{}]/g, '')
}

export function seiteAusBeleg(seite) {
  return /\d+/.exec(seite)?.[0] ?? null
}
