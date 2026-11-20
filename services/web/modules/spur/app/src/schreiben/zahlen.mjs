import { klammerEnde } from '../pruefung/latex.mjs'
// Heuristik für Zahlen in Claudes Text, die nicht aus ergebnisse.tex stammen.
// Gemeldet: Zahlen im Fließtext, Werte in \num, \qty, \SI, \SIrange und in Formeln Dezimalzahlen und Zahlen
// ab drei Stellen. Nicht gemeldet: Seitenangaben, Jahreszahlen, Datum, Uhrzeit (auch „9 Uhr“), Versionsnummern (auch „Python 3.12“), Befehlsargumente, Kommentare, Grafiken (TikZ,
// pgfplots), Farbangaben, optionale Argumente und einzelne Ganzzahlen bis zwei Stellen in Formeln (Exponenten,
// Indizes).
const MATHE_UMGEBUNGEN = ['equation', 'align', 'gather', 'multline', 'eqnarray', 'math', 'displaymath']
const MATHE = [
  /\$\$[\s\S]*?\$\$/g,
  /\$(?:\\.|[^$\\])*\$/g,
  /\\\([\s\S]*?\\\)/g,
  /\\\[[\s\S]*?\\\]/g,
  new RegExp(`\\\\begin\\{(${MATHE_UMGEBUNGEN.join('|')})\\*?\\}[\\s\\S]*?\\\\end\\{\\1\\*?\\}`, 'g'),
]
const KOMMENTAR = /(?<!\\)%.*$/gm
const DEFINITION = /\\(?:re)?newcommand\*?\s*\{?\\\w+\}?(?:\[\d\])?\s*\{(?:[^{}]|\{[^{}]*\})*\}/g
const GRAFIK_UMGEBUNGEN = [
  'tikzpicture', 'pgfpicture', 'axis', 'semilogxaxis', 'semilogyaxis', 'loglogaxis', 'polaraxis', 'ternaryaxis', 'groupplot',
  'scope', 'tikzcd', 'circuitikz', 'forest', 'pgfonlayer',
]
const GRAFIK = new RegExp(`\\\\begin\\{(${GRAFIK_UMGEBUNGEN.join('|')})\\}[\\s\\S]*?\\\\end\\{\\1\\}`, 'g')
// Befehle, deren Argumente Einstellungen sind, keine Ergebnisse; die Argumente können verschachtelt sein.
const EINSTELLUNGEN = new Set([
  'tikzset', 'tikzstyle', 'pgfplotsset', 'usetikzlibrary', 'geometry', 'hypersetup', 'captionsetup', 'setstretch',
  'linespread', 'rule', 'resizebox', 'scalebox', 'newlength', 'addtolength',
])
const SPALTEN = /^\{(?:tabularx?|array)\*?\}/
const LAENGE = /(?<![\p{L}\d\\.,])\d+(?:[.,]\d+)?(?:(?:pt|mm|cm|in|em|ex|bp)(?![a-zA-Z])|\\(?:textwidth|linewidth|columnwidth|baselineskip)(?![a-zA-Z]))/gu
const ZEICHENBEFEHL = /^[ \t]*\\(?:draw|node|path|fill|filldraw|coordinate|clip|addplot)\b.*$/gm
const KOORDINATE = /\(\s*[-+]?(?:\d+(?:[.,]\d+)?|[.,]\d+)\s*,\s*[-+]?(?:\d+(?:[.,]\d+)?|[.,]\d+)\s*\)/g
// siunitx: Werte bleiben als Text stehen, Optionen und Einheit fallen weg.
const SIUNITX = /\\(num|qty|SI|SIrange|qtyrange|numrange)\s*(?:\[[^\]]*\])?\s*\{([^{}]*)\}(?:\s*\{([^{}]*)\})?(?:\s*\{([^{}]*)\})?/g
const ZWEI_WERTE = new Set(['SIrange', 'qtyrange', 'numrange'])
const FARBDEFINITION = /\\(?:definecolor|colorlet|providecolor)\s*(?:\[[^\]]*\])?(?:\s*\{[^{}]*\})*/g
const FARBE = /\\(?:textcolor|colorbox|fcolorbox|color|pagecolor)\s*(?:\[[^\]]*\])?\s*\{[^{}]*\}/g
const FARBMISCHUNG = /\b[a-zA-Z]+(?:![\d.]+(?:![a-zA-Z]+)?)+/g
const OPTIONAL = /(\\[a-zA-Z@]+\*?|\\\\)((?:\s*\[[^\]]*\])+)/g
// Pflichtargumente von Befehlen, die keinen Fließtext tragen.
const BEFEHL_ARGUMENTE =
  /\\(?:\w*cite\w*|ref|eqref|pageref|autoref|cref|Cref|label|input|include|includegraphics|url|href|v?space|hspace|setlength|setcounter|addtocounter|documentclass|usepackage|begin|end|section|subsection|subsubsection|chapter|paragraph|caption)\*?(?:\s*\{[^{}]*\})*/g
const SEITE = /\b(?:S\.|Seiten?|p\.|pp\.|pages?|Kap\.|Kapitel|Abb\.|Tab\.|Abschnitt)\s*~?\s*\d+(?:\s*(?:--?|–)\s*\d+)?/g
const JAHR = /(?<![\d.,])(?:1[5-9]\d\d|20\d\d)[a-z]?(?![\d.,]\d)/g
// Datum, Uhrzeit und Versionsnummern sind keine Messwerte.
const MONAT =
  '(?:Januar|Jänner|Februar|März|April|Mai|Juni|Juli|August|September|Oktober|November|Dezember|January|February|' +
  'March|May|June|July|October|December|Jan|Feb|Mär|Mar|Apr|Jun|Jul|Aug|Sept|Sep|Okt|Oct|Nov|Dez|Dec)\\.?'
const DATUM = [
  /(?<![\d.,])(?:0?[1-9]|[12]\d|3[01])\.(?:0?[1-9]|1[0-2])\.(?:\d{4}|\d{2})(?![\d,]|\.\d)/g,
  // Ohne Jahr nur zweistellig (12.11.), sonst wäre „bei 12.5.“ am Satzende ein Datum.
  /(?<![\d.,])(?:0[1-9]|[12]\d|3[01])\.(?:0[1-9]|1[0-2])\.(?![\d,]|\.\d)/g,
  /(?<![\d.,-])\d{4}-\d{2}-\d{2}(?![\d-])/g,
  new RegExp(`(?<![\\d.,])\\d{1,2}\\.?\\s*${MONAT}(?:\\s+\\d{4})?(?![\\p{L}\\d])`, 'gu'),
  new RegExp(`${MONAT}\\s+\\d{1,2}(?:st|nd|rd|th)?,?(?:\\s+\\d{4})?(?![\\d])`, 'g'),
]
const UHRZEIT = /(?<![\d.,:])(?:[01]?\d|2[0-3]):[0-5]\d(?::[0-5]\d)?(?![\d:])/g
const VERSION = [/\b(?:Version|Vers\.|v|V)\s*\d+(?:\.\d+)*/g, /(?<![\d.,])\d+(?:\.\d+){2,}(?![\d.,]\d)/g]
// „9 Uhr“, „9.30 Uhr“; ohne „Uhr“ bleibt 9.30 eine Dezimalzahl.
const UHR = /(?<![\d.,])\d{1,2}(?:[.:]\d{2})?\s*Uhr\b/g
// Namen, hinter denen eine ganze Zahl eine Version ist, und Namen, die auch Vornamen oder Alltagswörter sind (Julia,
// Excel, Linux): dort zählt nur eine Version mit Punkt. Nur Leerzeichen, kein Zeilenumbruch dazwischen.
const SOFTWARE = [
  /\b(?:Python|SPSS|SAS|Stata|MATLAB|Matlab|Node|Java|Windows|macOS|Ubuntu|TeX Live|LaTeX|NVivo|MAXQDA|JASP|jamovi|Zotero)[ \t]+\d+(?:\.\d+)*/g,
  /\b(?:Julia|Excel|Linux)[ \t]+\d+(?:\.\d+)+/g,
]
const ZAHL = /(?<![\p{L}\d\\\-.,])\d+(?:[.,]\d+)*(?![\p{L}\d])/gu

const dezimalzeichen = text => text.replace(/\{,\}/g, ',')
const vergleichbar = zahl => zahl.replace(',', '.')

function formelZahlen(formel) {
  return (dezimalzeichen(formel).match(ZAHL) ?? []).filter(z => /[.,]/.test(z) || z.length >= 3)
}

// Alle Zahlen eines Textes, etwa aus ergebnisse.tex.
export function zahlenIn(text) {
  return dezimalzeichen(text).match(ZAHL) ?? []
}

// Ende der Argumente ab pos: [..], {..} und bei \tikzstyle das „=[..]“, beliebig verschachtelt.
function argumenteEnde(text, pos) {
  for (;;) {
    let p = pos
    while (/\s/.test(text[p] ?? '')) p++
    if (text[p] === '=') p++
    while (/\s/.test(text[p] ?? '')) p++
    const zu = { '[': ']', '{': '}' }[text[p]]
    const ende = zu ? klammerEnde(text, p, text[p], zu) : -1
    if (ende < 0) return pos
    pos = ende + 1
  }
}

function einstellungenEntfernen(text) {
  let rest = ''
  let pos = 0
  for (const m of text.matchAll(/\\([a-zA-Z]+)\*?/g)) {
    if (m.index < pos) continue
    const nachName = m.index + m[0].length
    const spalten = m[1] === 'begin' && SPALTEN.exec(text.slice(nachName))
    if (!EINSTELLUNGEN.has(m[1]) && !spalten) continue
    const ende = argumenteEnde(text, spalten ? nachName + spalten[0].length : nachName)
    rest += `${text.slice(pos, m.index)} `
    pos = ende
  }
  return rest + text.slice(pos)
}

// Wo ein Stück im Dokument steht: 'grafik', 'praeambel', 'mathe' oder null (Fließtext).
export function lageImDokument(dokument, von) {
  const davor = dokument.slice(0, von).replace(KOMMENTAR, ' ')
  const start = dokument.indexOf('\\begin{document}')
  if (start >= 0 && von < start) return 'praeambel'
  const offen = []
  for (const m of davor.matchAll(/\\(begin|end)\s*\{([a-zA-Z]+)\*?\}/g)) {
    const i = offen.lastIndexOf(m[2])
    if (m[1] === 'begin') offen.push(m[2])
    else if (i >= 0) offen.splice(i, 1)
  }
  if (offen.some(u => GRAFIK_UMGEBUNGEN.includes(u))) return 'grafik'
  if (offen.some(u => MATHE_UMGEBUNGEN.includes(u))) return 'mathe'
  return null
}

// belegt: Zahlen aus ergebnisse.tex. Sie gelten in Formeln und siunitx-Werten als belegt; im Fließtext soll statt
// der getippten Zahl das Makro stehen, dort bleibt sie gemeldet.
// lage (lageImDokument): In Grafik und Präambel wird nichts gemeldet, in einer Mathe-Umgebung gilt die Formelregel.
export function zahlenOhneBeleg(text, belegt = [], lage = null) {
  if (lage === 'grafik' || lage === 'praeambel') return []
  const bekannt = new Set(belegt.map(vergleichbar))
  const unbelegt = zahlen => zahlen.filter(z => !bekannt.has(vergleichbar(z))).join(' ')
  let rest = einstellungenEntfernen(text.replace(KOMMENTAR, ' ')).replace(DEFINITION, ' ').replace(GRAFIK, ' ')
  rest = rest.replace(ZEICHENBEFEHL, zeile => zeile.replace(KOORDINATE, ' ')).replace(LAENGE, ' ')
  if (lage === 'mathe') return [...new Set(unbelegt(formelZahlen(rest)).split(' ').filter(Boolean))]
  rest = rest.replace(SIUNITX, (_, befehl, a, b) => ` ${unbelegt(zahlenIn(ZWEI_WERTE.has(befehl) ? `${a} ${b}` : a))} `)
  rest = rest.replace(FARBDEFINITION, ' ').replace(FARBE, ' ').replace(FARBMISCHUNG, ' ').replace(OPTIONAL, '$1 ')
  // Formeln an Ort und Stelle durch ihre meldenswerten Zahlen ersetzen, damit die Reihenfolge bleibt.
  for (const muster of MATHE) rest = rest.replace(muster, formel => ` ${unbelegt(formelZahlen(formel))} `)
  rest = rest.replace(BEFEHL_ARGUMENTE, ' ').replace(SEITE, ' ')
  for (const muster of [...DATUM, UHRZEIT, UHR, ...VERSION, ...SOFTWARE]) rest = rest.replace(muster, ' ')
  rest = rest.replace(JAHR, ' ')
  return [...new Set(rest.match(ZAHL) ?? [])]
}
