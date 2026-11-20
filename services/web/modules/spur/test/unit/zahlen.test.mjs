import { describe, expect, it } from 'vitest'
import { lageImDokument, zahlenOhneBeleg } from '../../app/src/schreiben/zahlen.mjs'

describe('zahlenOhneBeleg', () => {
  it('findet frei getippte Zahlen im Fließtext', () => {
    expect(zahlenOhneBeleg('Insgesamt nahmen 412 Personen teil, 37,5 % davon Frauen.')).toEqual(['412', '37,5'])
  })

  it('lässt Jahreszahlen, Seitenangaben und Belege aus', () => {
    const text = String.raw`Seit 2019 zeigen Studien \autocite[S.~12]{smith2024} auf Seite 5 und S. 7--9 sowie pp. 3 \citep[p.~4]{x}, dass es wirkt.`
    expect(zahlenOhneBeleg(text)).toEqual([])
  })

  it('lässt einzelne Ganzzahlen bis zwei Stellen in Formeln aus', () => {
    const text = String.raw`Mit $n = 30$ gilt \[x^2 + 1\] sowie
\begin{equation}
  y = 2x + 3
\end{equation}
und $$z=4$$ und $x_{12}$.`
    expect(zahlenOhneBeleg(text)).toEqual([])
  })

  it('meldet Dezimalzahlen und Zahlen ab drei Stellen in Formeln', () => {
    expect(zahlenOhneBeleg(String.raw`Volumen $V = 0{,}89\,\mathrm{L}$ und \(m = 75.7\) bei $N = 412$.`)).toEqual(['0,89', '75.7', '412'])
    expect(zahlenOhneBeleg(String.raw`\begin{align} p &< 0.05 \end{align}`)).toEqual(['0.05'])
  })

  it('meldet Werte in \\num, \\qty, \\SI und \\SIrange, nicht die Einheit', () => {
    const text = String.raw`\qty{75.7}{\percent}, \num{1234}, \SI{3}{\meter}, \SIrange{10}{20}{\celsius}, \qty[mode=text]{2.5}{\m^2}`
    expect(zahlenOhneBeleg(text)).toEqual(['75.7', '1234', '3', '10', '20', '2.5'])
  })

  it('lässt TikZ- und pgfplots-Umgebungen aus', () => {
    const text = String.raw`\begin{tikzpicture}
  \draw (0,0) -- (3.5,2.25);
  \fill[red!30] (1,1) circle (0.5);
  \begin{axis}[xmin=0, xmax=120]
    \addplot coordinates {(1,412) (2,513)};
  \end{axis}
\end{tikzpicture}`
    expect(zahlenOhneBeleg(text)).toEqual([])
  })

  it('lässt Farbangaben aus', () => {
    const text = String.raw`\definecolor{eon}{RGB}{234,28,10} \color{blue!40} Text in \textcolor{red!70!black}{rot} und \colorbox{gray!15}{grau}.`
    expect(zahlenOhneBeleg(text)).toEqual([])
  })

  it('lässt optionale Argumente in eckigen Klammern aus', () => {
    const text = String.raw`\documentclass[aspectratio=169,11pt]{beamer} \begin{frame}[t]{Titel} \includegraphics[width=0.8\textwidth]{a} \item[3)] Text\\[2pt] weiter`
    expect(zahlenOhneBeleg(text)).toEqual([])
  })

  it('meldet im echten Fall aus der Session nur die Rechenwerte', () => {
    const text = String.raw`\documentclass[aspectratio=169,11pt]{beamer}
\definecolor{eon}{RGB}{234,28,10}
\begin{document}
\begin{tikzpicture}
  \draw (0,0) -- (3.5,2.25);
  \fill[red!30] (0,0) rectangle (1,1);
\end{tikzpicture}
$V = 0{,}89\,\mathrm{L}$, \qty{75.7}{\percent} und $x^2$.
\end{document}`
    expect(zahlenOhneBeleg(text)).toEqual(['0,89', '75.7'])
  })

  it('lässt Werte in Formeln und \\qty aus, die in ergebnisse.tex stehen, auch mit anderem Dezimalzeichen', () => {
    expect(zahlenOhneBeleg(String.raw`\qty{75.7}{\percent} und $0{,}89$`, ['75,7'])).toEqual(['0,89'])
  })

  it('meldet eine im Fließtext getippte Zahl weiter, auch wenn ergebnisse.tex sie als Makro hat', () => {
    expect(zahlenOhneBeleg('Davon waren 412 Personen erwachsen.', ['412'])).toEqual(['412'])
  })

  it('lässt Makros aus ergebnisse.tex, Kommentare, Befehle und Wortbestandteile aus', () => {
    const text = String.raw`Es waren \nGesamt{} Personen % 412 im Kommentar
\section{Teil 2}\label{sec:2} \vspace{3mm} COVID-19 in 3D, H2O \ref{tab:1}
\newcommand{\nNeu}{17}`
    expect(zahlenOhneBeleg(text)).toEqual([])
  })

  it('nennt jede Zahl nur einmal', () => {
    expect(zahlenOhneBeleg('412 und noch einmal 412.')).toEqual(['412'])
  })
})

describe('Datum, Uhrzeit und Versionsnummern', () => {
  it.each([
    '12.11.2026',
    '12.11.26',
    'am 12.11. begann',
    '12. November 2026',
    '12. Nov. 2026',
    'November 12, 2026',
    '12 November 2026',
    '2026-11-12',
    '14:30',
    '14:30:05',
    '14:30 Uhr',
    'v2.0.1',
    'Version 1.2.3',
    'Version 4.2',
    'Version 7',
    'R 4.3.2',
    '9 Uhr',
    '9.30 Uhr',
    '9:30 Uhr',
    'Python 3.12',
    'R 4.3.1',
    'SPSS 29',
    'LaTeX2e',
    'Node 20',
  ])('meldet „%s“ nicht', text => {
    expect(zahlenOhneBeleg(`Erhoben ${text} im Labor.`)).toEqual([])
  })

  it.each([
    ['3.14', ['3.14']],
    ['12,5', ['12,5']],
    ['1.250', ['1.250']],
  ])('meldet %s weiter', (zahl, erwartet) => {
    expect(zahlenOhneBeleg(`Der Wert ist ${zahl} Einheiten.`)).toEqual(erwartet)
  })

  it.each(['12.5', '4.2'])('meldet die Dezimalzahl %s am Satzende', zahl => {
    expect(zahlenOhneBeleg(`Der Mittelwert liegt bei ${zahl}.`)).toEqual([zahl])
  })

  it('meldet Gruppennummern und Messwerte neben Uhrzeiten und Versionen', () => {
    expect(zahlenOhneBeleg('Gruppe 2 hatte 17 Teilnehmende.')).toContain('17')
    expect(zahlenOhneBeleg('Um 9 Uhr waren es 240 mit Python 3.12 und 3.14 Punkten.')).toEqual(['240', '3.14'])
  })

  it('meldet ganze Zahlen hinter mehrdeutigen Namen und über Zeilenumbrüche hinweg', () => {
    expect(zahlenOhneBeleg('Excel 5 Tabellen lagen vor.')).toEqual(['5'])
    expect(zahlenOhneBeleg('Julia 3 Probanden kamen.')).toEqual(['3'])
    expect(zahlenOhneBeleg('Linux 12 Server liefen.')).toEqual(['12'])
    expect(zahlenOhneBeleg('Gruppe SAS\n\n40 Fälle lagen vor.')).toEqual(['40'])
    expect(zahlenOhneBeleg('Excel 16.0 und Julia 1.10 liefen.')).toEqual([])
  })

  it('meldet im Satz aus der Spec nur die Messwerte', () => {
    expect(
      zahlenOhneBeleg('Die Erhebung fand am 12.11.2026 um 14:30 Uhr statt, ausgewertet mit Version 1.2.3 am 12. November 2026.')
    ).toEqual([])
    expect(zahlenOhneBeleg('Von 240 Befragten antworteten 37,5 Prozent am 12.11.2026.')).toEqual(['240', '37,5'])
  })
})

describe('Grafiken und Einstellungen (P14)', () => {
  const DOKUMENT = String.raw`\documentclass{article}
\usepackage{tikz}
\tikzset{box/.style={draw, minimum width=2.5cm, line width=0.4pt}}
\begin{document}
Text davor.
\begin{figure}
\begin{tikzpicture}
  \node[draw] (a) at (0,0) {Start};
  \draw[->] (a) -- (4.4,0);
\end{tikzpicture}
\end{figure}
\begin{align}
  y &= 2x
\end{align}
Text danach.
\end{document}`
  const an = teil => lageImDokument(DOKUMENT, DOKUMENT.indexOf(teil))

  it('erkennt die Lage im Dokument', () => {
    expect(an('(4.4,0)')).toBe('grafik')
    expect(an('line width=0.4pt')).toBe('praeambel')
    expect(an('y &= 2x')).toBe('mathe')
    expect(an('Text davor')).toBeNull()
    expect(an('Text danach')).toBeNull()
    const kapitel = 'Kapitel ohne Präambel \\begin{scope} x'
    expect(lageImDokument(kapitel, kapitel.indexOf(' x'))).toBe('grafik')
  })

  it('meldet die echten Fälle mitten in einer Grafik nicht', () => {
    for (const teil of ['0.4', '4.4,0', '(5.2,0.4)', String.raw`\node at (2,1) {Gruppe 75,7};`]) {
      expect(zahlenOhneBeleg(teil, [], 'grafik')).toEqual([])
    }
    expect(zahlenOhneBeleg('0.4')).toEqual(['0.4'])
  })

  it('meldet in der Präambel nichts', () => {
    expect(zahlenOhneBeleg('line width=0.6pt, Faktor 12,5', [], 'praeambel')).toEqual([])
  })

  it('wendet in einer Mathe-Umgebung die Formelregel auf das ganze Stück an', () => {
    expect(zahlenOhneBeleg('y &= 2x + 0.25 \\\\ z &= 412', [], 'mathe')).toEqual(['0.25', '412'])
    expect(zahlenOhneBeleg('y &= 0.25', ['0.25'], 'mathe')).toEqual([])
  })

  it('lässt Einstellungsbefehle mit verschachtelten Argumenten aus', () => {
    const text = String.raw`\tikzset{box/.style={draw, minimum width=2.5cm, line width=0.4pt}}
\tikzstyle{alt}=[draw, inner sep=3.5]
\pgfplotsset{compat=1.18, width=7.5}
\usetikzlibrary{arrows.meta}
\geometry{margin=2.5cm}
\hypersetup{pdfstartview={XYZ null null 1.25}}
\captionsetup{font=small, skip=6pt}
\setstretch{1.15} \linespread{1.3}
\rule{0.4}{1.2} \resizebox{0.9}{!}{x} \scalebox{0.75}{y}
\newlength{\abstand} \addtolength{\abstand}{1.5}`
    expect(zahlenOhneBeleg(text)).toEqual([])
  })

  it('lässt Spaltenangaben, Längen und Koordinaten in Zeichenbefehlen aus', () => {
    const text = String.raw`\begin{tabularx}{\textwidth}{p{0.3\textwidth}X}
\begin{tabular}{p{2.5cm}l} \begin{array}{p{1.5}c}
\includegraphics[width=0.8\textwidth]{abb} \vspace{0.5cm}
Breite 0.45\linewidth, Abstand 1.5\baselineskip, 0.3\columnwidth, 12pt, 3.5mm, 2em, 1ex, 10bp, 1in
\draw (1.5,2.25) -- (3.75,0.5);
  \fill (0.5,0.5) circle (2pt);
\addplot coordinates {(1.5,412)};`
    expect(zahlenOhneBeleg(text)).toEqual([])
  })

  it('braucht für lange Ziffernfolgen in Zeichenbefehlen keine quadratische Zeit', () => {
    const start = performance.now()
    zahlenOhneBeleg(`\\draw (${'1'.repeat(50000)}`)
    expect(performance.now() - start).toBeLessThan(500)
  })

  it('prüft den Inhalt von \\resizebox und \\scalebox weiter, nur die Größen nicht', () => {
    expect(zahlenOhneBeleg(String.raw`\resizebox{0.9\textwidth}{!}{Modell A & 87.3 \\}`)).toEqual(['87.3'])
    expect(zahlenOhneBeleg(String.raw`\scalebox{0.75}[0.8]{Wert 412}`)).toEqual(['412'])
  })

  it('liest keine Klammer aus dem nächsten Absatz als Argument einer Einstellung', () => {
    expect(zahlenOhneBeleg('\\setstretch{1.5}\n\n{\\small Die Stichprobe umfasst 1234 Personen.}')).toEqual(['1234'])
  })

  it('meldet Zahlen im Fließtext und in Tabellenzellen weiter', () => {
    expect(zahlenOhneBeleg('Die Genauigkeit stieg um 12,5 Prozent auf 0,89.')).toEqual(['12,5', '0,89'])
    expect(zahlenOhneBeleg('Gruppe A & 75,7 \\\\')).toEqual(['75,7'])
    expect(zahlenOhneBeleg('Die Pflanzen wuchsen 2,5 cm und (1,5, 2,5) Punkte.')).toEqual(['2,5', '1,5'])
  })
})
