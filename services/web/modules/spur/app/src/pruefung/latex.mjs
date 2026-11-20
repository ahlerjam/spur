import { parser } from '../../../../../frontend/js/features/source-editor/lezer-latex/latex.mjs'

const grossUndKlein = namen => namen.flatMap(n => [n, n[0].toUpperCase() + n.slice(1)])
const BELEG_BEFEHLE = new Set([
  ...grossUndKlein(['cite', 'autocite', 'parencite', 'textcite', 'footcite', 'citep', 'citet', 'smartcite', 'supercite']),
  ...grossUndKlein(['citeauthor', 'nptextcite', 'citealp', 'citealt']),
  'fullcite',
  'footfullcite',
  'citeyear',
  'citeyearpar',
  'citetitle',
])
// Je Paar aus optionalen Argumenten und Key ein eigener Beleg.
const MEHRFACH_BEFEHLE = new Set(grossUndKlein(['cites', 'parencites', 'textcites', 'autocites', 'footcites']))
// Befehle, die den Autor in den Satz nehmen; ein Zitat danach im selben Satz gehört zu ihrem Beleg.
const AUTOR_IM_SATZ = new Set(grossUndKlein(['textcite', 'citet', 'citeauthor', 'nptextcite']))
const ANKER_ABSTAND = 300
const SATZENDE = /[.!?]\s|\n[ \t]*\n/
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

export function klammerEnde(text, start, auf, zu) {
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
  if (!m) return null
  if (MEHRFACH_BEFEHLE.has(m[1])) return mehrfachBeleg(text, m[1], BELEG_MUSTER.lastIndex)
  if (!BELEG_BEFEHLE.has(m[1])) return null
  const { werte, pos: nachOpts } = optionen(text, BELEG_MUSTER.lastIndex)
  const keys = argument(text, nachOpts)
  if (!keys) return null
  return { belege: belegLesen(m[1], werte, keys.text), bis: keys.pos }
}

function mehrfachBeleg(text, befehl, pos) {
  const belege = []
  for (;;) {
    const { werte, pos: nachOpts } = optionen(text, pos)
    const keys = argument(text, nachOpts)
    if (!keys) break
    belege.push(...belegLesen(befehl, werte, keys.text))
    pos = keys.pos
  }
  return belege.length ? { belege, bis: pos } : null
}

// „Smith (2024, S. 3) schreibt: …“: Die Seite steht oft erst hinter dem Zitat.
const SEITE_IN_KLAMMERN = /\s*\(((?:S\.|p\.|pp\.)?[\s~]*\d+(?:\s*[-–]+\s*\d+)?)\)/y

function seiteDanach(text, pos) {
  SEITE_IN_KLAMMERN.lastIndex = pos
  const m = SEITE_IN_KLAMMERN.exec(text)
  return m && { seite: m[1].trim(), bis: SEITE_IN_KLAMMERN.lastIndex }
}

// Verknüpft ein Zitat mit dem letzten Autor-im-Satz-Beleg davor, wenn er im selben Satz steht. Ein nachfolgender
// Beleg geht vor; nennt er dieselben Keys, geht der vorangestellte in der Zeile auf.
function mitVorangestelltem(zeilen, text, zitat) {
  const anker = zeilen.at(-1)
  if (anker?.form !== 'beleg' || anker.ausgeblendet || !AUTOR_IM_SATZ.has(anker.belege[0]?.befehl)) return zitat
  const zwischen = text.slice(anker.bis, zitat.von)
  if (zwischen.length > ANKER_ABSTAND || SATZENDE.test(zwischen)) return zitat
  if (zitat.belege.length) {
    if (!anker.belege.every(a => zitat.belege.some(b => b.key === a.key))) return zitat
    zeilen.pop()
    const seiteVorn = key => anker.belege.find(a => a.key === key)?.seite ?? ''
    return { ...zitat, von: anker.von, belege: zitat.belege.map(b => ({ ...b, seite: b.seite || seiteVorn(b.key) })) }
  }
  zeilen.pop()
  const danach = anker.belege.some(b => !b.seite) && seiteDanach(text, zitat.bis)
  return {
    ...zitat,
    von: anker.von,
    bis: danach ? danach.bis : zitat.bis,
    belege: anker.belege.map(b => ({ ...b, seite: b.seite || (danach?.seite ?? '') })),
  }
}

const ZITAT_BEGINN = /\\(?:enquote|textquote|blockquote)\b|„|\\begin\{quote\}/

// Ein Autor-im-Satz-Befehl, auf den im selben Satz ein Zitat folgt, leitet dieses ein und belegt nicht das vorige.
function leitetZitatEin(text, beleg) {
  if (!AUTOR_IM_SATZ.has(beleg.belege[0]?.befehl)) return false
  const rest = text.slice(beleg.bis, beleg.bis + ANKER_ABSTAND)
  const ende = rest.search(SATZENDE)
  return ZITAT_BEGINN.test(ende < 0 ? rest : rest.slice(0, ende))
}

const ABSATZ = /\n[ \t]*\n/

function folgenderBeleg(text, pos) {
  let p = leerraumEnde(text, pos)
  if (/[.,;:]/.test(text[p] ?? '')) p = leerraumEnde(text, p + 1)
  // Ein Beleg im nächsten Absatz gehört nicht mehr zu diesem Zitat.
  if (ABSATZ.test(text.slice(pos, p))) return null
  const beleg = belegAn(text, p)
  return beleg && !leitetZitatEin(text, beleg) ? beleg : null
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
    return zeileMitZitat('enquote', inhalt, start, inhalt.pos, folgenderBeleg(text, inhalt.pos))
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
  // \textquote und \blockquote sind für Zitate gedacht: ohne Beleg nicht prüfbar statt unsichtbar.
  return zeileMitZitat(name, inhalt, start, inhalt.pos, beleg)
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
  return zeileMitZitat('quote', zitat, start, bis, beleg ?? folgenderBeleg(text, bis))
}

function anfuehrung(text, start) {
  const ende = text.indexOf('“', start + 1)
  if (ende < 0) return { ende: start + 1 }
  const zitat = { text: text.slice(start + 1, ende), von: start + 1, bis: ende }
  return zeileMitZitat('anfuehrung', zitat, start, ende + 1, folgenderBeleg(text, ende + 1))
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

// Ein Zitat ohne Beleg: \textquote und \blockquote bleiben als nicht prüfbar sichtbar, sonst ist es nur Text.
const SICHTBAR_OHNE_BELEG = new Set(['textquote', 'blockquote'])

function ohneBelegBehandeln(zeile) {
  if (zeile.belege.length) return zeile
  return SICHTBAR_OHNE_BELEG.has(zeile.form) ? { ...zeile, form: 'unbekannt', befehl: zeile.form } : { ende: zeile.bis }
}

const IST_UNBEKANNT = name =>
  !NICHT_ZITATE.has(name) && (/cite/i.test(name) || /quote$/i.test(name))

// Gruppe 2: die Argumente ([n], #1#2 oder die xparse-Angabe); ohne Argument blendet ein leerer Rumpf nichts aus.
// Kein Leerraum steht neben einem anderen optionalen Leerraum: Sonst wächst die Laufzeit quadratisch (Nutzertext).
const DEFINITIONEN = [
  /\\(?:(?:re)?newcommand|providecommand)\*?\s*(?:\{\s*)?\\([a-zA-Z@]+)\s*(?:\}\s*)?(?:\[(\d)\]\s*)?(?:\[[^\]]*\]\s*)?(?=\{)/g,
  /\\def\s*\\([a-zA-Z@]+)\s*((?:#\d\s*)*)(?=\{)/g,
  /\\(?:New|Renew|Provide|Declare)DocumentCommand\s*(?:\{\s*)?\\([a-zA-Z@]+)\s*(?:\}\s*)?\{([^{}]*)\}\s*(?=\{)/g,
]
const mitArgument = angabe => Boolean(angabe?.trim()) && angabe.trim() !== '0'
const ZITAT_RUMPF = [
  /^\\(?:enquote|textquote|blockquote)\*?\s*(?:\[[^\]]*\]\s*)?\{\s*#1\s*\}$/,
  /^„\s*#1\s*“$/,
  /^“\s*#1\s*”$/,
  /^``\s*#1\s*''$/,
  /^"\s*#1\s*"$/,
]
const BEAMER = /\\documentclass\s*(?:\[[^\]]*\])?\s*\{beamer\}/
const BEAMER_NOTIZEN = /\\setbeameroption\s*\{\s*show notes/

// Zitatmakros (Rumpf ist ein Zitat von #1) und ausgeblendete Makros (leerer Rumpf, Beamer-\note ohne show notes)
// aus den Definitionen der Dokumente.
export function makrosErkennen(texte) {
  const zitat = new Set()
  const ausgeblendet = new Set()
  for (const roh of texte) {
    const text = maskieren(roh)
    for (const muster of DEFINITIONEN) {
      for (const m of text.matchAll(muster)) {
        const rumpf = argument(text, m.index + m[0].length)
        if (!rumpf) continue
        const inhalt = rumpf.text.trim()
        if (!inhalt) {
          if (mitArgument(m[2])) ausgeblendet.add(m[1])
        }
        else if (ZITAT_RUMPF.some(r => r.test(inhalt))) zitat.add(m[1])
      }
    }
    if (BEAMER.test(text) && !BEAMER_NOTIZEN.test(text)) ausgeblendet.add('note')
  }
  return { zitat: [...zitat].sort(), ausgeblendet: [...ausgeblendet].sort() }
}

// Die Einstellung des Projekts geht vor: Ein Name in einer Liste nimmt ihn aus der anderen.
export function makrosWirksam(erkannt, einstellung = {}) {
  const zitat = einstellung.zitat ?? []
  const aus = einstellung.ausgeblendet ?? []
  return {
    zitat: [...new Set([...erkannt.zitat, ...zitat])].filter(n => !aus.includes(n)).sort(),
    ausgeblendet: [...new Set([...erkannt.ausgeblendet.filter(n => !zitat.includes(n)), ...aus])].sort(),
  }
}

// Bedingungen von TeX; \iff (Logik), \ifthenelse (ifthen) und \newif\ifname öffnen keine.
const BEDINGUNG = /\\(if(?!f(?![a-zA-Z@])|thenelse(?![a-zA-Z@]))[a-zA-Z@]*|fi|else)(?![a-zA-Z@])/g
const NACH_NEWIF = /\\newif\s*$/

function ausgeblendeteBereiche(text, ausgeblendet) {
  const bereiche = []
  for (const m of text.matchAll(/\\([a-zA-Z@]+)\*?/g)) {
    if (!ausgeblendet.has(m[1])) continue
    const { pos } = optionen(text, m.index + m[0].length)
    const arg = argument(text, pos)
    if (arg) bereiche.push({ von: m.index, bis: arg.pos })
  }
  // Ausgeblendet ist der Zweig von \iffalse bis zum passenden \else oder \fi.
  let start = -1
  let tiefe = 0
  for (const m of text.matchAll(BEDINGUNG)) {
    if (m[1] === 'else') {
      if (tiefe === 1 && start >= 0) {
        bereiche.push({ von: start, bis: m.index })
        start = -1
      }
    } else if (m[1] === 'fi') {
      if (tiefe === 0) continue
      if (--tiefe === 0 && start >= 0) {
        bereiche.push({ von: start, bis: m.index + m[0].length })
        start = -1
      }
    } else if (NACH_NEWIF.test(text.slice(Math.max(0, m.index - 12), m.index))) {
      continue
    } else if (tiefe > 0) {
      tiefe++
    } else if (m[1] === 'iffalse') {
      start = m.index
      tiefe = 1
    }
  }
  return bereiche
}

const KEINE_MAKROS = { zitat: [], ausgeblendet: [] }

// Zeilen in ausgeblendeten Bereichen tragen `ausgeblendet: true`; Aufrufer zählen sie nur als übersprungen.
export function zitateFinden(quelltext, makros = KEINE_MAKROS) {
  const text = maskieren(quelltext)
  const zitatMakros = new Set(makros.zitat)
  const bereiche = ausgeblendeteBereiche(text, new Set(makros.ausgeblendet))
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
    } else if (zitatMakros.has(name)) {
      treffer = zitatBefehl(text, 'enquote', start, pos)
      if (treffer) treffer.form = name
    } else if (name === 'begin' && text.startsWith('{quote}', pos)) {
      treffer = quoteUmgebung(text, start, pos + '{quote}'.length)
    } else if (BELEG_BEFEHLE.has(name) || MEHRFACH_BEFEHLE.has(name)) {
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
    if (treffer.zitatVon !== undefined && treffer.form !== 'beleg' && treffer.form !== 'unbekannt') {
      treffer = ohneBelegBehandeln(mitVorangestelltem(zeilen, text, treffer))
    }
    if (treffer.form) {
      if (bereiche.some(b => treffer.von >= b.von && treffer.von < b.bis)) treffer.ausgeblendet = true
      zeilen.push(treffer)
    }
    // In einem ausgeblendeten Makro weitersuchen: Das Zitat darin soll als übersprungen zählen.
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
