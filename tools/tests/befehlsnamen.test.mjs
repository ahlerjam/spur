// node --test tools/tests/befehlsnamen.test.mjs
// Über das Plugin heißen die Workflows in Claude Code /plugin:spur:spur:<name> (Entscheidung D3, Option A).
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

const lesen = pfad => readFileSync(new URL(`../../${pfad}`, import.meta.url), 'utf8')
const WORKFLOWS = ['literaturueberblick', 'methodenteil', 'folien']
const ALTER_BEFEHL = /(^|[^:\w])\/spur:(literaturueberblick|methodenteil|folien)\b/m

const TEXTE = [
  'README.md',
  'services/web/modules/spur/frontend/js/claude/claude-panel.tsx',
  'services/web/modules/spur/frontend/js/claude/workflow-befehl.ts',
  'services/web/modules/spur/frontend/js/workflows/workflows-admin.tsx',
  'services/web/locales/de.json',
  'services/web/locales/en.json',
  'plugins/spur/skills/spur/SKILL.md',
]

test('README nennt die drei Workflow-Befehle mit dem Plugin-Namen', () => {
  const readme = lesen('README.md')
  for (const name of WORKFLOWS) assert.match(readme, new RegExp(`/plugin:spur:spur:${name}\\b`))
})

test('kein Text nennt einen Workflow als /spur:<name>', () => {
  for (const pfad of TEXTE) {
    assert.doesNotMatch(lesen(pfad), ALTER_BEFEHL, pfad)
    assert.doesNotMatch(lesen(pfad), /\/spur:\{/, pfad)
  }
})
