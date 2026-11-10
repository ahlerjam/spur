// Reine Prüfungen für tex_package_add: Paketname, Archivinhalt, Laufzeitdateien, Paketdatenbank, latexmkrc.
import Path from 'node:path'
import { WerkzeugFehler } from '../mcp/fehler.mjs'

export const ORDNER = 'tex-pakete'
const FALLBACK_SPIEGEL = 'https://mirror.ctan.org/systems/texlive/tlnet'
const ENDUNGEN = new Set([
  '.sty', '.cls', '.def', '.cfg', '.fd', '.ldf', '.clo', '.bst', '.tex', '.lua',
  '.pfb', '.tfm', '.vf', '.map', '.enc', '.otf', '.ttf',
])
const SICHERER_DATEINAME = /^[A-Za-z0-9][A-Za-z0-9._+-]*$/

// Fester Text: die latexmkrc ist Perl und läuft auf dem Server, darum steht kein Paketname darin.
export const LATEXMKRC_BLOCK = `# spur: TeX-Pakete aus tex-pakete/ (tex_package_add)
foreach my $var ('TEXINPUTS', 'BSTINPUTS', 'TFMFONTS', 'T1FONTS', 'VFFONTS', 'ENCFONTS', 'TEXFONTMAPS', 'OPENTYPEFONTS', 'TTFONTS', 'LUAINPUTS') {
  ensure_path($var, './${ORDNER}//');
}
`

export function paketNamePruefen(name) {
  if (!/^[a-z0-9][a-z0-9_-]*$/i.test(name) || name.length > 100) {
    throw new WerkzeugFehler('eingabe_ungueltig', 'spur_fehler_tex_paket_name')
  }
}

// Ausgabe von `tar -tvJf`: nur reguläre Dateien und Ordner, keine Links, keine Pfade aus dem Archiv hinaus.
export function eintraegePruefen(liste) {
  const eintraege = []
  for (const zeile of liste.split('\n').filter(Boolean)) {
    const treffer = /^(\S)\S*\s+\S+\s+(\d+)\s+\S+\s+\S+\s(.*)$/.exec(zeile)
    const [, typ, groesse, pfad] = treffer ?? []
    const unsicher =
      !treffer || !['-', 'd'].includes(typ) || pfad.startsWith('/') || pfad.split('/').includes('..')
    if (unsicher) throw new WerkzeugFehler('archiv_unsicher', 'spur_fehler_tex_paket_archiv')
    if (typ === '-') eintraege.push({ pfad, groesse: Number(groesse) })
  }
  return eintraege
}

export function laufzeitDateien(eintraege) {
  const gesehen = new Set()
  return eintraege
    .filter(e => /^(tex|fonts|bibtex)\//.test(e.pfad))
    .map(e => ({ ...e, name: Path.posix.basename(e.pfad) }))
    .filter(e => ENDUNGEN.has(Path.posix.extname(e.name)) && SICHERER_DATEINAME.test(e.name))
    .filter(e => !gesehen.has(e.name) && gesehen.add(e.name))
}

export function datenbankLesen(text) {
  const namen = new Set([...text.matchAll(/^name (\S+)$/gm)].map(m => m[1]))
  const spiegel = /^depend opt_location:(\S+)$/m.exec(text)?.[1] ?? FALLBACK_SPIEGEL
  return { namen, spiegel }
}

export function abhaengigkeiten(tlpobj) {
  return [...tlpobj.matchAll(/^depend (\S+)$/gm)].map(m => m[1]).filter(n => !n.includes('.'))
}

// Ergänzter Inhalt oder null, wenn der Block schon drinsteht.
export function latexmkrcErgaenzen(text) {
  if (text.includes(LATEXMKRC_BLOCK)) return null
  if (!text) return LATEXMKRC_BLOCK
  return `${text}${text.endsWith('\n') ? '' : '\n'}${LATEXMKRC_BLOCK}`
}
