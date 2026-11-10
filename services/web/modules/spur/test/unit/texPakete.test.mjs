import { beforeEach, describe, expect, it, vi } from 'vitest'

let T

beforeEach(async () => {
  vi.resetModules()
  T = await import('../../app/src/kompilieren/texArchiv.mjs')
})

const code = fn => {
  try {
    fn()
  } catch (error) {
    return error.code
  }
  return null
}

describe('Paketname', () => {
  it('nimmt TeX-Live-Namen an', () => {
    for (const name of ['xfrac', 'beamertheme-focus', 'l3kernel', 'pgf-blur', 'babel-german']) {
      expect(code(() => T.paketNamePruefen(name))).toBe(null)
    }
  })

  it('lehnt Pfade, Leerzeichen und Punkte ab', () => {
    for (const name of ['../x', 'a b', 'x/y', '', '.hidden', 'a..b', 'x.ARCH', 'a'.repeat(101)]) {
      expect(code(() => T.paketNamePruefen(name))).toBe('eingabe_ungueltig')
    }
  })
})

describe('Archivinhalt', () => {
  const zeile = (typ, groesse, pfad) => `${typ}rw-r--r-- root/root ${String(groesse).padStart(9)} 2026-03-01 10:00 ${pfad}`

  it('liefert reguläre Dateien mit Größe, Ordner zählen nicht', () => {
    const liste = [zeile('d', 0, 'tex/latex/foo/'), zeile('-', 1234, 'tex/latex/foo/foo.sty'), zeile('-', 10, 'tlpkg/tlpobj/foo.tlpobj')].join('\n')
    expect(T.eintraegePruefen(liste)).toEqual([
      { pfad: 'tex/latex/foo/foo.sty', groesse: 1234 },
      { pfad: 'tlpkg/tlpobj/foo.tlpobj', groesse: 10 },
    ])
  })

  it('lehnt Ausbrüche, absolute Pfade und Links ab', () => {
    for (const boese of [
      zeile('-', 1, '../../etc/x'),
      zeile('-', 1, 'tex/../../x'),
      zeile('-', 1, '/etc/passwd'),
      `lrwxrwxrwx root/root 0 2026-03-01 10:00 tex/a.sty -> /etc/passwd`,
      `hrw-r--r-- root/root 0 2026-03-01 10:00 tex/b.sty link to tex/a.sty`,
    ]) {
      expect(code(() => T.eintraegePruefen(boese))).toBe('archiv_unsicher')
    }
  })
})

describe('Laufzeitdateien', () => {
  it('nimmt nur Laufzeit- und Schriftdateien, flach unter dem Paketnamen', () => {
    const eintraege = [
      { pfad: 'tex/latex/foo/foo.sty', groesse: 1 },
      { pfad: 'tex/latex/foo/foo.cls', groesse: 1 },
      { pfad: 'bibtex/bst/foo/foo.bst', groesse: 1 },
      { pfad: 'fonts/type1/public/foo/foo.pfb', groesse: 1 },
      { pfad: 'fonts/tfm/public/foo/foo.tfm', groesse: 1 },
      { pfad: 'tex/latex/foo/README.md', groesse: 1 },
      { pfad: 'scripts/foo/foo.pl', groesse: 1 },
      { pfad: 'tlpkg/tlpobj/foo.tlpobj', groesse: 1 },
      { pfad: 'tex/latex/foo/sub/foo.sty', groesse: 1 },
    ]
    expect(T.laufzeitDateien(eintraege).map(d => [d.pfad, d.name])).toEqual([
      ['tex/latex/foo/foo.sty', 'foo.sty'],
      ['tex/latex/foo/foo.cls', 'foo.cls'],
      ['bibtex/bst/foo/foo.bst', 'foo.bst'],
      ['fonts/type1/public/foo/foo.pfb', 'foo.pfb'],
      ['fonts/tfm/public/foo/foo.tfm', 'foo.tfm'],
    ])
  })
})

describe('Paketdatenbank', () => {
  const TLPDB = `name 00texlive.config
depend opt_location:https://mirror.example.org/systems/texlive/tlnet

name beamer
revision 1
depend pgf
depend xcolor

name collection-basic
depend amsfonts

name xcolor
`

  it('kennt die installierten Pakete und den Spiegel', () => {
    const { namen, spiegel } = T.datenbankLesen(TLPDB)
    expect(namen.has('beamer')).toBe(true)
    expect(namen.has('xcolor')).toBe(true)
    expect(namen.has('xfrac')).toBe(false)
    expect(spiegel).toBe('https://mirror.example.org/systems/texlive/tlnet')
  })

  it('nennt Abhängigkeiten ohne Architektur-Pakete', () => {
    expect(T.abhaengigkeiten('name foo\ndepend bar\ndepend foo.ARCH\ndepend baz\nrunfiles size=1\n')).toEqual(['bar', 'baz'])
  })

  it('fällt ohne Eintrag auf mirror.ctan.org zurück', () => {
    expect(T.datenbankLesen('name beamer\n').spiegel).toBe('https://mirror.ctan.org/systems/texlive/tlnet')
  })
})

describe('latexmkrc', () => {
  it('legt den Suchpfad für alle Pakete an, ohne Paketnamen', () => {
    expect(T.LATEXMKRC_BLOCK).toContain("'TEXINPUTS'")
    expect(T.LATEXMKRC_BLOCK).toContain("ensure_path($var, './tex-pakete//')")
    expect(T.latexmkrcErgaenzen('')).toBe(T.LATEXMKRC_BLOCK)
  })

  it('hängt den Block an eine eigene latexmkrc an, nur einmal', () => {
    const eigen = "$pdf_mode = 1;\n"
    const neu = T.latexmkrcErgaenzen(eigen)
    expect(neu.startsWith(eigen)).toBe(true)
    expect(neu).toContain(T.LATEXMKRC_BLOCK)
    expect(T.latexmkrcErgaenzen(neu)).toBe(null)
  })
})
