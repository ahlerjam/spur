import { ohneTags, textAus } from '../fremdtext.mjs'

const EINTRAG = /@([a-zA-Z]+)\s*\{\s*([^,\s]+)\s*,/g

function feldWert(rumpf, name) {
  const m = new RegExp(`\\b${name}\\s*=\\s*[{"]`, 'i').exec(rumpf)
  // BibTeX erlaubt Zahlen und @string-Namen ohne Klammern: year = 2020.
  if (!m) return new RegExp(`\\b${name}\\s*=\\s*([\\w.:-]+)`, 'i').exec(rumpf)?.[1] ?? null
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

// Felder, die bib_list mit Crossref vergleicht.
const VERGLICHEN = ['volume', 'number', 'pages', 'eid', 'year', 'date']

export function bibLesen(text) {
  const eintraege = new Map()
  for (const m of text.matchAll(EINTRAG)) {
    if (/^(comment|string|preamble)$/i.test(m[1])) continue
    const rumpf = text.slice(m.index + m[0].length)
    const naechster = rumpf.search(/\n\s*@[a-zA-Z]+\s*\{/)
    const felder = naechster < 0 ? rumpf : rumpf.slice(0, naechster)
    const werte = Object.fromEntries(VERGLICHEN.map(name => [name, feldWert(felder, name)?.trim() || null]))
    eintraege.set(m[2], { key: m[2], typ: m[1].toLowerCase(), doi: doiNormal(feldWert(felder, 'doi')), ...werte })
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

// Wie klartext, aber kursiv bleibt kursiv. sanitize-html schließt offene Tags, die Klammern gehen also immer auf. Erst
// zerlegen, dann auflösen: Ein maskiertes `&lt;i&gt;` bleibt so Text.
function htmlZuLatex(html) {
  return ohneTags(html, ['i', 'em'])
    .split(/(<\/?(?:i|em)>)/)
    .map(teil => (/^<(i|em)>$/.test(teil) ? '\\textit{' : /^<\//.test(teil) ? '}' : latexSicher(textAus(teil).replace(/\uFFFD/g, ''))))
    .join('')
    .trim()
}

// Crossref-Daten, Webseiten-Titel und Dateinamen sind fremder Text: maskieren, damit die Klammern der .bib halten und
// TeX nichts ausführt (auch `^^5c` ergäbe sonst einen Backslash). Nur doi und url stehen wörtlich (ohneKlammern).
const text = wert => wert && latexSicher(String(wert))
const ohneKlammern = wert => wert && String(wert).replace(/[{}\\]/g, '')
const alsBib = (typ, key, felder) => {
  const zeilen = felder.filter(([, wert]) => wert).map(([name, wert]) => `  ${name} = {${wert}}`)
  return `@${typ}{${key},\n${zeilen.join(',\n')}\n}`
}

function webEintrag(key, quelle) {
  return alsBib('online', key, [
    ['title', text(quelle.meta?.titel ?? quelle.web.url)],
    // Die URL steht in biblatex wörtlich; nur Klammern und Backslash würden die .bib brechen.
    ['url', ohneKlammern(quelle.web.url)],
    ['urldate', quelle.web.abgerufenAm.toISOString().slice(0, 10)],
  ])
}

// Eintragstyp je Art einer Quelle ohne DOI; `stelle` ist das Feld für die Institution.
const OHNE_DOI = {
  thesis: { typ: 'thesis', stelle: 'institution', mitType: true },
  report: { typ: 'report', stelle: 'institution', mitType: true },
  working_paper: { typ: 'report', stelle: 'institution', mitType: true, type: 'Working paper' },
  book: { typ: 'book', stelle: 'publisher' },
  misc: { typ: 'misc', stelle: 'organization' },
}

function ohneDoiEintrag(key, { meta }) {
  const form = OHNE_DOI[meta.art]
  return alsBib(form.typ, key, [
    ['author', text(meta.autoren?.map(autorName).join(' and '))],
    ['title', text(meta.titel)],
    ['year', text(meta.jahr)],
    ['type', form.mitType && text(meta.abschluss ?? form.type)],
    [form.stelle, text(meta.institution)],
    ['url', ohneKlammern(meta.url)],
    ['urldate', meta.url && meta.abgerufenAm?.toISOString().slice(0, 10)],
  ])
}

export const ARXIV_DOI = /^10\.48550\/arxiv\./i

// Eintragstyp und Feld für den Namen des Behälters (Zeitschrift, Buch, Tagungsband) je Crossref-Typ, nach biblatex-apa.
const NACH_TYP = {
  'journal-article': { typ: 'article', behaelter: 'journal' },
  'book-chapter': { typ: 'incollection', behaelter: 'booktitle', verlag: true },
  book: { typ: 'book', verlag: true },
  monograph: { typ: 'book', verlag: true },
  'proceedings-article': { typ: 'inproceedings', behaelter: 'booktitle', verlag: true },
}
const PREPRINT = { typ: 'online' }

// Form des Eintrags eines Werks mit DOI. Ohne Typ (Quellen von vor P6) bleibt es beim Zeitschriftenartikel.
function formVon(doi, meta) {
  if (ARXIV_DOI.test(doi ?? '') || ['preprint', 'posted-content'].includes(meta.typ)) return PREPRINT
  return meta.typ ? (NACH_TYP[meta.typ] ?? { typ: 'misc' }) : NACH_TYP['journal-article']
}

// Der erwartete Eintragstyp eines Werks mit DOI; bib_list vergleicht ihn mit dem Eintrag.
export const eintragstyp = (doi, meta) => formVon(doi, meta).typ

const autorenFeld = meta => text(meta.autoren?.map(autorName).join(' and '))
const titelFeld = (meta, ersatz) => (meta.titelHtml ? htmlZuLatex(meta.titelHtml) : text(meta.titel ?? ersatz))

// biblatex-apa führt Preprints als @online mit dem Namen des Archivs in eprint (Testreferenz 10.8:73a).
function preprintEintrag(key, quelle, meta) {
  const archiv = ARXIV_DOI.test(quelle.doi ?? '') || meta.typ === 'preprint' ? 'arXiv' : meta.archiv
  return alsBib('online', key, [
    ['author', autorenFeld(meta)],
    ['title', titelFeld(meta, quelle.dateiname)],
    ['date', text(meta.jahr)],
    ['eprint', text(archiv)],
    // spur speichert DOIs klein; arXiv schreibt seine DOIs als 10.48550/arXiv.<id>.
    ['doi', ohneKlammern(quelle.doi?.replace(ARXIV_DOI, '10.48550/arXiv.'))],
  ])
}

export function bibEintrag(key, quelle) {
  if (quelle.art === 'web') return webEintrag(key, quelle)
  // Eine DOI, die Crossref nicht kennt, kommt nicht in die .bib: Der Eintrag bleibt @misc mit den Ersatzangaben.
  const ohneRegister = !quelle.doi || quelle.metadaten === 'unvollstaendig'
  if (ohneRegister && OHNE_DOI[quelle.meta?.art]) return ohneDoiEintrag(key, quelle)
  const meta = quelle.meta?.gefunden ? quelle.meta : {}
  const form = formVon(quelle.doi, meta)
  if (form === PREPRINT) return preprintEintrag(key, quelle, meta)
  return alsBib(form.typ, key, [
    ['author', autorenFeld(meta)],
    ['title', titelFeld(meta, quelle.dateiname)],
    [form.behaelter, form.behaelter && text(meta.journal)],
    ['publisher', form.verlag && text(meta.verlag)],
    ['year', text(meta.jahr)],
    ['volume', text(meta.band)],
    ['number', text(meta.heft)],
    // biblatex-apa setzt die Artikelnummer aus eid an die Stelle der Seiten (Testreferenz 10.1:6).
    ['eid', text(meta.artikelnummer)],
    ['pages', !meta.artikelnummer && meta.seiten && text(meta.seiten).replace('-', '--')],
    ['doi', ohneKlammern(quelle.doi)],
  ])
}
