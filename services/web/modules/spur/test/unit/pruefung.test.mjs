import { describe, expect, it } from 'vitest'
import {
  latexZuText,
  seiteAusBeleg,
  zitateFinden,
  zitierpaket,
} from '../../app/src/pruefung/latex.mjs'
import { normalisieren, wortlautPruefen } from '../../app/src/pruefung/wortlaut.mjs'
import { doiNormal } from '../../app/src/pruefung/bib.mjs'

const SEITE = 'Sleep supports the consolidation of declarative memory. Later text.'

describe('zitateFinden', () => {
  it('verbindet enquote und folgenden Beleg', () => {
    const [z] = zitateFinden(String.raw`\enquote{Sleep supports.} \autocite[347]{smith2024}`)
    expect(z.form).toBe('enquote')
    expect(z.roh).toBe('Sleep supports.')
    expect(z.belege).toEqual([{ befehl: 'autocite', key: 'smith2024', seite: '347' }])
  })

  it.each([
    [String.raw`\textquote[\autocite[1]{a}]{X}`, 'textquote'],
    [String.raw`\blockquote[\citep{a}]{X}`, 'blockquote'],
    [String.raw`\textcquote[1]{a}{X}`, 'textcquote'],
    [String.raw`„X“ \parencite{a}`, 'anfuehrung'],
    ['\\begin{quote}X \\footcite{a}\n\\end{quote}', 'quote'],
    ['\\begin{quote}X\n\\end{quote} \\textcite{a}', 'quote'],
  ])('erkennt %s', (quelle, form) => {
    const zeilen = zitateFinden(quelle)
    expect(zeilen).toHaveLength(1)
    expect(zeilen[0].form).toBe(form)
    expect(zeilen[0].roh.trim()).toBe('X')
    expect(zeilen[0].belege[0].key).toBe('a')
  })

  it('ignoriert Kommentare und Verbatim', () => {
    const quelle = '% \\cite{a}\n\\begin{verbatim}\\cite{b}\\end{verbatim}\n\\cite{c}'
    expect(zitateFinden(quelle).map(z => z.belege[0].key)).toEqual(['c'])
  })

  it('meldet fremde Formen als unbekannt und übergeht reine Anführungen', () => {
    const zeilen = zitateFinden(String.raw`\footfullcite{a} \foreignquote{de}{X} \enquote{nur so}`)
    expect(zeilen.map(z => z.form)).toEqual(['unbekannt', 'unbekannt'])
  })

  it('meldet \\textquote ohne Schlüssel als nicht prüfbar', () => {
    const zeilen = zitateFinden(String.raw`\textquote{Ohne Beleg.} und \blockquote{Auch ohne.}`)
    expect(zeilen.map(z => [z.form, z.befehl])).toEqual([
      ['unbekannt', 'textquote'],
      ['unbekannt', 'blockquote'],
    ])
  })

  it('überspringt Literaturbefehle und liest Positionen', () => {
    const quelle = String.raw`ab \bibliography{x} \cite{k}`
    const [z] = zitateFinden(quelle)
    expect(quelle.slice(z.von, z.bis)).toBe(String.raw`\cite{k}`)
  })
})

describe('Laufzeit', () => {
  it('parst ein 2-MB-Dokument und schreibt die Zeit ins Protokoll', () => {
    const absatz = String.raw`Text mit \enquote{einem Zitat} \autocite[12]{k} und % Kommentar
\section{Abschnitt}
`
    const dokument = absatz.repeat(Math.ceil((2 * 1024 * 1024) / absatz.length))
    const start = performance.now()
    const zeilen = zitateFinden(dokument)
    const dauer = Math.round(performance.now() - start)
    console.log(`Parser: ${dokument.length} Zeichen in ${dauer} ms, ${zeilen.length} Zitate`)
    expect(zeilen.length).toBeGreaterThan(1000)
    expect(dauer).toBeLessThan(10000)
  })
})

describe('zitierpaket und Seite', () => {
  it('erkennt das Paket', () => {
    expect(zitierpaket(String.raw`\usepackage[style=apa]{biblatex}`)).toBe('biblatex')
    expect(zitierpaket(String.raw`\usepackage{natbib}`)).toBe('natbib')
    expect(zitierpaket('')).toBe(null)
  })
  it('liest die Seite', () => {
    expect(seiteAusBeleg('S.~347')).toBe('347')
    expect(seiteAusBeleg('')).toBe(null)
  })
})

describe('wortlautPruefen', () => {
  const pruefen = (roh, seiten = [SEITE]) => wortlautPruefen(latexZuText(roh), seiten)

  it('findet den exakten Satz samt Seite', () => {
    const r = pruefen('Sleep supports the consolidation of declarative memory.', ['x', SEITE])
    expect(r).toEqual({ wortlaut: 'exakt', seiten: [1] })
  })
  it('meldet Abweichungen', () => {
    expect(pruefen('Rest supports the consolidation').wortlaut).toBe('abweichend')
  })
  it('prüft Auslassungen segmentweise und in Reihenfolge', () => {
    expect(pruefen('Sleep supports […] declarative memory.').wortlaut).toBe('exakt')
    expect(pruefen(String.raw`Sleep supports \textelp{} declarative memory.`).wortlaut).toBe('exakt')
    expect(pruefen('declarative memory […] Sleep supports').wortlaut).toBe('abweichend')
    expect(pruefen('Sleep really supports […] memory.').wortlaut).toBe('abweichend')
  })
  it('akzeptiert sic und geänderte Anfangsbuchstaben', () => {
    expect(pruefen('[s]leep supports').wortlaut).toBe('exakt')
    expect(pruefen('Sleep [sic] supports').wortlaut).toBe('exakt')
  })
  it('toleriert Zeilentrennung', () => {
    expect(pruefen('the hippocampus replays', ['the hippo-\ncampus replays']).wortlaut).toBe('trennung')
    expect(pruefen('a well-known fact', ['a well-\nknown fact']).wortlaut).toBe('trennung')
  })
  it('normalisiert Ligaturen, Anführungszeichen, Bindestriche und Leerraum', () => {
    expect(normalisieren('ﬁ “x”  –\n y')).toBe('fi "x" - y')
    expect(pruefen('fine "x"', ['ﬁne “x”']).wortlaut).toBe('exakt')
  })
  it('meldet nicht prüfbar bei U+FFFD oder fehlendem Text', () => {
    expect(pruefen('x', ['a\uFFFDb']).wortlaut).toBe('nicht_pruefbar')
    expect(pruefen('x', ['', '']).wortlaut).toBe('nicht_pruefbar')
    expect(pruefen('x', []).wortlaut).toBe('nicht_pruefbar')
  })
})

describe('zeileBewerten', () => {
  it('meldet leere Belege als nicht prüfbar statt abzustürzen', async () => {
    const { zeileBewerten } = await import('../../app/src/pruefung/bewertung.mjs')
    const kontext = { bibEintraege: new Map(), quellen: [], seitenJeQuelle: new Map(), werke: new Map() }
    const zeilen = zitateFinden(String.raw`\enquote{x} \cite{} \autocite[12]{,}`)
    expect(zeilen.map(z => zeileBewerten(z, kontext).wortlaut)).toEqual(
      zeilen.map(() => 'nicht_pruefbar')
    )
  })
})

describe('doiNormal', () => {
  it('macht aus URL und Präfix die nackte DOI', () => {
    expect(doiNormal(' https://doi.org/10.1234/abc ')).toBe('10.1234/abc')
    expect(doiNormal('http://dx.doi.org/10.1/x')).toBe('10.1/x')
    expect(doiNormal('doi: 10.5/y')).toBe('10.5/y')
    expect(doiNormal('10.5555/spur')).toBe('10.5555/spur')
    expect(doiNormal('  ')).toBeNull()
  })
})
