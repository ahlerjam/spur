// node --test tools/tests/plugin-aufbau.test.mjs
// Aufbau des Plugins: Manifest und Marketplace, Agenten und Skills, und dass jedes genannte Werkzeug existiert.
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { test } from 'node:test'

const lesen = pfad => readFileSync(new URL(`../../${pfad}`, import.meta.url), 'utf8')
const json = pfad => JSON.parse(lesen(pfad))
const PLUGIN = 'plugins/spur'
const MCP = 'mcp__plugin_spur_spur__'

// Die Werkzeuge stehen in werkzeuge.mjs als Schlüssel `  name: {` des Objekts WERKZEUGE (wie mcp-vertrag.test.mjs).
const quelle = lesen('services/web/modules/spur/app/src/mcp/werkzeuge.mjs')
const WERKZEUGE = new Set([...quelle.slice(quelle.indexOf('export const WERKZEUGE = {')).matchAll(/^ {2}([a-z_]+): \{$/gm)].map(m => m[1]))
const PRAEFIXE = new Set([...WERKZEUGE].map(n => n.split('_')[0]))
// Ereignistypen von wait_for_event sehen aus wie Werkzeuge.
const KEIN_WERKZEUG = new Set(['suggest_trigger'])

// Manifest und Marketplace: gleiche Version, und jede Abhängigkeit aus fremdem Marketplace steht in der Allowlist.
function manifestPruefen(plugin, marketplace) {
  const probleme = []
  const eintrag = marketplace.plugins.find(p => p.name === plugin.name)
  if (!eintrag) return [`${plugin.name} fehlt im Marketplace`]
  if (eintrag.version !== plugin.version) probleme.push(`Version ${plugin.version} in plugin.json, ${eintrag.version} im Marketplace`)
  const erlaubt = marketplace.allowCrossMarketplaceDependenciesOn ?? []
  for (const dep of plugin.dependencies ?? []) {
    const marke = typeof dep === 'string' ? dep.split('@')[1] : dep.marketplace
    const name = typeof dep === 'string' ? dep.split('@')[0] : dep.name
    if (marke && marke !== marketplace.name && !erlaubt.includes(marke)) probleme.push(`${name}: Marketplace ${marke} fehlt in allowCrossMarketplaceDependenciesOn`)
  }
  return probleme
}

// Frontmatter mit `schluessel: wert` und `schluessel: [a, b]`; mehr kennen die Dateien des Plugins nicht.
function frontmatter(text) {
  const kopf = /^---\n([\s\S]*?)\n---\n/.exec(text)?.[1]
  assert.ok(kopf, 'kein Frontmatter')
  return Object.fromEntries(
    kopf.split('\n').map(zeile => {
      const [, k, v] = /^([a-zA-Z-]+): (.*)$/.exec(zeile) ?? fail(`Zeile nicht lesbar: ${zeile}`)
      const liste = /^\[(.*)\]$/.exec(v)
      return [k, liste ? liste[1].split(',').map(s => s.trim()).filter(Boolean) : v]
    })
  )
}
const fail = msg => assert.fail(msg)

// Werkzeuge, die ein Text in Backticks nennt: snake_case mit dem Präfix eines echten Werkzeugs.
function genannteWerkzeuge(text) {
  const namen = [...text.matchAll(/`([a-z]+(?:_[a-z]+)+)`/g)].map(m => m[1])
  return [...new Set(namen.filter(n => PRAEFIXE.has(n.split('_')[0]) && !n.endsWith('_id') && !KEIN_WERKZEUG.has(n)))]
}
const unbekannteWerkzeuge = text => genannteWerkzeuge(text).filter(n => !WERKZEUGE.has(n))

const AGENTEN = Object.fromEntries(readdirSync(`${PLUGIN}/agents`).map(d => [d.replace(/\.md$/, ''), lesen(`${PLUGIN}/agents/${d}`)]))
const SKILLS = Object.fromEntries(readdirSync(`${PLUGIN}/skills`).map(d => [d, lesen(`${PLUGIN}/skills/${d}/SKILL.md`)]))
const werkzeugeVon = agent => frontmatter(AGENTEN[agent]).tools.split(',').map(s => s.trim())
const SCHREIBEND = ['doc_edit', 'doc_create', 'run_finish', 'quote_mark', 'reply', 'suggest', 'source_add', 'acquisition_add', 'paper_exclude', 'matrix_suggest', 'tex_package_add', 'source_figure_add', 'source_upload_link', 'file_upload_link']

test('plugin.json: Version 0.2.0 und die drei Abhängigkeiten, Marketplace mit beiden Allowlist-Einträgen', () => {
  const plugin = json(`${PLUGIN}/.claude-plugin/plugin.json`)
  const marketplace = json('.claude-plugin/marketplace.json')
  assert.equal(plugin.version, '0.2.0')
  assert.deepEqual(plugin.dependencies, [
    { name: 'humanizer', marketplace: 'cflow' },
    { name: 'humanizer-de', marketplace: 'cflow' },
    { name: 'playwright', marketplace: 'claude-plugins-official' },
  ])
  assert.deepEqual(marketplace.allowCrossMarketplaceDependenciesOn, ['cflow', 'claude-plugins-official'])
  assert.deepEqual(manifestPruefen(plugin, marketplace), [])
})

test('ohne cflow in der Allowlist nennt die Prüfung humanizer, eine andere Version im Marketplace auch', () => {
  const plugin = json(`${PLUGIN}/.claude-plugin/plugin.json`)
  const marketplace = json('.claude-plugin/marketplace.json')
  const ohneCflow = { ...marketplace, allowCrossMarketplaceDependenciesOn: ['claude-plugins-official'] }
  const probleme = manifestPruefen(plugin, ohneCflow)
  assert.equal(probleme.length, 2)
  assert.match(probleme[0], /^humanizer: Marketplace cflow fehlt/)
  const andereVersion = { ...marketplace, plugins: [{ ...marketplace.plugins[0], version: '0.1.0' }] }
  assert.deepEqual(manifestPruefen(plugin, andereVersion), ['Version 0.2.0 in plugin.json, 0.1.0 im Marketplace'])
})

test('die Agenten haben die Pflichtfelder und keine Felder, die Claude Code bei Plugin-Agenten ignoriert', () => {
  assert.deepEqual(Object.keys(AGENTEN).sort(), ['auswertung', 'endpruefung', 'gegenpruefung'])
  for (const [name, text] of Object.entries(AGENTEN)) {
    const fm = frontmatter(text)
    assert.equal(fm.name, name)
    for (const feld of ['description', 'tools', 'skills']) assert.ok(fm[feld], `${name}: ${feld} fehlt`)
    for (const feld of ['hooks', 'mcpServers', 'permissionMode']) assert.ok(!(feld in fm), `${name}: ${feld} wird ignoriert`)
    for (const skill of fm.skills) assert.ok(SKILLS[skill], `${name}: Skill ${skill} gibt es nicht`)
    for (const w of werkzeugeVon(name)) {
      assert.ok(w.startsWith(MCP), `${name}: ${w} ist kein spur-Werkzeug`)
      assert.ok(WERKZEUGE.has(w.slice(MCP.length)), `${name}: ${w} gibt es nicht in werkzeuge.mjs`)
    }
    assert.ok(!werkzeugeVon(name).some(w => /^(Agent|Task)$/.test(w)), `${name} darf keine Agenten starten`)
  }
})

test('auswertung, gegenpruefung und endpruefung haben genau ihre Werkzeuge und Skills', () => {
  const kurz = agent => werkzeugeVon(agent).map(w => w.slice(MCP.length))
  assert.deepEqual(kurz('auswertung'), ['sources_list', 'source_search', 'source_read', 'source_page_image', 'bib_list', 'paper_search', 'paper_citations'])
  assert.deepEqual(kurz('gegenpruefung'), ['check_report', 'doc_list', 'doc_read', 'sources_list', 'source_search', 'source_read', 'source_page_image', 'bib_list'])
  const end = kurz('endpruefung')
  for (const w of ['compile', 'compile_log', 'page_image', 'run_status', 'check_report', 'doc_read', 'bib_list']) assert.ok(end.includes(w), `endpruefung ohne ${w}`)
  for (const agent of ['auswertung', 'gegenpruefung', 'endpruefung']) {
    const schreibend = kurz(agent).filter(w => SCHREIBEND.includes(w))
    assert.deepEqual(schreibend, [], `${agent} hat schreibende Werkzeuge`)
  }
  assert.deepEqual(frontmatter(AGENTEN.auswertung).skills, ['spur-auswertung'])
  assert.deepEqual(frontmatter(AGENTEN.gegenpruefung).skills, ['spur-gegenpruefung'])
  assert.deepEqual(frontmatter(AGENTEN.endpruefung).skills, ['spur-endpruefung', 'spur-abbildungen'])
  assert.match(frontmatter(AGENTEN.auswertung).description, /Paper auswerten/)
  assert.match(frontmatter(AGENTEN.auswertung).description, /Quellen auswerten/)
})

test('jeder Skill hat Name gleich Ordner, eine Beschreibung mit Auslösern und weniger als 500 Zeilen', () => {
  assert.deepEqual(Object.keys(SKILLS).sort(), ['spur', 'spur-abbildungen', 'spur-auswertung', 'spur-endpruefung', 'spur-gegenpruefung', 'spur-pdf-holen'])
  for (const [name, text] of Object.entries(SKILLS)) {
    const fm = frontmatter(text)
    assert.equal(fm.name, name)
    assert.match(fm.description, /\bUse (when|for|on)\b/, `${name}: Beschreibung ohne Auslöser`)
    assert.ok(text.split('\n').length < 500, `${name} hat ${text.split('\n').length} Zeilen`)
  }
  for (const wort of ['Abbildung', 'Grafik', 'Diagramm', 'TikZ', 'Tabelle', 'figure', 'table']) {
    assert.ok(frontmatter(SKILLS['spur-abbildungen']).description.includes(wort), `spur-abbildungen ohne Auslöser ${wort}`)
  }
})

test('jedes in Agenten und Skills genannte Werkzeug existiert in werkzeuge.mjs', () => {
  for (const [name, text] of [...Object.entries(AGENTEN), ...Object.entries(SKILLS)]) {
    assert.deepEqual(unbekannteWerkzeuge(text), [], `${name} nennt Werkzeuge, die es nicht gibt`)
  }
  assert.ok(genannteWerkzeuge(SKILLS.spur).length > 20, `Hauptskill: nur ${genannteWerkzeuge(SKILLS.spur)}`)
})

test('ein umbenanntes Werkzeug in einem Skill macht die Prüfung rot', () => {
  const umbenannt = SKILLS['spur-auswertung'].replaceAll('`source_read`', '`source_lesen`')
  assert.deepEqual(unbekannteWerkzeuge(umbenannt), ['source_lesen'])
  assert.deepEqual(unbekannteWerkzeuge(SKILLS.spur.replace('`tex_file_read`', '`tex_datei_lesen`')), ['tex_datei_lesen'])
})

test('der Hauptskill nennt jedes neue Werkzeug und Feld aus P12 bis P16', () => {
  const neu = ['search_log', 'paper_exclude', 'source_page_image', 'source_figure_add', 'file_upload_link', 'tex_file_read']
  for (const w of neu) assert.ok(WERKZEUGE.has(w), `${w} gibt es nicht mehr`)
  const genannt = genannteWerkzeuge(SKILLS.spur)
  assert.deepEqual(neu.filter(w => !genannt.includes(w)), [])
  for (const feld of ['bot_schutz', 'nicht_frei', 'pdf_url', 'metadaten', 'ab_zeichen', 'alle_vorkommen', 'aenderungen', 'fehlende_pakete', 'abweichungen']) {
    assert.ok(new RegExp(`\`${feld}[\`:]`).test(SKILLS.spur), `Hauptskill ohne ${feld}`)
  }
})
