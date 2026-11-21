// node --test tools/tests/plugin-hooks.test.mjs
// Die Hooks des Plugins mit festen Eingaben. Vorlage sind die mitgeschnittenen Eingaben aus Claude Code 2.1.325
// (P17-Spec, Context), ergänzt um tool_name und tool_input der spur-Werkzeuge.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, beforeEach, test } from 'node:test'
import { fileURLToPath } from 'node:url'

const PLUGIN = fileURLToPath(new URL('../../plugins/spur/', import.meta.url))
const HOOK = join(PLUGIN, 'hooks/pruefkette')
const BEFEHL = join(PLUGIN, 'bin/spur-pruefkette')
const MCP = 'mcp__plugin_spur_spur__'
const PID = 'a1b2c3d4e5f6a1b2c3d4e5f6'

const wurzel = mkdtempSync(join(tmpdir(), 'spur-hooks-'))
after(() => rmSync(wurzel, { recursive: true, force: true }))
let daten
let n = 0
beforeEach(() => {
  daten = join(wurzel, `d${n++}`)
})

const SESSION = 'b7c2e0f4-5d1a-4c3e-9f2b-1a2b3c4d5e6f'
const ANDERE = '0e9d8c7b-6a5f-4e3d-2c1b-0a9f8e7d6c5b'

function hook(eingabe, env = {}) {
  const r = spawnSync('bash', [HOOK], {
    input: JSON.stringify(eingabe),
    encoding: 'utf8',
    env: { PATH: process.env.PATH, CLAUDE_PLUGIN_DATA: daten, CLAUDE_PLUGIN_ROOT: PLUGIN, ...env },
  })
  return { status: r.status, stdout: r.stdout, stderr: r.stderr, json: r.stdout.trim() ? JSON.parse(r.stdout) : null }
}

const basis = (session, event) => ({ session_id: session, transcript_path: '/tmp/t.jsonl', cwd: '/tmp', permission_mode: 'auto', hook_event_name: event })
const sessionStart = (session = SESSION) => ({ ...basis(session, 'SessionStart'), source: 'startup' })
const docEdit = (tool_input, session = SESSION) => ({
  ...basis(session, 'PostToolUse'),
  tool_name: `${MCP}doc_edit`,
  tool_input: { project_id: PID, alt: 'alt', neu: 'neu', idempotenz_schluessel: 'k1', ...tool_input },
  tool_response: [{ type: 'text', text: '{"aenderung_id":"x"}' }],
})
const docCreate = (pfad, session = SESSION) => ({
  ...basis(session, 'PostToolUse'),
  tool_name: `${MCP}doc_create`,
  tool_input: { project_id: PID, pfad, inhalt: 'x', idempotenz_schluessel: 'k2' },
  tool_response: [{ type: 'text', text: '{}' }],
})
const agentStop = (agent_type, session = SESSION) => ({ ...basis(session, 'SubagentStop'), agent_id: 'a6f1', agent_type, stop_hook_active: false })
const skill = (name, session = SESSION) => ({
  ...basis(session, 'PostToolUse'),
  tool_name: 'Skill',
  tool_input: { skill: name },
  tool_response: { success: true, commandName: name },
})
const checkReport = (session = SESSION) => ({
  ...basis(session, 'PostToolUse'),
  tool_name: `${MCP}check_report`,
  tool_input: { project_id: PID },
  tool_response: [{ type: 'text', text: '{"eintraege":[]}' }],
})
const finishVorher = (session = SESSION) => ({
  ...basis(session, 'PreToolUse'),
  tool_name: `${MCP}run_finish`,
  tool_input: { project_id: PID, zusammenfassung: 'Fertig.' },
})
const finishNachher = (session = SESSION) => ({ ...finishVorher(session), hook_event_name: 'PostToolUse', tool_response: [{ type: 'text', text: '{"status":"beendet"}' }] })

const HUMANIZER = 'humanizer-de:humanizer-de'
const folge = (...eingaben) => {
  for (const e of eingaben) {
    const r = hook(e)
    assert.equal(r.status, 0, r.stderr)
  }
}
// Gibt die Begründung zurück oder null, wenn run_finish durchgeht.
function finish(session = SESSION) {
  const r = hook(finishVorher(session))
  assert.equal(r.status, 0, r.stderr)
  if (!r.json) return null
  assert.equal(r.json.hookSpecificOutput.hookEventName, 'PreToolUse')
  if (r.json.hookSpecificOutput.permissionDecision !== 'deny') return null
  return r.json.hookSpecificOutput.permissionDecisionReason
}
const STUFEN = ['Gegenprüfung', 'Endprüfung', 'Humanizer', 'check_report']
// Prüft, dass genau diese Stufen genannt sind.
function nenntGenau(grund, erwartet) {
  assert.ok(grund, 'run_finish ging durch, erwartet war eine Verweigerung')
  for (const s of STUFEN) assert.equal(grund.includes(s), erwartet.includes(s), `${s} ${erwartet.includes(s) ? 'fehlt' : 'zu viel'} in: ${grund}`)
}

test('hooks.json hängt die vier Ereignisse an Skripte im Plugin-Ordner', () => {
  const { hooks } = JSON.parse(readFileSync(join(PLUGIN, 'hooks/hooks.json'), 'utf8'))
  assert.deepEqual(Object.keys(hooks).sort(), ['PostToolUse', 'PreToolUse', 'SessionStart', 'SubagentStop'])
  const befehle = Object.values(hooks).flat().flatMap(e => e.hooks.map(h => h.command))
  for (const b of befehle) assert.match(b, /^\$\{CLAUDE_PLUGIN_ROOT\}\//)
  const matcher = ereignis => hooks[ereignis].map(e => e.matcher ?? '').join('|').split('|')
  for (const t of ['doc_edit', 'doc_create', 'check_report']) assert.ok(matcher('PostToolUse').includes(`${MCP}${t}`), `PostToolUse ohne ${t}`)
  assert.ok(matcher('PostToolUse').includes('Skill'))
  assert.deepEqual(matcher('PreToolUse'), [`${MCP}run_finish`])
})

test('SessionStart nennt die Kette in höchstens drei Sätzen', () => {
  const r = hook(sessionStart())
  assert.equal(r.status, 0, r.stderr)
  const text = r.json.hookSpecificOutput.additionalContext
  assert.equal(r.json.hookSpecificOutput.hookEventName, 'SessionStart')
  for (const s of ['gegenpruefung', 'endpruefung', 'humanizer', 'check_report', 'run_finish']) assert.ok(text.includes(s), `${s} fehlt: ${text}`)
  const saetze = text.split(/(?<=[.!?])\s+/).filter(Boolean)
  assert.ok(saetze.length <= 3, `${saetze.length} Sätze: ${text}`)
})

test('SessionStart schreibt Session und Datenordner für spur-pruefkette in CLAUDE_ENV_FILE', () => {
  const env = join(wurzel, 'env-datei')
  writeFileSync(env, 'export SCHON_DA=1\n')
  hook(sessionStart(), { CLAUDE_ENV_FILE: env })
  const inhalt = readFileSync(env, 'utf8')
  assert.match(inhalt, /^export SCHON_DA=1\n/)
  assert.ok(inhalt.includes(`export SPUR_PRUEFKETTE_SESSION='${SESSION}'`), inhalt)
  assert.ok(inhalt.includes(`export SPUR_PRUEFKETTE_DATA='${daten}'`), inhalt)
})

test('frische Session: run_finish geht durch, ohne Text geändert zu haben', () => {
  const r = hook(finishVorher())
  assert.equal(r.status, 0)
  assert.equal(r.stdout, '')
})

test('nach doc_edit auf main.tex verweigert run_finish und nennt alle vier Stufen, als Nächstes die Gegenprüfung', () => {
  folge(docEdit({ pfad: 'main.tex' }))
  const grund = finish()
  nenntGenau(grund, STUFEN)
  assert.match(grund, /Nächster Schritt: Gegenprüfung/)
})

test('nach der Gegenprüfung fehlen Endprüfung, Humanizer und check_report; nach allen Stufen geht es durch', () => {
  folge(docEdit({ pfad: 'main.tex' }), agentStop('spur:gegenpruefung'))
  const grund = finish()
  nenntGenau(grund, ['Endprüfung', 'Humanizer', 'check_report'])
  assert.match(grund, /Nächster Schritt: Endprüfung/)
  folge(agentStop('spur:endpruefung'), skill(HUMANIZER), checkReport())
  assert.equal(finish(), null)
})

test('der Agentenname ohne Präfix zählt auch, humanizer:humanizer auch', () => {
  folge(docEdit({ pfad: 'main.tex' }), agentStop('gegenpruefung'), agentStop('endpruefung'), skill('humanizer:humanizer'), checkReport())
  assert.equal(finish(), null)
})

test('ein anderer Skill oder Agent zählt nicht', () => {
  folge(docEdit({ pfad: 'main.tex' }), agentStop('spur:auswertung'), agentStop('general-purpose'), skill('spur:spur'))
  nenntGenau(finish(), STUFEN)
})

test('eine Textänderung nach der Kette verlangt nur ein neues check_report', () => {
  folge(docEdit({ pfad: 'main.tex' }), agentStop('spur:gegenpruefung'), agentStop('spur:endpruefung'), skill(HUMANIZER), checkReport())
  folge(docEdit({ pfad: 'main.tex' }))
  const grund = finish()
  nenntGenau(grund, ['check_report'])
  assert.match(grund, /Nächster Schritt: check_report/)
  folge(checkReport())
  assert.equal(finish(), null)
})

test('Änderungen an .bib, .txt und .md zählen nicht als Textarbeit', () => {
  folge(docEdit({ pfad: 'literatur.bib' }), docEdit({ pfad: 'notizen.md' }), docCreate('liste.txt'))
  assert.equal(finish(), null)
  folge(docEdit({ pfad: 'main.tex' }), agentStop('spur:gegenpruefung'), agentStop('spur:endpruefung'), skill(HUMANIZER), checkReport())
  folge(docEdit({ pfad: 'literatur.bib' }), docEdit({ pfad: 'notizen.md' }))
  assert.equal(finish(), null)
})

test('doc_edit nur mit doc_id zählt als Textarbeit und sperrt wieder', () => {
  folge(docEdit({ pfad: 'main.tex' }), agentStop('spur:gegenpruefung'), agentStop('spur:endpruefung'), skill(HUMANIZER), checkReport())
  folge(docEdit({ doc_id: 'd1e2f3a4b5c6d1e2f3a4b5c6' }))
  nenntGenau(finish(), ['check_report'])
})

test('doc_create auf eine .tex-Datei zählt als Textarbeit', () => {
  folge(docCreate('kapitel/zwei.tex'))
  nenntGenau(finish(), STUFEN)
})

test('ein Pfad im geänderten Text täuscht die Erkennung nicht', () => {
  folge(docEdit({ pfad: 'main.tex', neu: '{"pfad": "x.bib"} \\"pfad\\": \\"y.md\\"' }))
  nenntGenau(finish(), STUFEN)
})

test('zwei Sessions beeinflussen sich nicht', () => {
  folge(docEdit({ pfad: 'main.tex' }))
  assert.equal(finish(ANDERE), null)
  folge(docEdit({ pfad: 'main.tex' }, ANDERE), agentStop('spur:gegenpruefung', ANDERE))
  nenntGenau(finish(), STUFEN)
  nenntGenau(finish(ANDERE), ['Endprüfung', 'Humanizer', 'check_report'])
})

test('nach erfolgreichem run_finish ist der Zustand der Session leer', () => {
  folge(docEdit({ pfad: 'main.tex' }), agentStop('spur:gegenpruefung'), agentStop('spur:endpruefung'), skill(HUMANIZER), checkReport())
  assert.equal(finish(), null)
  folge(finishNachher())
  assert.deepEqual(readdirSync(join(daten, 'pruefkette')), [])
  assert.equal(finish(), null)
})

test('ein gescheitertes run_finish behält den Zustand', () => {
  folge(docEdit({ pfad: 'main.tex' }))
  folge({ ...finishNachher(), tool_response: { isError: true, content: [{ type: 'text', text: '{"fehler":"kein_lauf"}' }] } })
  nenntGenau(finish(), STUFEN)
})

test('gescheiterte Aufrufe von doc_edit und check_report zählen nicht', () => {
  const fehler = { isError: true, content: [{ type: 'text', text: '{"fehler":"konflikt"}' }] }
  folge({ ...docEdit({ pfad: 'main.tex' }), tool_response: fehler })
  assert.equal(finish(), null)
  folge(docEdit({ pfad: 'main.tex' }), agentStop('spur:gegenpruefung'), agentStop('spur:endpruefung'), skill(HUMANIZER), { ...checkReport(), tool_response: fehler })
  nenntGenau(finish(), ['check_report'])
})

test('eine Nachprüfung ändert die Sperre nicht', () => {
  folge(docEdit({ pfad: 'main.tex' }), agentStop('spur:gegenpruefung'), docEdit({ pfad: 'main.tex' }), agentStop('spur:gegenpruefung'))
  folge(agentStop('spur:endpruefung'), docEdit({ pfad: 'main.tex' }), agentStop('spur:endpruefung'), skill(HUMANIZER), checkReport())
  assert.equal(finish(), null)
})

test('fehlt in der Folge mit Nachprüfung die Endprüfung, nennt die Begründung Endprüfung, Humanizer und check_report', () => {
  folge(docEdit({ pfad: 'main.tex' }), agentStop('spur:gegenpruefung'), agentStop('spur:gegenpruefung'), skill(HUMANIZER), checkReport())
  nenntGenau(finish(), ['Endprüfung', 'Humanizer', 'check_report'])
})

test('eine Endprüfung vor der Gegenprüfung zählt nicht', () => {
  folge(docEdit({ pfad: 'main.tex' }), agentStop('spur:endpruefung'), agentStop('spur:gegenpruefung'), skill(HUMANIZER), checkReport())
  nenntGenau(finish(), ['Endprüfung', 'Humanizer', 'check_report'])
})

const befehl = (args, env = {}) =>
  spawnSync('bash', [BEFEHL, ...args], {
    encoding: 'utf8',
    env: { PATH: process.env.PATH, SPUR_PRUEFKETTE_SESSION: SESSION, SPUR_PRUEFKETTE_DATA: daten, ...env },
  })

test('spur-pruefkette aus mit Grund lässt run_finish durch, stand zeigt den Grund', () => {
  folge(docEdit({ pfad: 'main.tex' }))
  const r = befehl(['aus', 'Owner will nur einen Tippfehler'])
  assert.equal(r.status, 0, r.stderr)
  assert.equal(finish(), null)
  const stand = befehl(['stand'])
  assert.equal(stand.status, 0, stand.stderr)
  assert.match(stand.stdout, /Owner will nur einen Tippfehler/)
  folge(docEdit({ pfad: 'main.tex' }, ANDERE))
  nenntGenau(finish(ANDERE), STUFEN)
})

test('spur-pruefkette stand nennt die fehlenden Stufen', () => {
  folge(docEdit({ pfad: 'main.tex' }), agentStop('spur:gegenpruefung'))
  const r = befehl(['stand'])
  assert.equal(r.status, 0, r.stderr)
  assert.match(r.stdout, /Textarbeit: ja/)
  assert.match(r.stdout, /Es fehlen: Endprüfung, Humanizer, check_report/)
  const leer = befehl(['stand'], { SPUR_PRUEFKETTE_SESSION: ANDERE })
  assert.match(leer.stdout, /Textarbeit: nein/)
})

test('spur-pruefkette aus ohne Grund oder ohne Session endet mit Exit-Code 2', () => {
  const ohneGrund = befehl(['aus'])
  assert.equal(ohneGrund.status, 2)
  assert.match(ohneGrund.stderr, /Grund/)
  const leer = befehl(['aus', '   '])
  assert.equal(leer.status, 2)
  const ohneSession = befehl(['aus', 'Tippfehler'], { SPUR_PRUEFKETTE_SESSION: '' })
  assert.equal(ohneSession.status, 2)
  assert.match(ohneSession.stderr, /Session/)
  assert.equal(befehl(['--help']).status, 0)
  assert.equal(befehl(['gibtsnicht']).status, 2)
})

test('eine kaputte Zustandsdatei blockiert nicht und meldet eine Zeile auf stderr', () => {
  folge(docEdit({ pfad: 'main.tex' }))
  const [datei] = readdirSync(join(daten, 'pruefkette'))
  writeFileSync(join(daten, 'pruefkette', datei), 'kein json {')
  const r = hook(finishVorher())
  assert.equal(r.status, 0)
  assert.equal(r.stdout, '')
  assert.equal(r.stderr.trim().split('\n').length, 1, r.stderr)
  assert.match(r.stderr, /spur-pruefkette/)
})

test('ein fehlender oder nicht anlegbarer Datenordner blockiert nicht', () => {
  const datei = join(wurzel, 'eine-datei')
  writeFileSync(datei, 'x')
  for (const env of [{ CLAUDE_PLUGIN_DATA: '' }, { CLAUDE_PLUGIN_DATA: join(datei, 'unter') }]) {
    const a = hook(docEdit({ pfad: 'main.tex' }), env)
    assert.equal(a.status, 0)
    const b = hook(finishVorher(), env)
    assert.equal(b.status, 0)
    assert.equal(b.stdout, '')
    assert.equal(b.stderr.trim().split('\n').length, 1, b.stderr)
  }
})

test('keine Eingabe oder kaputtes JSON blockiert nicht', () => {
  for (const eingabe of ['', 'kein json']) {
    const r = spawnSync('bash', [HOOK], { input: eingabe, encoding: 'utf8', env: { PATH: process.env.PATH, CLAUDE_PLUGIN_DATA: daten } })
    assert.equal(r.status, 0)
    assert.equal(r.stdout, '')
  }
})

test('eine Session-ID mit Pfadzeichen bleibt im Datenordner', () => {
  folge(docEdit({ pfad: 'main.tex' }, '../../ausbruch'))
  assert.deepEqual(readdirSync(daten), ['pruefkette'])
})
