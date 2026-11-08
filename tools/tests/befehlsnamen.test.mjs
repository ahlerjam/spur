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

test('Panel-Hilfe baut die Befehle aus dem Plugin-Namen', () => {
  assert.match(lesen('services/web/modules/spur/frontend/js/claude/workflow-befehl.ts'), /'\/plugin:spur:spur:'/)
})

test('kein Text nennt einen Workflow als /spur:<name>', () => {
  for (const pfad of TEXTE) assert.doesNotMatch(lesen(pfad), ALTER_BEFEHL, pfad)
  assert.doesNotMatch(lesen('services/web/modules/spur/frontend/js/workflows/workflows-admin.tsx'), /\/spur:\{/)
})
