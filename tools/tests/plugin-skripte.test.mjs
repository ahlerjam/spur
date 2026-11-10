// node --test tools/tests/plugin-skripte.test.mjs
// Die Plugin-Skripte laufen gegen einen lokalen HTTP-Fake für Unpaywall, arXiv, Verlag und Upload-Link.
import assert from 'node:assert/strict'
import { execFile, spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import http from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, beforeEach, test } from 'node:test'
import { fileURLToPath } from 'node:url'

const BIN = fileURLToPath(new URL('../../plugins/spur/bin/', import.meta.url))
const PDF = '%PDF-1.4\n1 0 obj\n<<>>\nendobj\n'
const QUELLE_ID = 'a1b2c3d4e5f6a1b2c3d4e5f6'

let server
let basis
let arbeit
let anfragen
let uploads

const json = (res, status, obj) => {
  res.writeHead(status, { 'content-type': 'application/json' })
  res.end(JSON.stringify(obj))
}

before(async () => {
  server = http.createServer((req, res) => {
    const chunks = []
    req.on('data', c => chunks.push(c))
    req.on('end', () => {
      const url = new URL(req.url, 'http://x')
      anfragen.push(`${req.method} ${url.pathname}`)
      if (url.pathname.startsWith('/unpaywall/v2/')) {
        const doi = decodeURIComponent(url.pathname.slice('/unpaywall/v2/'.length))
        if (doi === '10.1234/fake.oa') {
          return json(res, 200, {
            best_oa_location: { url_for_pdf: `${basis}/verlag/a.pdf` },
            oa_locations: [{ url_for_pdf: `${basis}/verlag/a.pdf` }],
          })
        }
        if (doi === '10.1234/fake.html') {
          return json(res, 200, { best_oa_location: { url_for_pdf: `${basis}/verlag/seite.html` } })
        }
        if (doi === '10.1234/fake.zweite') {
          return json(res, 200, {
            best_oa_location: null,
            oa_locations: [{ url_for_pdf: null }, { url_for_pdf: `${basis}/verlag/a.pdf` }],
          })
        }
        if (doi === '10.1234/fake.zu') {
          return json(res, 200, { best_oa_location: null, oa_locations: [] })
        }
        return json(res, 404, { error: true })
      }
      if (url.pathname === '/verlag/a.pdf') {
        res.writeHead(200, { 'content-type': 'application/pdf' })
        return res.end(PDF)
      }
      if (url.pathname === '/verlag/seite.html') {
        res.writeHead(200, { 'content-type': 'text/html' })
        return res.end('<html><body>Bitte Cookies akzeptieren</body></html>')
      }
      if (url.pathname === '/arxiv/pdf/2401.12345') {
        res.writeHead(200, { 'content-type': 'application/pdf' })
        return res.end(PDF)
      }
      if (url.pathname.startsWith('/upload/')) {
        const body = Buffer.concat(chunks).toString('latin1')
        const feld = n => body.match(new RegExp(`name="${n}"\\r\\n\\r\\n([^\\r]*)`))?.[1]
        const datei = body.match(/filename="([^"]*)"/)?.[1]
        uploads.push({ pfad: url.pathname, datei, doi: feld('doi'), titel: feld('titel') })
        if (url.pathname === '/upload/abgelaufen') {
          return json(res, 410, { fehler: 'link_abgelaufen', detail: 'Link abgelaufen' })
        }
        if (datei === 'b.pdf') return json(res, 200, { datei, status: 'vorhanden', quelle_id: QUELLE_ID })
        if (datei === 'scan.pdf') return json(res, 200, { datei, status: 'abgelehnt', grund: 'Datei ist keine PDF-Datei' })
        return json(res, 200, { datei, status: 'angelegt', quelle_id: QUELLE_ID })
      }
      json(res, 404, { fehler: 'nicht_gefunden', detail: 'unbekannt' })
    })
  })
  await new Promise(r => server.listen(0, '127.0.0.1', r))
  basis = `http://127.0.0.1:${server.address().port}`
})

after(() => new Promise(r => server.close(r)))

let tmp
before(() => {
  tmp = mkdtempSync(join(tmpdir(), 'spur-skripte-'))
})
after(() => rmSync(tmp, { recursive: true, force: true }))

// Jeder Test bekommt ein eigenes Arbeitsverzeichnis
beforeEach(() => {
  arbeit = mkdtempSync(join(tmp, 't-'))
  anfragen = []
  uploads = []
})

// spawnSync würde die Event-Loop und damit den Fake blockieren; nur --help läuft synchron
const umgebung = extra => ({
  PATH: process.env.PATH,
  HOME: arbeit,
  TMPDIR: arbeit,
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_CONFIG_SYSTEM: '/dev/null',
  SPUR_UNPAYWALL_BASE: `${basis}/unpaywall`,
  SPUR_ARXIV_BASE: `${basis}/arxiv`,
  UNPAYWALL_EMAIL: 'test@example.org',
  ...extra,
})

const lauf = (skript, args) =>
  spawnSync('bash', [join(BIN, skript), ...args], { cwd: arbeit, encoding: 'utf8', env: umgebung() })

const laufAsync = (skript, args, extra) =>
  new Promise(resolve => {
    execFile('bash', [join(BIN, skript), ...args], { cwd: arbeit, env: umgebung(extra) }, (err, stdout, stderr) =>
      resolve({ status: err ? (err.code ?? 1) : 0, stdout, stderr })
    )
  })

test('--help beider Skripte zeigt den Aufruf', () => {
  const a = lauf('spur-pdf-holen', ['--help'])
  assert.equal(a.status, 0)
  assert.match(a.stdout, /Aufruf: spur-pdf-holen <DOI> \[ziel\]/)
  const b = lauf('spur-hochladen', ['--help'])
  assert.equal(b.status, 0)
  assert.match(b.stdout, /Aufruf: spur-hochladen <link> <datei>/)
})

test('spur-pdf-holen lädt das PDF des Verlags in den Zielordner', async () => {
  const r = await laufAsync('spur-pdf-holen', ['10.1234/fake.oa', 'ziel/'])
  assert.equal(r.status, 0, r.stderr)
  const erwartet = 'ziel/10.1234_fake.oa.pdf'
  assert.equal(r.stdout.trim(), erwartet)
  assert.ok(existsSync(join(arbeit, erwartet)))
  assert.deepEqual(readdirSync(join(arbeit, 'ziel')), ['10.1234_fake.oa.pdf'])
})

test('spur-pdf-holen nimmt die erste oa_location mit PDF-Link, wenn best_oa_location leer ist', async () => {
  const r = await laufAsync('spur-pdf-holen', ['10.1234/fake.zweite', 'ziel'])
  assert.equal(r.status, 0, r.stderr)
  assert.ok(existsSync(join(arbeit, r.stdout.trim())))
})

test('spur-pdf-holen meldet fehlende freie Version', async () => {
  for (const doi of ['10.1234/fake.zu', '10.1234/unbekannt']) {
    const r = await laufAsync('spur-pdf-holen', [doi, 'ziel'])
    assert.notEqual(r.status, 0)
    assert.match(r.stderr, /keine freie Version gefunden/)
    assert.equal(r.stdout, '')
    assert.deepEqual(readdirSync(join(arbeit, 'ziel')), [])
  }
})

test('spur-pdf-holen verwirft HTML statt PDF', async () => {
  const r = await laufAsync('spur-pdf-holen', ['10.1234/fake.html', 'ziel'])
  assert.notEqual(r.status, 0)
  assert.match(r.stderr, /keine PDF-Datei/)
  assert.equal(r.stdout, '')
  assert.deepEqual(readdirSync(join(arbeit, 'ziel')), [])
})

test('spur-pdf-holen holt arXiv-DOIs direkt von arXiv', async () => {
  const r = await laufAsync('spur-pdf-holen', ['10.48550/arXiv.2401.12345', 'ziel'])
  assert.equal(r.status, 0, r.stderr)
  assert.ok(existsSync(join(arbeit, r.stdout.trim())))
  assert.deepEqual(anfragen, ['GET /arxiv/pdf/2401.12345'])
})

test('spur-pdf-holen bricht ohne Mail ab', async () => {
  const r = await laufAsync('spur-pdf-holen', ['10.1234/fake.oa', 'ziel'], { UNPAYWALL_EMAIL: '' })
  assert.notEqual(r.status, 0)
  assert.match(r.stderr, /UNPAYWALL_EMAIL/)
  assert.deepEqual(anfragen, [])
})

test('spur-hochladen lädt jede Datei einzeln hoch und meldet je Datei eine Zeile', async () => {
  writeFileSync(join(arbeit, 'a.pdf'), PDF)
  writeFileSync(join(arbeit, 'b.pdf'), PDF)
  const r = await laufAsync('spur-hochladen', [`${basis}/upload/ok`, 'a.pdf', 'b.pdf', '--doi', '10.1234/fake.oa'])
  assert.equal(r.status, 0, r.stderr)
  assert.deepEqual(r.stdout.trim().split('\n'), [
    `a.pdf: Quelle ${QUELLE_ID}`,
    `b.pdf: schon vorhanden (Quelle ${QUELLE_ID})`,
  ])
  assert.equal(uploads.length, 2)
  assert.deepEqual(uploads.map(u => u.doi), ['10.1234/fake.oa', '10.1234/fake.oa'])
  assert.deepEqual(uploads.map(u => u.datei), ['a.pdf', 'b.pdf'])
})

test('spur-hochladen lädt Dateien mit Komma und Semikolon im Namen als eine Datei', async () => {
  const name = 'Mueller, 2020; final.pdf'
  writeFileSync(join(arbeit, name), PDF)
  const r = await laufAsync('spur-hochladen', [`${basis}/upload/ok`, name])
  assert.equal(r.status, 0, r.stderr)
  assert.deepEqual(uploads.map(u => u.datei), [name])
})

test('spur-hochladen nimmt Optionen vor den Dateien und gibt den Titel mit', async () => {
  writeFileSync(join(arbeit, 'a.pdf'), PDF)
  const r = await laufAsync('spur-hochladen', ['--titel', 'Ein Titel; mit @Zeichen', `${basis}/upload/ok`, 'a.pdf'])
  assert.equal(r.status, 0, r.stderr)
  assert.equal(uploads[0].titel, 'Ein Titel; mit @Zeichen')
})

test('spur-hochladen gibt abgelehnte Dateien mit Grund aus und endet mit Fehler', async () => {
  writeFileSync(join(arbeit, 'a.pdf'), PDF)
  writeFileSync(join(arbeit, 'scan.pdf'), PDF)
  const r = await laufAsync('spur-hochladen', [`${basis}/upload/ok`, 'a.pdf', 'scan.pdf'])
  assert.notEqual(r.status, 0)
  assert.match(r.stdout, new RegExp(`a.pdf: Quelle ${QUELLE_ID}`))
  assert.match(r.stdout, /scan\.pdf: Datei ist keine PDF-Datei/)
})

test('spur-hochladen gibt bei 410 das detail aus und endet mit Fehler', async () => {
  writeFileSync(join(arbeit, 'a.pdf'), PDF)
  const r = await laufAsync('spur-hochladen', [`${basis}/upload/abgelaufen`, 'a.pdf'])
  assert.notEqual(r.status, 0)
  assert.match(r.stdout, /a\.pdf: Link abgelaufen/)
})

test('spur-hochladen meldet fehlende Dateien', async () => {
  const r = await laufAsync('spur-hochladen', [`${basis}/upload/ok`, 'fehlt.pdf'])
  assert.notEqual(r.status, 0)
  assert.match(r.stdout, /fehlt\.pdf: Datei nicht gefunden/)
  assert.equal(uploads.length, 0)
})
