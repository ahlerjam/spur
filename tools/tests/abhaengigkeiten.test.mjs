// node --test tools/tests/abhaengigkeiten.test.mjs
// Das Betreiber-Image installiert nur die dependencies von services/web; Yarn PnP verweigert dort jeden Import aus
// devDependencies, und Web startet nicht. Der Servercode des spur-Moduls darf daher nur Laufzeit-Abhängigkeiten nutzen.
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { builtinModules } from 'node:module'
import { join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

const WEB = fileURLToPath(new URL('../../services/web/', import.meta.url))
const SERVERCODE = ['modules/spur/app', 'modules/spur/scripts', 'modules/spur/index.mjs']
const IMPORT = /(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*|^\s*import\s+)['"]([^'"]+)['"]/gm

function dateien(pfad) {
  if (!statSync(pfad).isDirectory()) return [pfad]
  return readdirSync(pfad).flatMap(name => dateien(join(pfad, name)))
}

function paketname(spezifizierer) {
  const teile = spezifizierer.split('/')
  return spezifizierer.startsWith('@') ? teile.slice(0, 2).join('/') : teile[0]
}

export function fremdeImporte(quelltext) {
  return [...quelltext.matchAll(IMPORT)]
    .map(treffer => treffer[1])
    .filter(s => !s.startsWith('.') && !s.startsWith('/') && !s.startsWith('node:'))
    .map(paketname)
    .filter(name => !builtinModules.includes(name))
}

test('fremdeImporte findet Pakete und übergeht relative Pfade und Node-Module', () => {
  const quelle = `import { stringify } from 'csv-stringify/sync'\nimport x from './x.mjs'\nimport fs from 'node:fs'\nimport path from 'path'\nconst m = await import('@scope/paket/sub')`
  assert.deepEqual(fremdeImporte(quelle), ['csv-stringify', '@scope/paket'])
})

test('der Servercode des spur-Moduls importiert nur Laufzeit-Abhängigkeiten', () => {
  const paket = JSON.parse(readFileSync(join(WEB, 'package.json'), 'utf8'))
  const laufzeit = new Set(Object.keys({ ...paket.dependencies, ...paket.optionalDependencies }))
  const fehlend = []
  for (const datei of SERVERCODE.flatMap(pfad => dateien(join(WEB, pfad)))) {
    if (!/\.(m?js|cjs|ts)$/.test(datei)) continue
    for (const name of fremdeImporte(readFileSync(datei, 'utf8'))) {
      if (!laufzeit.has(name)) fehlend.push(`${name} (${datei.slice(WEB.length)})`)
    }
  }
  assert.deepEqual(fehlend, [], 'nicht in dependencies von services/web/package.json')
})
