import { describe, expect, it } from 'vitest'
import { zahlenOhneBeleg } from '../../app/src/schreiben/zahlen.mjs'

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
