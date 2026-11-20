import { describe, expect, it } from 'vitest'
import { fehlendeDateien } from '../../app/src/kompilieren/fehlendeDateien.mjs'

// Auszüge aus echten pdfTeX-Logs (TeX Live 2026, max_print_line 79).
const BOOKTABS = String.raw`(./main.tex
LaTeX2e <2026-11-01>

! LaTeX Error: File ${'`'}booktabs.sty' not found.

Type X to quit or <RETURN> to proceed,
or enter new name. (Default extension: sty)

Enter file name:
! Emergency stop.
<read *> `

const APA7 = String.raw`**apa7-arbeit.tex
(./apa7-arbeit.tex
LaTeX2e <2026-11-01>
L3 programming layer <2026-09-09>

! LaTeX Error: File ${'`'}apa7.cls' not found.

Type X to quit or <RETURN> to proceed,
or enter new name. (Default extension: cls)`

const BIBLATEX = String.raw`(/usr/local/texlive/2026/texmf-dist/tex/latex/biblatex/blx-case-expl3.sty)

! Package biblatex Error: Style 'apa' not found.

See the biblatex package documentation for explanation.
Type  H <return>  for immediate help.`

const FONT = '! Font T1/lmr/m/n/10=ec-lmr10 at 10.0pt not loadable: Metric (TFM) file not found.\n<to be read again> \n                   relax '

describe('fehlendeDateien', () => {
  it('liest fehlende .sty und .cls aus „File … not found“', () => {
    expect(fehlendeDateien(BOOKTABS)).toEqual(['booktabs.sty'])
    expect(fehlendeDateien(APA7)).toEqual(['apa7.cls'])
  })

  it('macht aus einem fehlenden biblatex-Stil die .bbx-Datei', () => {
    expect(fehlendeDateien(BIBLATEX)).toEqual(['apa.bbx'])
    expect(fehlendeDateien("! Package biblatex Error: Citation style 'verbose-x' not found.")).toEqual(['verbose-x.cbx'])
    expect(fehlendeDateien("! Package biblatex Error: Bibliography style 'apa6' not found.")).toEqual(['apa6.bbx'])
  })

  it('macht aus einem nicht ladbaren Font die .tfm-Datei, auch umbrochen nach 79 Zeichen', () => {
    expect(fehlendeDateien(FONT)).toEqual(['ec-lmr10.tfm'])
    const umbrochen = `${FONT.split('\n')[0].slice(0, 79)}\n${FONT.split('\n')[0].slice(79)}`
    expect(fehlendeDateien(umbrochen)).toEqual(['ec-lmr10.tfm'])
    expect(fehlendeDateien('! Font \\x=cmr17 scaled 1200 not loadable: Metric (TFM) file not found.')).toEqual(['cmr17.tfm'])
  })

  it('nennt auch .bst und .def und jede Datei nur einmal, in der Reihenfolge des Logs', () => {
    const log = "! LaTeX Error: File `apalike2.bst' not found.\n! LaTeX Error: File `hpdftex.def' not found.\n! LaTeX Error: File `apalike2.bst' not found."
    expect(fehlendeDateien(log)).toEqual(['apalike2.bst', 'hpdftex.def'])
  })

  it('ergibt [] für ein Log ohne fehlende Datei und zählt andere Fehler nicht', () => {
    expect(fehlendeDateien('! Undefined control sequence.\nl.5 \\kaputtesmakro')).toEqual([])
    expect(fehlendeDateien("! LaTeX Error: Unknown option `kaputt' for package `xcolor'.")).toEqual([])
    expect(fehlendeDateien("Package biblatex Info: ... file 'biblatex-dm.cfg' not found.")).toEqual([])
    expect(fehlendeDateien('')).toEqual([])
  })
})
