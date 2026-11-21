// node --test tools/tests/mcp-vertrag.test.mjs
// docs/mcp-contract.md nennt genau die Werkzeuge, die der MCP-Server anbietet (werkzeuge.mjs, gelesen über werkzeuge-im-code.mjs).
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { werkzeugeImCode } from './werkzeuge-im-code.mjs'

const lesen = pfad => readFileSync(new URL(`../../${pfad}`, import.meta.url), 'utf8')

// Im Vertrag: die erste Spalte der Tabelle unter „## Tools“.
function werkzeugeImVertrag() {
  const vertrag = lesen('docs/mcp-contract.md')
  const abschnitt = vertrag.split('\n## Tools\n')[1].split('\n## ')[0]
  const namen = abschnitt
    .split('\n')
    .filter(zeile => zeile.startsWith('| `'))
    .flatMap(zeile => [...zeile.split('|')[1].matchAll(/`([a-z_]+)`/g)].map(m => m[1]))
  return new Set(namen)
}

test('der Vertrag nennt jedes Werkzeug des Servers und keines, das es nicht gibt', () => {
  const code = werkzeugeImCode()
  const vertrag = werkzeugeImVertrag()
  assert.ok(code.size > 20, `Werkzeuge im Code nicht gefunden: ${[...code]}`)
  assert.deepEqual([...vertrag].filter(n => !code.has(n)), [], 'im Vertrag, aber nicht im Code')
  assert.deepEqual([...code].filter(n => !vertrag.has(n)), [], 'im Code, aber nicht im Vertrag')
})
