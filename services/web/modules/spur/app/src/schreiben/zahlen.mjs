// Heuristik für Zahlen in Claudes Text, die nicht aus ergebnisse.tex stammen.
// Gemeldet: Zahlen im Fließtext, Werte in \num, \qty, \SI, \SIrange und in Formeln Dezimalzahlen und Zahlen
// ab drei Stellen. Nicht gemeldet: Seitenangaben, Jahreszahlen, Befehlsargumente, Kommentare, Grafiken (TikZ,
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

export function zahlenOhneBeleg(text, belegt = []) {
  const bekannt = new Set(belegt.map(vergleichbar))
  let rest = text.replace(KOMMENTAR, ' ').replace(DEFINITION, ' ').replace(GRAFIK, ' ')
  rest = rest.replace(SIUNITX, (_, befehl, a, b) => ` ${ZWEI_WERTE.has(befehl) ? `${a} ${b}` : a} `)
  rest = rest.replace(FARBDEFINITION, ' ').replace(FARBE, ' ').replace(FARBMISCHUNG, ' ').replace(OPTIONAL, '$1 ')
  // Formeln an Ort und Stelle durch ihre meldenswerten Zahlen ersetzen, damit die Reihenfolge bleibt.
  for (const muster of MATHE) rest = rest.replace(muster, formel => ` ${formelZahlen(formel).join(' ')} `)
  rest = rest.replace(BEFEHL_ARGUMENTE, ' ').replace(SEITE, ' ').replace(JAHR, ' ')
  return [...new Set(rest.match(ZAHL) ?? [])].filter(z => !bekannt.has(vergleichbar(z)))
}
