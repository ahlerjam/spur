// node --test tools/tests/drosselung.test.mjs
// Die Plugin-Anleitung sagt, was Claude tut, wenn ein Recherche-Dienst „gedrosselt“ oder „nicht_erreichbar“ meldet,
// und der Workflow-Text „Quellen sammeln“ verweist auf diese Regel.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

const lesen = pfad => readFileSync(new URL(`../../${pfad}`, import.meta.url), 'utf8')
const UEBERSCHRIFT = 'Throttled or unreachable services'

const regel = () => {
  const skill = lesen('plugins/spur/skills/spur/SKILL.md')
  const start = skill.indexOf(`## ${UEBERSCHRIFT}`)
  assert.notEqual(start, -1, 'SKILL.md hat keine Regel für gedrosselte Dienste')
  const rest = skill.slice(start + 3)
  const ende = rest.search(/^#{1,2} /m)
  return ende === -1 ? rest : rest.slice(0, ende)
}

test('SKILL.md nennt beide Dienst-Zustände und das Feld dienste', () => {
  const text = regel()
  assert.match(text, /`dienste`/)
  assert.match(text, /`gedrosselt`/)
  assert.match(text, /`nicht_erreichbar`/)
  assert.match(text, /`paper_search`/)
  assert.match(text, /`paper_citations`/)
})

test('SKILL.md: mit den anderen Diensten weiter, nicht sofort erneut, Lücke in der Zusammenfassung, Etappen', () => {
  const text = regel()
  assert.match(text, /continue with the results of the other services/i)
  assert.match(text, /not ask the same service again right away/i)
  assert.match(text, /gap in the summary/i)
  assert.match(text, /in stages/i)
})

test('Workflow „Quellen sammeln“ verweist auf die Regel', () => {
  const workflows = lesen('services/web/modules/spur/app/src/workflows/standardtexte.mjs')
  const start = workflows.indexOf('quellen_sammeln: {')
  assert.notEqual(start, -1)
  const text = workflows.slice(start)
  assert.ok(text.includes(`„${UEBERSCHRIFT}“`), 'Workflow-Text nennt die Regel nicht')
  assert.match(text, /SKILL\.md|Plugin-Anleitung/)
})
