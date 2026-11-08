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

  it('lässt Mathe aus', () => {
    const text = String.raw`Mit $n = 30$ und \(p < 0.05\) gilt \[x^2 + 1\] sowie
\begin{equation}
  y = 2x + 3
\end{equation}
und $$z=4$$.`
    expect(zahlenOhneBeleg(text)).toEqual([])
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
