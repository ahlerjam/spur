// Heuristik für Zahlen in Claudes Fließtext, die nicht aus ergebnisse.tex stammen.
// Mathe, Seitenangaben, Jahreszahlen, Befehlsargumente und Kommentare zählen nicht.
const MATHE = [
  /\$\$[\s\S]*?\$\$/g,
  /\$(?:\\.|[^$\\])*\$/g,
  /\\\([\s\S]*?\\\)/g,
  /\\\[[\s\S]*?\\\]/g,
  /\\begin\{(equation|align|gather|multline|eqnarray|math|displaymath)\*?\}[\s\S]*?\\end\{\1\*?\}/g,
]
const KOMMENTAR = /(?<!\\)%.*$/gm
const DEFINITION = /\\(?:re)?newcommand\*?\s*\{?\\\w+\}?(?:\[\d\])?\s*\{(?:[^{}]|\{[^{}]*\})*\}/g
// Optionale und Pflichtargumente von Befehlen, die keinen Fließtext tragen.
const BEFEHL_ARGUMENTE =
  /\\(?:\w*cite\w*|ref|eqref|pageref|autoref|cref|Cref|label|input|include|includegraphics|url|href|v?space|hspace|setlength|setcounter|addtocounter|documentclass|usepackage|begin|end|section|subsection|subsubsection|chapter|paragraph|caption)\*?(?:\s*\[[^\]]*\])*(?:\s*\{[^{}]*\})*/g
const SEITE = /\b(?:S\.|Seiten?|p\.|pp\.|pages?|Kap\.|Kapitel|Abb\.|Tab\.|Abschnitt)\s*~?\s*\d+(?:\s*(?:--?|–)\s*\d+)?/g
const JAHR = /(?<![\d.,])(?:1[5-9]\d\d|20\d\d)[a-z]?(?![\d.,]\d)/g
const ZAHL = /(?<![\p{L}\d\\\-.,])\d+(?:[.,]\d+)*(?![\p{L}\d])/gu

export function zahlenOhneBeleg(text) {
  let rest = text.replace(KOMMENTAR, ' ').replace(DEFINITION, ' ')
  for (const muster of MATHE) rest = rest.replace(muster, ' ')
  rest = rest.replace(BEFEHL_ARGUMENTE, ' ').replace(SEITE, ' ').replace(JAHR, ' ')
  return [...new Set(rest.match(ZAHL) ?? [])]
}
