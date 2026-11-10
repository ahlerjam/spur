// node --test tools/tests/tex-pakete.test.mjs
// Jedes Paket, das ein Smoke-Dokument lädt, muss im Image installiert sein (server-ce/Dockerfile-base).
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { DOKUMENTE } from '../../services/web/modules/spur/scripts/smoke-dokumente.mjs'

const dockerfile = readFileSync(new URL('../../server-ce/Dockerfile-base', import.meta.url), 'utf8')
// Im Schema scheme-basic (collection-latex) enthalten, nicht in der tlmgr-Liste.
const IM_BASISSCHEMA = new Set(['article', 'babel', 'amsmath', 'graphicx'])
const SPRACHEN = { ngerman: ['babel-german', 'hyphen-german'], german: ['babel-german', 'hyphen-german'] }

function installiert() {
  const teil = dockerfile.split('tlmgr install --repository ${TEXLIVE_MIRROR}')[1].split('&&')[0]
  return new Set(teil.split(/[\s\\]+/).filter(Boolean))
}

function benoetigt(tex) {
  const namen = []
  for (const [, optionen = '', liste] of tex.matchAll(/\\usepackage(?:\[([^\]]*)\])?\{([^}]*)\}/g)) {
    for (const paket of liste.split(',').map(p => p.trim())) {
      namen.push(paket)
      if (paket === 'babel') namen.push(...optionen.split(',').flatMap(o => SPRACHEN[o.trim()] ?? []))
    }
  }
  for (const [, klasse] of tex.matchAll(/\\documentclass(?:\[[^\]]*\])?\{([^}]*)\}/g)) namen.push(klasse)
  for (const [, thema] of tex.matchAll(/\\usetheme(?:\[[^\]]*\])?\{([^}]*)\}/g)) namen.push(`beamertheme-${thema}`)
  return namen
}

test('jedes Paket der Smoke-Dokumente steht in der Paketliste des Images', () => {
  const liste = installiert()
  for (const { name, dateien } of DOKUMENTE) {
    const fehlend = benoetigt(dateien['main.tex']).filter(p => !liste.has(p) && !IM_BASISSCHEMA.has(p))
    assert.deepEqual(fehlend, [], `${name}: fehlt im Image`)
  }
})

test('das Image hat die Pakete für deutsche und naturwissenschaftliche Texte und metropolis', () => {
  const liste = installiert()
  for (const paket of ['babel-german', 'hyphen-german', 'mhchem', 'siunitx', 'chemformula', 'beamertheme-metropolis', 'pgfopts']) {
    assert.ok(liste.has(paket), paket)
  }
})

test('ein Smoke-Dokument nutzt metropolis, ngerman, \\ce und \\qty', () => {
  const beamer = DOKUMENTE.map(d => d.dateien['main.tex']).find(tex => /\\usetheme\{metropolis\}/.test(tex))
  assert.ok(beamer, 'kein metropolis-Dokument')
  assert.match(beamer, /\\usepackage\[ngerman\]\{babel\}/)
  assert.match(beamer, /\\ce\{H2O\}/)
  assert.match(beamer, /\\qty\{0\.89\}\{\\liter\}/)
})
