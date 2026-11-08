// Führt eine Test-Suite von Overleaf im Dev-Container aus und gleicht sie mit der Liste bekannter Fehler ab.
// Aufruf über `spur-dev upstream web|frontend|du|vergleich`, nicht direkt.
//   node upstream.mjs <suite> --ergebnis <ordner> [--nur-ergebnis] [datei …]
//   node upstream.mjs liste --ergebnis <ordner>   (nach Läufen auf main, ext-ce und agent)
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import {
  auswerten,
  dateiNormal,
  dateienOhneTests,
  dateienPruefen,
  ersteZeile,
  herkunftBestimmen,
  zusammenfassung,
} from './upstream-auswertung.mjs'

const HIER = path.dirname(new URL(import.meta.url).pathname)
const BEKANNT = path.join(HIER, 'upstream-bekannt.json')
const AUSSCHLUSS = path.join(HIER, 'upstream-ausschluss.json')
const WEB = '/overleaf/services/web'
const DU = '/overleaf/services/document-updater'
const TEST_DB = 'mongodb://mongo/test-overleaf'

const args = process.argv.slice(2)
const befehl = args[0]
const ergebnisOrdner = args[args.indexOf('--ergebnis') + 1]
const nurErgebnis = args.includes('--nur-ergebnis')
// Optional nur einzelne Testdateien, relativ zum Dienst (für schnelle Proben).
const dateien = args
  .slice(1)
  .filter(a => !a.startsWith('--') && a !== ergebnisOrdner)
  .map(dateiNormal)

const lesen = datei => JSON.parse(fs.readFileSync(datei, 'utf8'))
const lesenOder = (datei, standard) => (fs.existsSync(datei) ? lesen(datei) : standard)
const fehlerZeile = t => `  ${ersteZeile(t.fehler).slice(0, 300)}`

function ausfuehren(suite, teil, cwd, befehl, env) {
  const log = path.join(ergebnisOrdner, `${suite}${teil ? `-${teil}` : ''}.log`)
  const fd = fs.openSync(log, 'w')
  const r = spawnSync('yarn', befehl, {
    cwd,
    env: { ...process.env, ...env },
    stdio: ['ignore', fd, fd],
  })
  fs.closeSync(fd)
  return { status: r.status, log }
}

function logEnde(log, zeilen = 15) {
  return fs.readFileSync(log, 'utf8').trimEnd().split('\n').slice(-zeilen).join('\n')
}

// Ein Lauf ohne Ergebnisdatei zählt als ein fehlgeschlagener Test, damit er nie als grün durchgeht.
const ladefehler = (suite, test, log) => [{ suite, datei: '(Suite)', test, status: 'failed', fehler: logEnde(log) }]

// vitest --reporter=json: eine Datei, die nicht lädt, hat keine assertionResults, nur eine message.
function vitestLesen(suite, datei, basis) {
  const roh = lesen(datei)
  const tests = []
  for (const f of roh.testResults) {
    const rel = path.relative(basis, f.name)
    if (f.assertionResults.length === 0 && f.status === 'failed') {
      tests.push({ suite, datei: rel, test: '(Datei lädt nicht)', status: 'failed', fehler: f.message })
      continue
    }
    for (const t of f.assertionResults) {
      tests.push({
        suite,
        datei: rel,
        test: [...t.ancestorTitles, t.title].join(' › '),
        status: t.status === 'passed' ? 'passed' : t.status === 'failed' ? 'failed' : 'skipped',
        fehler: (t.failureMessages || []).join('\n'),
      })
    }
  }
  return tests
}

// mocha --reporter json: Fehler in Hooks stehen nur in failures, nicht in tests.
function mochaLesen(suite, datei, basis) {
  const roh = lesen(datei)
  const eintrag = (t, status) => ({
    suite,
    datei: t.file ? path.relative(basis, t.file) : '(unbekannt)',
    test: t.fullTitle,
    status,
    fehler: t.err?.message ? `${t.err.message}\n${t.err.stack || ''}` : '',
  })
  return [
    ...roh.passes.map(t => eintrag(t, 'passed')),
    ...roh.failures.map(t => eintrag(t, 'failed')),
    ...roh.pending.map(t => eintrag(t, 'skipped')),
  ]
}

function mochaLauf(suite, teil, cwd, mochaArgs, env) {
  const json = `/tmp/${suite}-${teil}.json`
  fs.rmSync(json, { force: true })
  const r = ausfuehren(suite, teil, cwd, ['mocha', ...mochaArgs, '--reporter', 'json', '--reporter-option', `output=${json}`], env)
  if (!fs.existsSync(json)) {
    return ladefehler(suite, `${teil} lädt nicht`, r.log)
  }
  return mochaLesen(suite, json, cwd)
}

function modulTestOrdner() {
  return fs
    .readdirSync(path.join(WEB, 'modules'))
    .map(m => `modules/${m}/test/frontend`)
    .filter(d => fs.existsSync(path.join(WEB, d)))
}

const SUITEN = {
  web(ausgeschlossen) {
    const json = '/tmp/web.json'
    fs.rmSync(json, { force: true })
    const env = { NODE_ENV: 'test', OVERLEAF_CONFIG: '', OVERLEAF_MONGO_URL: TEST_DB, MONGO_CONNECTION_STRING: TEST_DB }
    // `--exclude` auf der Kommandozeile erreicht die projects der Konfiguration nicht; daher eine
    // Konfiguration neben Overleafs eigener, die nur die Ausschlüsse ergänzt (Verzeichnis liegt im Image).
    const config = path.join(WEB, 'vitest.upstream.config.mjs')
    // createRequire statt import: vites Bündeln der Konfiguration bräche das require in Overleafs CJS-Datei.
    fs.writeFileSync(config, `import { createRequire } from 'node:module'
const basis = createRequire(import.meta.url)('./vitest.config.js')
const aus = ${JSON.stringify(ausgeschlossen.map(a => a.datei))}
export default { ...basis, test: { ...basis.test, projects: basis.test.projects.map(p =>
  ({ ...p, test: { ...p.test, exclude: [...(p.test.exclude || []), ...aus] } })) } }
`)
    const r = ausfuehren('web', '', WEB, [
      'vitest', 'run', '--config', config, '--reporter=dot', '--reporter=json', `--outputFile.json=${json}`,
      ...dateien,
    ], env)
    if (!fs.existsSync(json)) {
      return ladefehler('web', 'vitest lädt nicht', r.log)
    }
    return vitestLesen('web', json, WEB)
  },
  frontend(ausgeschlossen) {
    // Die Lezer-Grammatik ist generiert und fehlt in einem frischen Worktree.
    if (!fs.existsSync(path.join(WEB, 'frontend/js/features/source-editor/lezer-latex/latex.terms.mjs'))) {
      const r = ausfuehren('frontend', 'grammatik', WEB, ['run', 'lezer-latex:generate'], {})
      if (r.status !== 0) {
        return ladefehler('frontend', 'Lezer-Grammatik nicht erzeugt', r.log)
      }
    }
    // Wie `yarn run test:frontend`, nur mit JSON-Ausgabe.
    return mochaLauf('frontend', 'mocha', WEB, [
      '--recursive', '--timeout', '5000', '--exit', '--extension', 'js,jsx,mjs,ts,tsx',
      '--require', 'test/frontend/bootstrap.js',
      '--ignore', '**/*.spec.{js,jsx,ts,tsx}', '--ignore', '**/helpers/**/*.{js,jsx,ts,tsx}',
      ...ausgeschlossen.flatMap(a => ['--ignore', a.datei]),
      // Im package.json-Skript expandiert die Shell modules/*/test/frontend; mocha selbst tut es für Ordner nicht.
      ...(dateien.length ? dateien : ['test/frontend', ...modulTestOrdner()]),
    ], { NODE_ENV: 'test', TZ: 'GMT' })
  },
  du(ausgeschlossen) {
    const env = { NODE_ENV: 'test', OVERLEAF_CONFIG: '', MONGO_CONNECTION_STRING: TEST_DB, REDIS_HOST: 'redis-test' }
    const ignorieren = ausgeschlossen.flatMap(a => ['--ignore', a.datei])
    const teil = (name, opts) => {
      const ziel = dateien.length ? dateien.filter(d => d === `test/${name}` || d.startsWith(`test/${name}/`)) : [`test/${name}/js`]
      return ziel.length ? mochaLauf('du', name, DU, ['--recursive', ...opts, '--exit', ...ignorieren, ...ziel], env) : []
    }
    return [...teil('unit', []), ...teil('acceptance', ['--timeout', '15000'])]
  },
}

function minuten(ms) {
  const s = Math.round(ms / 1000)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

// Exit 2 heißt: nichts Verwertbares gelaufen. Das darf nie wie ein grüner Lauf aussehen.
function abbrechen(suite, meldungen) {
  for (const m of meldungen) console.error(`${suite}: FEHLER: ${m}`)
  return 2
}

function suiteLaufen(suite) {
  const start = Date.now()
  const ausgeschlossen = lesenOder(AUSSCHLUSS, []).filter(a => a.suite === suite)
  const basis = suite === 'du' ? DU : WEB
  const falsch = dateienPruefen(suite, dateien, d => fs.existsSync(path.join(basis, d)), ausgeschlossen)
  if (falsch.length) return abbrechen(suite, falsch)
  // Ein altes Ergebnis darf einen gescheiterten Lauf nicht vertreten (der Vergleich liest diese Datei).
  const ergebnis = path.join(ergebnisOrdner, `${suite}.json`)
  fs.rmSync(ergebnis, { force: true })
  const tests = SUITEN[suite](ausgeschlossen)
  if (tests.length === 0) return abbrechen(suite, ['kein einziger Test gelaufen'])
  const ohneTests = dateienOhneTests(dateien, tests)
  if (ohneTests.length) return abbrechen(suite, ohneTests.map(d => `${d}: enthält keine Tests dieser Suite`))
  fs.writeFileSync(ergebnis, JSON.stringify(tests, null, 1))
  if (nurErgebnis) {
    console.log(`${suite}: ${tests.length} Tests in ${minuten(Date.now() - start)} min`)
    return 0
  }
  const bekannt = lesenOder(BEKANNT, { tests: [] }).tests.filter(b => b.suite === suite)
  const a = auswerten(tests, bekannt)
  for (const x of ausgeschlossen) console.log(`ausgeschlossen: ${x.datei} – ${x.grund}`)
  for (const t of a.jetztGruen) console.log(`Hinweis: bekannt, jetzt grün: ${t.datei} › ${t.test}`)
  for (const t of a.neu.slice(0, 30)) {
    console.log(`NEU: ${t.datei} › ${t.test}`)
    console.log(fehlerZeile(t))
  }
  if (a.neu.length > 30) console.log(`… und ${a.neu.length - 30} weitere neue Fehler, siehe ${suite}.json`)
  console.log(`${suite}: Laufzeit ${minuten(Date.now() - start)} min, Protokoll und ${suite}.json in ${process.env.SPUR_PROTOKOLL || ergebnisOrdner}`)
  console.log(`${suite}: ${zusammenfassung(a)}, ausgeschlossen: ${ausgeschlossen.length} Dateien`)
  return a.neu.length > 0 ? 1 : 0
}

function listeSchreiben() {
  const alt = lesenOder(BEKANNT, { tests: [] }).tests
  const ausgeschlossen = lesenOder(AUSSCHLUSS, [])
  const neu = []
  const spur = []
  for (const suite of Object.keys(SUITEN)) {
    const [main, extCe, agent] = ['main', 'ext-ce', 'agent'].map(name =>
      lesenOder(path.join(ergebnisOrdner, name, `${suite}.json`), null)
    )
    // Ohne Ergebnisse aller drei Stände (etwa `vergleich web` auf frischem Cache) bleiben die Einträge.
    if (!main || !extCe || !agent) {
      console.log(`${suite}: nicht auf allen drei Ständen gelaufen, Einträge bleiben unverändert`)
      neu.push(...alt.filter(b => b.suite === suite))
      continue
    }
    const { liste, nurSpur } = herkunftBestimmen(main, extCe, agent, alt, ausgeschlossen)
    neu.push(...liste)
    spur.push(...nurSpur)
  }
  fs.writeFileSync(BEKANNT, JSON.stringify({ tests: neu }, null, 1) + '\n')
  console.log(`Liste bekannter Fehler: ${neu.length} Einträge in tools/tests/upstream-bekannt.json`)
  for (const t of spur) {
    console.log(`NUR AUF SPUR: ${t.suite} ${t.datei} › ${t.test}`)
    console.log(fehlerZeile(t))
  }
  return spur.length > 0 ? 1 : 0
}

if (befehl === 'liste') process.exit(listeSchreiben())
if (!SUITEN[befehl]) {
  console.error('Suite unbekannt; erwartet web, frontend, du oder liste')
  process.exit(2)
}
process.exit(suiteLaufen(befehl))
