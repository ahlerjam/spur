// node --test tools/tests/setup.test.mjs
// Läuft ohne Terminal: SPUR_SETUP_TEST_STDIN=1 liefert die Antworten per Pipe, SPUR_SETUP_TROCKEN=1 lässt Docker aus.
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, existsSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, test } from 'node:test'

const SKRIPT = new URL('../setup.sh', import.meta.url).pathname
const MAKEFILE = readFileSync(new URL('../../Makefile', import.meta.url), 'utf8')
const PASSWORT = 'geheim123'
const ANTWORTEN = [
  'https://spur.example.org',
  'j',
  'spur@example.org',
  'smtp.example.org',
  '587',
  'spur@example.org',
  PASSWORT,
  'admin@example.org',
].join('\n') + '\n'

let ordner
before(() => { ordner = mkdtempSync(join(tmpdir(), 'spur-setup-')) })
after(() => rmSync(ordner, { recursive: true, force: true }))

const ausfuehren = (eingabe, extra = {}) =>
  spawnSync('bash', [SKRIPT], {
    cwd: ordner,
    input: eingabe,
    encoding: 'utf8',
    env: { ...process.env, SPUR_SETUP_TROCKEN: '1', ...extra },
  })

const hash = () => createHash('sha256').update(readFileSync(join(ordner, '.env'))).digest('hex')

test('Makefile kennt das Ziel setup und ruft das Skript auf', () => {
  assert.match(MAKEFILE, /^\.PHONY:.*\bsetup\b/m)
  assert.match(MAKEFILE, /^setup:\n\t@?\.\/tools\/setup\.sh$/m)
})

test('ohne Terminal bricht setup mit Hinweis ab und ändert nichts', () => {
  const r = ausfuehren('', { SPUR_SETUP_TEST_STDIN: '' })
  assert.notEqual(r.status, 0)
  assert.match(r.stderr, /Terminal/)
  assert.deepEqual(readdirSync(ordner), [])
})

test('Antworten landen in .env mit Rechten 600, das Passwort erscheint nie in der Ausgabe', () => {
  const r = ausfuehren(ANTWORTEN, { SPUR_SETUP_TEST_STDIN: '1' })
  assert.equal(r.status, 0, r.stderr)
  assert.ok(!(r.stdout + r.stderr).includes(PASSWORT))

  const datei = join(ordner, '.env')
  assert.equal(statSync(datei).mode & 0o777, 0o600)
  const zeilen = readFileSync(datei, 'utf8').trim().split('\n')
  assert.match(zeilen.find(z => z.startsWith('OVERLEAF_INVITE_TOKEN_SECRET=')) ?? '', /^[^=]+=.{20,}$/)
  for (const erwartet of [
    'SPUR_URL=https://spur.example.org',
    'OVERLEAF_SECURE_COOKIE=true',
    'OVERLEAF_EMAIL_FROM_ADDRESS=spur@example.org',
    'OVERLEAF_EMAIL_SMTP_HOST=smtp.example.org',
    'OVERLEAF_EMAIL_SMTP_PORT=587',
    'OVERLEAF_EMAIL_SMTP_USER=spur@example.org',
    `OVERLEAF_EMAIL_SMTP_PASS=${PASSWORT}`,
    'CROSSREF_MAILTO=admin@example.org',
    'UNPAYWALL_EMAIL=admin@example.org',
  ]) assert.ok(zeilen.includes(erwartet), erwartet)
  assert.deepEqual(readdirSync(ordner), ['.env'])
})

test('zweiter Aufruf fragt nach und lässt .env bei „nein“ unverändert', () => {
  const vorher = hash()
  const r = ausfuehren('nein\n', { SPUR_SETUP_TEST_STDIN: '1' })
  assert.equal(r.status, 0, r.stderr)
  assert.match(r.stdout, /Vorhandene Werte ändern\?/)
  assert.ok(!(r.stdout + r.stderr).includes(PASSWORT))
  assert.equal(hash(), vorher)
  assert.deepEqual(readdirSync(ordner), ['.env'])
})

test('bei „ja“ gelten Vorgaben, ein leeres Passwort behält das vorhandene', () => {
  const r = ausfuehren('j\nhttp://localhost:8080\nj\n\n\n\n\n\n\n', { SPUR_SETUP_TEST_STDIN: '1' })
  assert.equal(r.status, 0, r.stderr)
  assert.ok(!(r.stdout + r.stderr).includes(PASSWORT))
  const inhalt = readFileSync(join(ordner, '.env'), 'utf8')
  assert.match(inhalt, /^SPUR_URL=http:\/\/localhost:8080$/m)
  assert.doesNotMatch(inhalt, /OVERLEAF_SECURE_COOKIE/)
  assert.match(inhalt, new RegExp(`^OVERLEAF_EMAIL_SMTP_PASS=${PASSWORT}$`, 'm'))
  assert.match(inhalt, /^OVERLEAF_EMAIL_SMTP_HOST=smtp\.example\.org$/m)
  assert.equal(statSync(join(ordner, '.env')).mode & 0o777, 0o600)
  assert.ok(existsSync(join(ordner, '.env')))
})
