// node --test tools/tests/ci-pfade.test.mjs
// Die Pfadregeln stehen nur in tools/ci/aenderungen.mjs; ci.yml ruft das Skript auf.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { bewerten } from '../ci/aenderungen.mjs'

const lesen = pfad => readFileSync(new URL(`../../${pfad}`, import.meta.url), 'utf8')

const FAELLE = [
  ['nur Doku', ['README.md', 'docs/x.md'], { test: 'leicht', upstream: 'leicht' }],
  ['Doku in Unterordner und Bilder unter docs/', ['docs/bild.png', 'plugins/spur/README.md'], { test: 'leicht', upstream: 'leicht' }],
  ['nur Workflow', ['.github/workflows/ci.yml'], { test: 'voll', upstream: 'leicht' }],
  ['Code unter services/web', ['services/web/modules/spur/app/src/a.mjs'], { test: 'voll', upstream: 'voll' }],
  ['Doku unter services/ zählt für upstream', ['services/web/README.md'], { test: 'leicht', upstream: 'voll' }],
  ['libraries/', ['libraries/o-error/index.js'], { test: 'voll', upstream: 'voll' }],
  ['yarn.lock', ['yarn.lock'], { test: 'voll', upstream: 'voll' }],
  ['package-lock.json in Unterordner', ['services/web/package-lock.json'], { test: 'voll', upstream: 'voll' }],
  ['tools/tests', ['tools/tests/x.mjs'], { test: 'voll', upstream: 'voll' }],
  ['Doku und Workflow gemischt', ['README.md', '.github/workflows/ci.yml'], { test: 'voll', upstream: 'leicht' }],
  ['Makefile', ['Makefile'], { test: 'voll', upstream: 'leicht' }],
  ['leere Liste läuft sicherheitshalber voll', [], { test: 'voll', upstream: 'voll' }],
]

for (const [name, dateien, erwartet] of FAELLE) {
  test(`Pfadregeln: ${name}`, () => assert.deepEqual(bewerten(dateien), erwartet))
}

test('Pfade mit Windows-Trenner und führendem ./ werden gleich behandelt', () => {
  assert.equal(bewerten(['.\\services\\web\\a.js']).upstream, 'voll')
  assert.equal(bewerten(['./docs/x.md']).test, 'leicht')
})

const ci = lesen('.github/workflows/ci.yml')
const jobBlock = name => ci.match(new RegExp(`^  ${name}:\\n([\\s\\S]*?)(?=^  \\S|(?![\\s\\S]))`, 'm'))?.[1] ?? ''

test('ci.yml ruft das Skript auf und hat keine eigenen Pfadregexe', () => {
  assert.match(jobBlock('changes'), /node tools\/ci\/aenderungen\.mjs/)
  assert.doesNotMatch(ci, /libraries\/|yarn\.lock|package-lock|\.md\b|docs\//)
})

test('ci.yml: kein paths-Filter auf Workflow-Ebene (Pflichtprüfung würde hängen)', () => {
  const on = ci.match(/^on:\n([\s\S]*?)^\S/m)[1]
  assert.doesNotMatch(on, /paths(-ignore)?:/)
})

test('ci.yml: upstream und test gibt es je einmal, ohne abweichenden Check-Namen', () => {
  for (const name of ['test', 'upstream']) {
    assert.equal([...ci.matchAll(new RegExp(`^  ${name}:$`, 'gm'))].length, 1, name)
    assert.doesNotMatch(jobBlock(name), /^    name:/m, `${name} darf keinen name: setzen`)
    assert.match(jobBlock(name), /^    if: \$\{\{ !cancelled\(\) \}\}$/m, `${name} läuft auch, wenn changes scheitert`)
    assert.match(jobBlock(name), /needs: changes/)
  }
})

test('ci.yml: jeder Schritt von test und upstream hängt an der Ausgabe des changes-Jobs', () => {
  for (const [name, ausgabe] of [['test', 'test'], ['upstream', 'upstream']]) {
    const schritte = jobBlock(name).split(/^      - /m).slice(1)
    assert.ok(schritte.length > 3, name)
    for (const s of schritte) {
      if (/Prüfung gemeldet/.test(s)) continue
      assert.match(s, new RegExp(`needs\\.changes\\.outputs\\.${ausgabe} != 'leicht'`), `${name}: ${s.split('\n')[0]}`)
    }
  }
})

test('ci.yml: leichter Lauf meldet Erfolg in je einem Schritt', () => {
  for (const name of ['test', 'upstream']) {
    assert.match(jobBlock(name), /Prüfung gemeldet[\s\S]*?needs\.changes\.outputs\.\w+ == 'leicht'/)
  }
})

test('publish.yml startet bei Tags v* und per Hand', () => {
  const publish = lesen('.github/workflows/publish.yml')
  assert.match(publish, /workflow_dispatch:/)
  assert.match(publish, /tags: \['v\*'\]/)
})

test('README beschreibt das Release mit Tag', () => {
  assert.match(lesen('README.md'), /git tag v\d+\.\d+\.\d+ && git push origin v\d+\.\d+\.\d+/)
})
