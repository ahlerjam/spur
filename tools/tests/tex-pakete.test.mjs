// node --test tools/tests/tex-pakete.test.mjs
// Jedes Paket, das ein Smoke-Dokument lädt, muss im Image installiert sein (server-ce/Dockerfile-base).
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { DOKUMENTE } from '../../services/web/modules/spur/scripts/smoke-dokumente.mjs'

const lesen = pfad => readFileSync(new URL(`../../${pfad}`, import.meta.url), 'utf8')
const dockerfile = lesen('server-ce/Dockerfile-base')

// TeX-Live-Pakete aus scheme-basic (collection-basic, collection-latex), die die Smoke-Dokumente brauchen.
const IM_BASISSCHEMA = new Set(['amsfonts', 'amsmath', 'babel', 'etoolbox', 'fancyhdr', 'geometry', 'graphics', 'hyperref', 'latex', 'lm', 'psnfss', 'tools', 'url'])
// Ladename → TeX-Live-Paket, wo beide verschieden sind (Dateiliste der texlive.tlpdb).
const PAKET_VON = {
  article: 'latex', fontenc: 'latex', graphicx: 'graphics', array: 'tools', bm: 'tools', ftnright: 'tools',
  longtable: 'tools', tabularx: 'tools', subcaption: 'caption', tikz: 'pgf', flushend: 'sttools', lmodern: 'lm',
  mathptm: 'psnfss', pslatex: 'psnfss', times: 'psnfss', amssymb: 'amsfonts', algorithm: 'algorithms',
  algpseudocode: 'algorithmicx', scrextend: 'koma-script',
}
const SPRACHEN = { ngerman: ['babel-german', 'hyphen-german'], german: ['babel-german', 'hyphen-german'] }
// Was eine Klasse oder ein Paket selbst lädt und nicht als tlmgr-Abhängigkeit mitkommt. apa7: alle
// \RequirePackage und \LoadClass in apa7.cls (Modi man, stu, jou, doc); biblatex-apa lädt nur biblatex selbst.
// chemformula lädt xfrac.sty (Smoke nach P6: „Compile Folien“ scheiterte daran).
const NACHGELADEN = {
  apa7: [
    'apacite', 'array', 'article', 'babel', 'biblatex', 'bm', 'booktabs', 'caption', 'draftwatermark', 'endfloat',
    'etoolbox', 'fancyhdr', 'float', 'flushend', 'fontenc', 'ftnright', 'geometry', 'graphicx', 'hyperref', 'lmodern',
    'longtable', 'mathptm', 'pslatex', 'scalerel', 'substr', 'threeparttable', 'tikz', 'times', 'txfonts',
  ],
  'biblatex-apa': ['biblatex'],
  chemformula: ['chemgreek', 'xfrac'],
}

function installiert(text = dockerfile) {
  const teil = text.split('tlmgr install --repository ${TEXLIVE_MIRROR}')[1].split('&&')[0]
  return teil.split(/[\s\\]+/).filter(Boolean)
}

function benoetigt(tex) {
  const namen = []
  const laden = name => {
    const paket = PAKET_VON[name] ?? name
    if (namen.includes(paket)) return
    namen.push(paket)
    for (const n of NACHGELADEN[paket] ?? []) laden(n)
  }
  tex = tex.replace(/(?<!\\)%.*/g, '')
  for (const [, klasse] of tex.matchAll(/\\documentclass(?:\[[^\]]*\])?\{([^}]*)\}/g)) laden(klasse)
  for (const [, optionen = '', liste] of tex.matchAll(/\\usepackage(?:\[([^\]]*)\])?\{([^}]*)\}/g)) {
    const option = optionen.split(',').map(o => o.trim())
    for (const paket of liste.split(',').map(p => p.trim())) {
      laden(paket)
      if (paket === 'babel') option.flatMap(o => SPRACHEN[o] ?? []).forEach(laden)
      if (paket === 'biblatex' && option.includes('style=apa')) laden('biblatex-apa')
      if (paket === 'biblatex' && option.includes('backend=biber')) laden('biber')
    }
  }
  for (const [, thema] of tex.matchAll(/\\usetheme(?:\[[^\]]*\])?\{([^}]*)\}/g)) laden(`beamertheme-${thema}`)
  return namen
}

const fehlend = (tex, liste) => benoetigt(tex).filter(p => !liste.includes(p) && !IM_BASISSCHEMA.has(p))

test('jedes Paket der Smoke-Dokumente steht in der Paketliste des Images', () => {
  const liste = installiert()
  for (const { name, dateien } of DOKUMENTE) {
    assert.deepEqual(fehlend(dateien['main.tex'], liste), [], `${name}: fehlt im Image`)
  }
})

test('ohne booktabs in der Liste fehlt der APA-7-Arbeit genau booktabs', () => {
  const apa7 = DOKUMENTE.find(d => d.name === 'APA 7').dateien['main.tex']
  const ohne = dockerfile.replace(/^ {6}booktabs \\\n/m, '')
  assert.notEqual(ohne, dockerfile)
  assert.deepEqual(fehlend(apa7, installiert(ohne)), ['booktabs'])
})

test('die APA-7-Arbeit nutzt, was eine übliche Abschlussarbeit braucht', () => {
  const apa7 = lesen('services/web/modules/spur/scripts/smoke/apa7-arbeit.tex')
  assert.match(apa7, /\\documentclass\[man\]\{apa7\}/)
  assert.match(apa7, /\\usepackage\[ngerman\]\{babel\}/)
  assert.match(apa7, /\\usepackage\[style=apa,backend=biber\]\{biblatex\}/)
  for (const paket of ['csquotes', 'booktabs', 'threeparttable', 'pgfplots', 'lineno', 'float', 'caption', 'setspace', 'hyperref', 'cleveref']) {
    assert.match(apa7, new RegExp(`\\\\usepackage(\\[[^\\]]*\\])?\\{${paket}\\}`), paket)
  }
  assert.match(apa7, /\\begin\{tablenotes\}/)
  assert.match(apa7, /\\begin\{figure\}\[H\]/)
  assert.match(apa7, /\\addplot/)
})

test('das minted-Beispiel setzt Python und R', () => {
  const minted = lesen('services/web/modules/spur/scripts/smoke/minted-beispiel.tex')
  assert.match(minted, /\\begin\{minted\}\{python\}\ndef mittel\(xs\): return sum\(xs\)\/len\(xs\)\n\\end\{minted\}/)
  assert.match(minted, /\\begin\{minted\}\{r\}/)
  assert.ok(DOKUMENTE.some(d => d.dateien['main.tex'] === minted), 'minted-Beispiel nicht unter den Smoke-Dokumenten')
})

test('die Paketliste ist alphabetisch und ohne Dubletten', () => {
  const liste = installiert()
  assert.deepEqual(liste, [...liste].sort(), 'nicht alphabetisch')
  assert.deepEqual(liste.filter((p, i) => liste.indexOf(p) !== i), [], 'Dubletten')
})

test('das Image hat die Pakete für deutsche und naturwissenschaftliche Texte, metropolis und minted', () => {
  const liste = installiert()
  for (const paket of ['babel-german', 'hyphen-german', 'mhchem', 'siunitx', 'chemformula', 'xfrac', 'beamertheme-metropolis', 'pgfopts', 'minted', 'fvextra', 'latex2pydata']) {
    assert.ok(liste.includes(paket), paket)
  }
})

test('die Dockerfile prüft latexminted und Python 3.8+ nach der Installation', () => {
  const nach = dockerfile.split('tlmgr path add')[1]
  assert.match(nach, /latexminted --version/)
  assert.match(nach, /python3 -c .*sys\.version_info < \(3, 8\)/)
})

test('LatexRunner.js übergibt kein Shell-Escape-Flag', () => {
  const runner = lesen('services/clsi/app/js/LatexRunner.js')
  assert.match(runner, /'latexmk',\n\s+'-cd',/)
  for (const flag of ['shell-escape', 'enable-write18']) {
    assert.ok(!runner.includes(flag), flag)
  }
})

test('ein Smoke-Dokument nutzt metropolis, ngerman, \\ce und \\qty', () => {
  const beamer = DOKUMENTE.map(d => d.dateien['main.tex']).find(tex => /\\usetheme\{metropolis\}/.test(tex))
  assert.ok(beamer, 'kein metropolis-Dokument')
  assert.match(beamer, /\\usepackage\[ngerman\]\{babel\}/)
  assert.match(beamer, /\\ce\{H2O\}/)
  assert.match(beamer, /\\qty\{0\.89\}\{\\liter\}/)
})

test('Pakete, die chemformula nachlädt, zählen mit', () => {
  assert.deepEqual(benoetigt('\\usepackage{chemformula}'), ['chemformula', 'chemgreek', 'xfrac'])
})

test('Ladenamen zählen als TeX-Live-Paket, Kommentare nicht', () => {
  assert.deepEqual(benoetigt('\\usepackage{tikz,subcaption} % \\usepackage{gibtesnicht}'), ['pgf', 'caption'])
})
