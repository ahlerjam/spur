import { describe, expect, it } from 'vitest'
import {
  latexZuText,
  makrosErkennen,
  makrosWirksam,
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
    const zeilen = zitateFinden(String.raw`\meincite{a} \foreignquote{de}{X} \enquote{nur so}`)
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

describe('makrosErkennen', () => {
  it.each([
    [String.raw`\newcommand{\zitat}[1]{\enquote{#1}}`, ['zitat']],
    [String.raw`\newcommand*{\zitat}[1]{\textquote{#1}}`, ['zitat']],
    [String.raw`\renewcommand\zit[1]{\blockquote{#1}}`, ['zit']],
    [String.raw`\providecommand{\qq}[1]{„#1“}`, ['qq']],
    ["\\def\\qq#1{``#1''}", ['qq']],
    [String.raw`\NewDocumentCommand{\qq}{m}{\enquote{#1}}`, ['qq']],
    [String.raw`\newcommand{\fett}[1]{\textbf{#1}}`, []],
  ])('erkennt Zitatmakros in %s', (text, zitat) => {
    expect(makrosErkennen([text]).zitat).toEqual(zitat)
  })

  it('erkennt leer definierte Makros als ausgeblendet, nicht aber sichtbare', () => {
    expect(makrosErkennen([String.raw`\newcommand{\note}[1]{}`]).ausgeblendet).toEqual(['note'])
    expect(makrosErkennen([String.raw`\newcommand{\note}[1]{ }`]).ausgeblendet).toEqual(['note'])
    expect(makrosErkennen([String.raw`\newcommand{\note}[1]{\textcolor{red}{#1}}`]).ausgeblendet).toEqual([])
    expect(makrosErkennen([String.raw`\def\note#1{}`]).ausgeblendet).toEqual(['note'])
  })

  it('blendet leere Makros ohne Argument nicht aus: Die Klammer danach ist Text', () => {
    for (const text of [String.raw`\newcommand{\leer}{}`, String.raw`\def\leer{}`, String.raw`\NewDocumentCommand{\leer}{}{}`]) {
      expect(makrosErkennen([text]).ausgeblendet, text).toEqual([])
    }
  })

  it('blendet Beamer-Notizen nur ohne show notes aus', () => {
    const ohne = String.raw`\documentclass[11pt]{beamer}
\begin{document}`
    const mit = String.raw`\documentclass{beamer}
\setbeameroption{show notes}
\begin{document}`
    expect(makrosErkennen([ohne]).ausgeblendet).toEqual(['note'])
    expect(makrosErkennen([mit]).ausgeblendet).toEqual([])
    expect(makrosErkennen([String.raw`\documentclass{beamer}\setbeameroption{show notes on second screen=right}`]).ausgeblendet).toEqual([])
    expect(makrosErkennen([String.raw`\documentclass{article}`]).ausgeblendet).toEqual([])
  })

  it('braucht für lange Leerraum-Folgen ohne Rumpf keine quadratische Zeit', () => {
    const start = Date.now()
    makrosErkennen([`\\newcommand\\a${' '.repeat(80000)}x`, `\\NewDocumentCommand\\b${' '.repeat(80000)}x`])
    expect(Date.now() - start).toBeLessThan(500)
  })

  it('übersieht auskommentierte Definitionen', () => {
    expect(makrosErkennen(['% \\newcommand{\\zitat}[1]{\\enquote{#1}}']).zitat).toEqual([])
  })
})

describe('makrosWirksam', () => {
  it('lässt die Einstellung vor der Erkennung gelten', () => {
    const erkannt = { zitat: ['zitat', 'zwei'], ausgeblendet: ['note'] }
    expect(makrosWirksam(erkannt, { zitat: ['wort', 'note'], ausgeblendet: ['zwei'] })).toEqual({
      zitat: ['note', 'wort', 'zitat'],
      ausgeblendet: ['zwei'],
    })
  })
})

describe('zitateFinden mit Makros', () => {
  const makros = { zitat: ['zitat'], ausgeblendet: ['note'] }

  it('liest eigene Zitatmakros wie enquote', () => {
    const [z] = zitateFinden(String.raw`\zitat{Sleep supports.} \autocite[347]{smith2024}`, makros)
    expect(z).toMatchObject({ roh: 'Sleep supports.', belege: [{ befehl: 'autocite', key: 'smith2024', seite: '347' }] })
  })

  it('kennzeichnet Zitate in ausgeblendeten Makros und in \\iffalse … \\fi', () => {
    const text = String.raw`\enquote{A.} \autocite{smith2024}
\note{\enquote{Erfunden.} \autocite{brown2005}}
\note[item]{\parencite{x}}
\iffalse \parencite{wider2023} \fi
\iftrue \parencite{sichtbar} \fi
\parencite{danach}`
    const zeilen = zitateFinden(text, makros)
    expect(zeilen.map(z => [z.belege[0]?.key, Boolean(z.ausgeblendet)])).toEqual([
      ['smith2024', false],
      ['brown2005', true],
      ['x', true],
      ['wider2023', true],
      ['sichtbar', false],
      ['danach', false],
    ])
  })

  it('blendet bis zum passenden \\fi aus, auch mit inneren Bedingungen', () => {
    const text = String.raw`\iffalse \ifdefined\x \parencite{a} \fi \parencite{b} \fi \parencite{c}`
    expect(zitateFinden(text, makros).map(z => [z.belege[0].key, Boolean(z.ausgeblendet)])).toEqual([
      ['a', true],
      ['b', true],
      ['c', false],
    ])
  })
})

describe('\\iffalse mit \\else und Befehlen, die wie Bedingungen aussehen', () => {
  const sichtbarkeit = text => zitateFinden(text, { zitat: [], ausgeblendet: [] }).map(z => [z.belege[0].key, Boolean(z.ausgeblendet)])

  it('blendet nur den \\iffalse-Zweig aus, nicht den \\else-Zweig', () => {
    expect(sichtbarkeit(String.raw`\iffalse \parencite{a} \else \parencite{b} \fi \parencite{c}`)).toEqual([
      ['a', true],
      ['b', false],
      ['c', false],
    ])
  })

  it('zählt \\iff, \\ifthenelse und \\newif nicht als Bedingung', () => {
    const text = String.raw`\newif\ifentwurf \iffalse $a \iff b$ \ifthenelse \parencite{a} \fi \parencite{b}`
    expect(sichtbarkeit(text)).toEqual([
      ['a', true],
      ['b', false],
    ])
  })
})

describe('Beamer-Notizen', () => {
  const RUMPF = String.raw`\begin{document}
\begin{frame}\note{\enquote{X.} \autocite{notiz}}\end{frame}
\end{document}`
  const keys = text => zitateFinden(text, makrosErkennen([text])).filter(z => !z.ausgeblendet).map(z => z.belege[0].key)

  it('zählt ein Zitat in \\note ohne show notes nicht', () => {
    expect(keys(`\\documentclass{beamer}\n${RUMPF}`)).toEqual([])
  })

  it('zählt es mit show notes', () => {
    expect(keys(`\\documentclass{beamer}\n\\setbeameroption{show notes}\n${RUMPF}`)).toEqual(['notiz'])
  })
})

describe('vorangestellter Beleg', () => {
  const SATZ = 'Sleep supports the consolidation of declarative memory.'
  const formen = zeilen => zeilen.map(z => [z.form, z.roh, z.belege.map(b => `${b.key}:${b.seite}`).join(',')])

  it.each([
    [String.raw`\textcite[S.~347]{smith2024} schreiben: \enquote{${SATZ}}`, 'enquote'],
    [String.raw`\Textcite[S.~347]{smith2024} schreiben: „${SATZ}“`, 'anfuehrung'],
    [String.raw`\citet[S.~347]{smith2024} schreiben \textquote{${SATZ}}`, 'textquote'],
    [String.raw`\citeauthor[S.~347]{smith2024} schreibt \enquote{${SATZ}}`, 'enquote'],
    [String.raw`\nptextcite[S.~347]{smith2024} schreibt \enquote{${SATZ}}`, 'enquote'],
  ])('verknüpft %s zu einer Zeile', (quelle, form) => {
    const zeilen = zitateFinden(quelle)
    expect(formen(zeilen)).toEqual([[form, SATZ, 'smith2024:S.~347']])
    expect(zeilen[0].von).toBe(0)
    expect(quelle.slice(zeilen[0].zitatVon, zeilen[0].zitatBis)).toBe(SATZ)
  })

  it('der echte Fall: \\textcite vor \\enquote ist kein Beleg ohne Wortlaut', () => {
    const quelle = String.raw`\textcite[S.~4]{oldemeyer2025} beschreiben dies als \enquote{eine Daueraufgabe}.`
    expect(formen(zitateFinden(quelle))).toEqual([['enquote', 'eine Daueraufgabe', 'oldemeyer2025:S.~4']])
  })

  it('nimmt die Seite aus einem nachfolgenden Beleg mit demselben Key', () => {
    const quelle = String.raw`\textcite{smith2024} schreiben: \enquote{${SATZ}} \parencite[S.~347]{smith2024}`
    const zeilen = zitateFinden(quelle)
    expect(formen(zeilen)).toEqual([['enquote', SATZ, 'smith2024:S.~347']])
    expect([zeilen[0].von, zeilen[0].bis]).toEqual([0, quelle.length])
  })

  it('behält die Seite des vorangestellten Belegs, wenn der nachfolgende keine nennt', () => {
    const quelle = String.raw`\textcite[S.~347]{smith2024} schreiben: \enquote{${SATZ}} \parencite{smith2024}`
    expect(formen(zitateFinden(quelle))).toEqual([['enquote', SATZ, 'smith2024:S.~347']])
  })

  it('lässt ein \\textcite, das ein eigenes Zitat einleitet, nicht als Beleg des vorigen Zitats gelten', () => {
    for (const trenner of ['\n', '. ', ' und ']) {
      const quelle = String.raw`\textcite[S.~347]{smith2024} schreiben: \enquote{${SATZ}}${trenner}\textcite[S.~9]{jones2023} schreiben: \enquote{Erfunden.}`
      expect(formen(zitateFinden(quelle))).toEqual([
        ['enquote', SATZ, 'smith2024:S.~347'],
        ['enquote', 'Erfunden.', 'jones2023:S.~9'],
      ])
    }
    const nachgestellt = String.raw`\enquote{${SATZ}} \textcite[S.~347]{smith2024}. Danach mehr.`
    expect(formen(zitateFinden(nachgestellt))).toEqual([['enquote', SATZ, 'smith2024:S.~347']])
  })

  it('nimmt die Seite aus einem reinen (S.~x) nach dem Zitat', () => {
    const quelle = String.raw`\textcite{smith2024} schreiben: \enquote{${SATZ}} (S.~347).`
    const zeilen = zitateFinden(quelle)
    expect(formen(zeilen)).toEqual([['enquote', SATZ, 'smith2024:S.~347']])
    expect(quelle.slice(zeilen[0].von, zeilen[0].bis)).toBe(quelle.slice(0, -1))
  })

  it('verknüpft nicht über ein Satzende oder einen Absatz hinweg', () => {
    for (const trenner of ['zeigt das. ', 'zeigt das!\n', 'zeigt das\n\n']) {
      const quelle = String.raw`\textcite[S.~347]{smith2024} ${trenner}\enquote{${SATZ}}`
      expect(formen(zitateFinden(quelle))).toEqual([['beleg', '', 'smith2024:S.~347']])
    }
  })

  it('verknüpft nicht über mehr als 300 Zeichen', () => {
    const quelle = String.raw`\textcite[S.~347]{smith2024} ${'und '.repeat(80)}\enquote{${SATZ}}`
    expect(formen(zitateFinden(quelle))).toEqual([['beleg', '', 'smith2024:S.~347']])
  })

  it('lässt einen nachfolgenden Beleg mit anderem Key gelten', () => {
    const quelle = String.raw`\textcite[S.~347]{smith2024} zitieren \enquote{${SATZ}} \parencite[S.~9]{jones2023}`
    expect(formen(zitateFinden(quelle))).toEqual([
      ['beleg', '', 'smith2024:S.~347'],
      ['enquote', SATZ, 'jones2023:S.~9'],
    ])
  })

  it('nimmt keinen Beleg aus dem nächsten Absatz', () => {
    const quelle = String.raw`\textcite[S.~347]{smith2024} schreiben: \enquote{Erfunden.}` + '\n\n' + String.raw`\textcite[S.~347]{smith2024} zeigt das. \enquote{${SATZ}}`
    expect(formen(zitateFinden(quelle))).toEqual([
      ['enquote', 'Erfunden.', 'smith2024:S.~347'],
      ['beleg', '', 'smith2024:S.~347'],
    ])
    expect(formen(zitateFinden(String.raw`\enquote{${SATZ}}` + '\n\n' + String.raw`\parencite[1]{a}`))).toEqual([['beleg', '', 'a:1']])
  })

  it('übersteht leere Keys vor und nach dem Zitat', () => {
    const zeilen = zitateFinden(String.raw`\textcite{} schreiben \enquote{X} \textcite{} sagt \enquote{Y}`)
    expect(zeilen.every(z => z.belege.length === 0)).toBe(true)
  })

  it('verknüpft nur mit Autor-im-Satz-Befehlen', () => {
    const quelle = String.raw`\parencite[S.~347]{smith2024} \enquote{${SATZ}}`
    expect(formen(zitateFinden(quelle))).toEqual([['beleg', '', 'smith2024:S.~347']])
  })
})

describe('Zitiervarianten', () => {
  const belege = quelle => zitateFinden(quelle).map(z => [z.form, z.belege.map(b => `${b.befehl}:${b.key}:${b.seite}`)])

  it.each(['Parencite', 'Textcite', 'Autocite', 'Cite', 'Citet', 'Citep', 'citeauthor', 'citeyear', 'citeyearpar', 'citetitle', 'citealp', 'citealt', 'smartcite', 'supercite', 'fullcite', 'footfullcite', 'nptextcite'])(
    'erkennt \\%s als Beleg',
    befehl => {
      expect(belege(`\\${befehl}[S.~3]{smith2024}`)).toEqual([['beleg', [`${befehl}:smith2024:S.~3`]]])
      expect(belege(`\\${befehl}*{smith2024}`)).toEqual([['beleg', [`${befehl}:smith2024:`]]])
    }
  )

  it('liest Mehrfachformen als je eigenen Beleg mit Seite', () => {
    expect(belege(String.raw`\parencites[12]{smith2024}[34]{jones2023}.`)).toEqual([['beleg', ['parencites:smith2024:12', 'parencites:jones2023:34']]])
    expect(belege(String.raw`\textcites[vgl.][5]{a}{b,c}`)).toEqual([['beleg', ['textcites:a:5', 'textcites:b:', 'textcites:c:']]])
  })

  it('liest bei Mehrfachformen nur direkt anschließende Paare', () => {
    expect(belege(String.raw`\parencites{a}{b} {\bfseries Text}`)).toEqual([['beleg', ['parencites:a:', 'parencites:b:']]])
  })

  it('liest alle Keys eines Belegs', () => {
    expect(belege(String.raw`\parencite{smith2024,jones2023, fake2020}`)).toEqual([['beleg', ['parencite:smith2024:', 'parencite:jones2023:', 'parencite:fake2020:']]])
  })

  it('lässt unbekannte Befehle und \\nocite wie bisher', () => {
    expect(zitateFinden(String.raw`\meincite{smith2024} \nocite{*}`).map(z => [z.form, z.befehl])).toEqual([['unbekannt', 'meincite']])
  })
})
