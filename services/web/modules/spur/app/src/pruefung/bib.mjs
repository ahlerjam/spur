const EINTRAG = /@([a-zA-Z]+)\s*\{\s*([^,\s]+)\s*,/g

function feldWert(rumpf, name) {
  const m = new RegExp(`\\b${name}\\s*=\\s*[{"]`, 'i').exec(rumpf)
  if (!m) return null
  const start = m.index + m[0].length
  const auf = m[0].at(-1)
  let tiefe = 1
  for (let i = start; i < rumpf.length; i++) {
    const c = rumpf[i]
    if (auf === '"' && c === '"' && rumpf[i - 1] !== '\\') return rumpf.slice(start, i)
    if (auf === '{' && c === '{') tiefe++
    if (auf === '{' && c === '}' && --tiefe === 0) return rumpf.slice(start, i)
  }
  return null
}

// Viele Exporte schreiben die DOI als URL oder mit Präfix: für Crossref zählt nur „10.…“.
export function doiNormal(wert) {
  const doi = wert?.trim().replace(/^(https?:\/\/(dx\.)?doi\.org\/|doi:\s*)/i, '')
  return doi || null
}

export function bibLesen(text) {
  const eintraege = new Map()
  for (const m of text.matchAll(EINTRAG)) {
    if (/^(comment|string|preamble)$/i.test(m[1])) continue
    const rumpf = text.slice(m.index + m[0].length)
    const naechster = rumpf.search(/\n\s*@[a-zA-Z]+\s*\{/)
    const felder = naechster < 0 ? rumpf : rumpf.slice(0, naechster)
    eintraege.set(m[2], { key: m[2], doi: doiNormal(feldWert(felder, 'doi')) })
  }
  return eintraege
}

const LATEX_ZEICHEN = /[\\{}&%$#_^~]/g
const LATEX_ERSATZ = {
  '\\': '\\textbackslash{}',
  '~': '\\textasciitilde{}',
  '^': '\\textasciicircum{}',
}

export function latexSicher(text) {
  return text.replace(LATEX_ZEICHEN, c => LATEX_ERSATZ[c] ?? `\\${c}`)
}

export const autorName = a => [a.family, a.given].filter(Boolean).join(', ')

export function bibEintrag(key, quelle) {
  const meta = quelle.meta?.gefunden ? quelle.meta : {}
  // Crossref-Daten und Dateinamen sind fremder Text: maskieren, damit die Klammern der .bib halten.
  const text = wert => wert && latexSicher(String(wert))
  const ohneKlammern = wert => wert && String(wert).replace(/[{}\\]/g, '')
  const felder = [
    ['author', text(meta.autoren?.map(autorName).join(' and '))],
    ['title', text(meta.titel ?? quelle.dateiname)],
    ['journal', text(meta.journal)],
    ['year', ohneKlammern(meta.jahr)],
    ['pages', ohneKlammern(meta.seiten?.replace('-', '--'))],
    ['doi', ohneKlammern(quelle.doi)],
  ].filter(([, wert]) => wert)
  const zeilen = felder.map(([name, wert]) => `  ${name} = {${wert}}`)
  return `@article{${key},\n${zeilen.join(',\n')}\n}`
}
