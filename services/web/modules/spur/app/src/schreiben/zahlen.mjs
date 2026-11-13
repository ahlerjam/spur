// Heuristik für Zahlen in Claudes Text, die nicht aus ergebnisse.tex stammen.
// Gemeldet: Zahlen im Fließtext, Werte in \num, \qty, \SI, \SIrange und in Formeln Dezimalzahlen und Zahlen
// ab drei Stellen. Nicht gemeldet: Seitenangaben, Jahreszahlen, Datum, Uhrzeit (auch „9 Uhr“), Versionsnummern (auch „Python 3.12“), Befehlsargumente, Kommentare, Grafiken (TikZ,
// pgfplots), Farbangaben, optionale Argumente und einzelne Ganzzahlen bis zwei Stellen in Formeln (Exponenten,
// Indizes).
const MATHE = [
  /\$\$[\s\S]*?\$\$/g,
  /\$(?:\\.|[^$\\])*\$/g,
  /\\\([\s\S]*?\\\)/g,
  /\\\[[\s\S]*?\\\]/g,
  /\\begin\{(equation|align|gather|multline|eqnarray|math|displaymath)\*?\}[\s\S]*?\\end\{\1\*?\}/g,
]
const KOMMENTAR = /(?<!\\)%.*$/gm
const DEFINITION = /\\(?:re)?newcommand\*?\s*\{?\\\w+\}?(?:\[\d\])?\s*\{(?:[^{}]|\{[^{}]*\})*\}/g
const GRAFIK =
  /\\begin\{(tikzpicture|pgfpicture|axis|semilogxaxis|semilogyaxis|loglogaxis|polaraxis|ternaryaxis|groupplot)\}[\s\S]*?\\end\{\1\}/g
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
// Nur bekannte Namen: „Gruppe 2“ ist keine Version.
const SOFTWARE = /\b(?:Python|SPSS|SAS|Stata|MATLAB|Matlab|Julia|Node|Java|Excel|Windows|macOS|Ubuntu|Linux|TeX Live|LaTeX|NVivo|MAXQDA|JASP|jamovi|Zotero)\s+\d+(?:\.\d+)*/g
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

// belegt: Zahlen aus ergebnisse.tex. Sie gelten in Formeln und siunitx-Werten als belegt; im Fließtext soll statt
// der getippten Zahl das Makro stehen, dort bleibt sie gemeldet.
export function zahlenOhneBeleg(text, belegt = []) {
  const bekannt = new Set(belegt.map(vergleichbar))
  const unbelegt = zahlen => zahlen.filter(z => !bekannt.has(vergleichbar(z))).join(' ')
  let rest = text.replace(KOMMENTAR, ' ').replace(DEFINITION, ' ').replace(GRAFIK, ' ')
  rest = rest.replace(SIUNITX, (_, befehl, a, b) => ` ${unbelegt(zahlenIn(ZWEI_WERTE.has(befehl) ? `${a} ${b}` : a))} `)
  rest = rest.replace(FARBDEFINITION, ' ').replace(FARBE, ' ').replace(FARBMISCHUNG, ' ').replace(OPTIONAL, '$1 ')
  // Formeln an Ort und Stelle durch ihre meldenswerten Zahlen ersetzen, damit die Reihenfolge bleibt.
  for (const muster of MATHE) rest = rest.replace(muster, formel => ` ${unbelegt(formelZahlen(formel))} `)
  rest = rest.replace(BEFEHL_ARGUMENTE, ' ').replace(SEITE, ' ')
  for (const muster of [...DATUM, UHRZEIT, UHR, ...VERSION, SOFTWARE]) rest = rest.replace(muster, ' ')
  rest = rest.replace(JAHR, ' ')
  return [...new Set(rest.match(ZAHL) ?? [])]
}
