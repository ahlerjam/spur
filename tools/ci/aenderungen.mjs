// Pfadregeln der CI: welche Prüfungen ein Pull Request braucht. Einzige Stelle für diese Regeln;
// ci.yml ruft das Skript auf, tools/tests/ci-pfade.test.mjs importiert `bewerten`.
//
// Aufruf in der CI: node tools/ci/aenderungen.mjs
//   Nur bei pull_request wird gespart. Jedes andere Ereignis (workflow_dispatch, Push) und jeder Fehler
//   beim Ermitteln der Dateien ergibt „voll“. Ausgabe: test=voll|leicht und upstream=voll|leicht in
//   $GITHUB_OUTPUT (sonst auf stdout).
import { execFileSync } from 'node:child_process'
import { appendFileSync } from 'node:fs'
import { basename } from 'node:path'
import { fileURLToPath } from 'node:url'

const UPSTREAM_ORDNER = ['services/', 'libraries/', 'tools/tests/']
const LOCKDATEIEN = new Set(['yarn.lock', 'package-lock.json', 'npm-shrinkwrap.json', 'pnpm-lock.yaml'])

const normal = datei => datei.replaceAll('\\', '/').replace(/^\.\//, '')
const istDoku = datei => datei.endsWith('.md') || datei.startsWith('docs/')
const beruehrtUpstream = datei =>
  UPSTREAM_ORDNER.some(ordner => datei.startsWith(ordner)) || LOCKDATEIEN.has(basename(datei))

// Leere Liste heißt: unbekannt, also alles prüfen.
export function bewerten(dateien) {
  const liste = dateien.map(normal).filter(Boolean)
  if (liste.length === 0) return { test: 'voll', upstream: 'voll' }
  return {
    test: liste.every(istDoku) ? 'leicht' : 'voll',
    upstream: liste.some(beruehrtUpstream) ? 'voll' : 'leicht',
  }
}

// Der Checkout eines Pull Requests ist ein Merge-Commit; sein erster Elternteil ist die Basis.
function geaenderteDateien() {
  const aus = execFileSync('git', ['diff', '--name-only', 'HEAD^1', 'HEAD'], { encoding: 'utf8' })
  return aus.split('\n')
}

export function ermitteln(ereignis = process.env.EVENT_NAME, dateien = geaenderteDateien) {
  if (ereignis !== 'pull_request') return { test: 'voll', upstream: 'voll' }
  try {
    return bewerten(dateien())
  } catch (fehler) {
    console.error(`Änderungen nicht ermittelbar, alles läuft: ${fehler.message}`)
    return { test: 'voll', upstream: 'voll' }
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const ergebnis = ermitteln()
  const zeilen = Object.entries(ergebnis).map(([k, v]) => `${k}=${v}\n`).join('')
  process.stdout.write(zeilen)
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, zeilen)
}
