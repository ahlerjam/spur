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
        // P17: Adressen aus der Antwort sind fremde Daten: kein file://, keine curl-Muster wie [1-3].
        if (doi === '10.1234/fake.datei') {
          writeFileSync(join(arbeit, 'geheim.pdf'), PDF)
          return json(res, 200, { oa_locations: [{ host_type: 'repository', url_for_pdf: `file://${join(arbeit, 'geheim.pdf')}` }] })
        }
        if (doi === '10.1234/fake.muster') {
          return json(res, 200, { oa_locations: [{ host_type: 'repository', url_for_pdf: `${basis}/verlag/[1-3].pdf` }] })
        }
        // P17: Der Verlag liefert HTML (Bot-Schutz), das Repositorium das PDF; Unpaywall nennt den Verlag zuerst.
        if (doi === '10.1234/fake.repo') {
          const verlag = { host_type: 'publisher', url_for_pdf: `${basis}/verlag/seite.html`, license: null }
          const repo = { host_type: 'repository', url_for_pdf: `${basis}/repo/b.pdf`, license: 'cc-by' }
          return json(res, 200, { best_oa_location: verlag, oa_locations: [verlag, repo] })
        }
        if (doi === '10.1234/fake.allehtml') {
          const verlag = { host_type: 'publisher', url_for_pdf: `${basis}/verlag/seite.html`, license: null }
          const repo = { host_type: 'repository', url_for_pdf: `${basis}/repo/seite.html`, license: null }
          return json(res, 200, { best_oa_location: verlag, oa_locations: [verlag, repo] })
        }
        return json(res, 404, { error: true })
      }
      if (url.pathname === '/europepmc/webservices/rest/search') {
        const doi = /^DOI:"(.*)"$/.exec(url.searchParams.get('query') ?? '')?.[1]
        if (doi === '10.1234/fake.pmc' || doi === '10.1234/fake.allehtml' || doi === '10.1002/(SICI)fake&x;2-I') {
          return json(res, 200, {
            hitCount: 1,
            resultList: { result: [{ doi, pmcid: 'PMC123', fullTextUrlList: { fullTextUrl: [
              { availability: 'Open access', availabilityCode: 'OA', documentStyle: 'html', site: 'Europe_PMC', url: `${basis}/pmc/seite.html` },
              { availability: 'Open access', availabilityCode: 'OA', documentStyle: 'pdf', site: 'Europe_PMC', url: doi !== '10.1234/fake.allehtml' ? `${basis}/pmc/c.pdf` : `${basis}/pmc/seite.html` },
            ] } }] },
          })
        }
        return json(res, 200, { hitCount: 0, resultList: { result: [] } })
      }
      if (url.pathname === '/repo/b.pdf' || url.pathname === '/pmc/c.pdf') {
        res.writeHead(200, { 'content-type': 'application/pdf' })
        return res.end(PDF)
      }
      if (url.pathname === '/repo/seite.html' || url.pathname === '/pmc/seite.html') {
        res.writeHead(200, { 'content-type': 'text/html' })
        return res.end('<html><body>Checking your browser</body></html>')
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
        uploads.push({ pfad: url.pathname, datei, doi: feld('doi'), titel: feld('titel'), ...Object.fromEntries(['autoren', 'jahr', 'art', 'institution', 'url'].map(n => [n, feld(n)])), ...(feld('projektdatei') && { projektdatei: feld('projektdatei') }) })
        if (url.pathname === '/upload/abgelaufen') {
          return json(res, 410, { fehler: 'link_abgelaufen', detail: 'Link abgelaufen' })
        }
        if (datei === 'b.pdf') return json(res, 200, { datei, status: 'vorhanden', quelle_id: QUELLE_ID })
        if (feld('projektdatei') === 'abbildungen/da.pdf') return json(res, 409, { title: 'konflikt', detail: 'Die Datei abbildungen/da.pdf gibt es im Projekt schon.' })
        if (feld('projektdatei')) return json(res, 200, { datei, status: 'angelegt', pfad: feld('projektdatei') })
        if (datei === 'scan.pdf') return json(res, 200, { datei, status: 'abgelehnt', grund: 'Datei ist keine PDF-Datei' })
        if (datei === 'nirgends.pdf') {
          const metadaten_hinweis = 'Crossref kennt die DOI 10.9999/nirgends.1 nicht. Der .bib-Eintrag ist @misc mit dem Titel; prüfe die DOI und ergänze die Angaben.'
          return json(res, 200, { datei, status: 'angelegt', quelle_id: QUELLE_ID, key: 'nirgends', autoren: 'abweichend', autoren_hinweis: 'Autoren im PDF nicht gefunden – bitte prüfen', metadaten: 'unvollstaendig', metadaten_hinweis })
        }
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
  SPUR_EUROPEPMC_BASE: `${basis}/europepmc`,
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

test('spur-pdf-holen meldet fehlende freie Version mit Exit-Code 1, auch nach Europe PMC', async () => {
  for (const doi of ['10.1234/fake.zu', '10.1234/unbekannt']) {
    anfragen = []
    const r = await laufAsync('spur-pdf-holen', [doi, 'ziel'])
    assert.equal(r.status, 1)
    assert.match(r.stderr, /keine freie Version gefunden/)
    assert.equal(r.stdout, '')
    assert.deepEqual(readdirSync(join(arbeit, 'ziel')), [])
    assert.ok(anfragen.includes('GET /europepmc/webservices/rest/search'), anfragen.join(', '))
  }
})

test('spur-pdf-holen verwirft HTML statt PDF mit Exit-Code 3', async () => {
  const r = await laufAsync('spur-pdf-holen', ['10.1234/fake.html', 'ziel'])
  assert.equal(r.status, 3)
  assert.match(r.stderr, /keine PDF-Datei/)
  assert.equal(r.stdout, '')
  assert.deepEqual(readdirSync(join(arbeit, 'ziel')), [])
})

test('spur-pdf-holen nimmt das Repositorium vor dem Verlag, wenn der Verlag HTML liefert (P17)', async () => {
  const r = await laufAsync('spur-pdf-holen', ['10.1234/fake.repo', 'ziel'])
  assert.equal(r.status, 0, r.stderr)
  assert.equal(r.stdout, 'ziel/10.1234_fake.repo.pdf\n')
  assert.ok(existsSync(join(arbeit, 'ziel/10.1234_fake.repo.pdf')))
  assert.deepEqual(anfragen.filter(a => !a.includes('unpaywall')), ['GET /repo/b.pdf'])
})

test('spur-pdf-holen holt das PDF aus Europe PMC, wenn Unpaywall keinen Fundort kennt (P17)', async () => {
  const r = await laufAsync('spur-pdf-holen', ['10.1234/fake.pmc', 'ziel'])
  assert.equal(r.status, 0, r.stderr)
  assert.equal(r.stdout, 'ziel/10.1234_fake.pmc.pdf\n')
  assert.ok(anfragen.includes('GET /pmc/c.pdf'), anfragen.join(', '))
})

test('spur-pdf-holen lädt keine file://-Adressen und wertet keine curl-Muster aus (P17)', async () => {
  const datei = await laufAsync('spur-pdf-holen', ['10.1234/fake.datei', 'ziel'])
  assert.notEqual(datei.status, 0)
  assert.deepEqual(readdirSync(join(arbeit, 'ziel')), [])
  const muster = await laufAsync('spur-pdf-holen', ['10.1234/fake.muster', 'ziel'])
  assert.notEqual(muster.status, 0)
  assert.deepEqual(anfragen.filter(a => a.startsWith('GET /verlag/')), ['GET /verlag/[1-3].pdf'])
})

test('spur-pdf-holen fragt Europe PMC mit vollständig kodierter DOI (P17)', async () => {
  const r = await laufAsync('spur-pdf-holen', ['10.1002/(SICI)fake&x;2-I', 'ziel'])
  assert.equal(r.status, 0, r.stderr)
  assert.ok(anfragen.includes('GET /pmc/c.pdf'), anfragen.join(', '))
})

test('spur-pdf-holen endet mit „keine PDF-Datei“ und Exit-Code 3, wenn jede Adresse HTML liefert (P17)', async () => {
  const r = await laufAsync('spur-pdf-holen', ['10.1234/fake.allehtml', 'ziel'])
  assert.equal(r.status, 3)
  assert.match(r.stderr, /keine PDF-Datei/)
  assert.deepEqual(['/repo/seite.html', '/verlag/seite.html', '/pmc/seite.html'].map(p => r.stderr.includes(p)), [true, true, true], r.stderr)
  assert.ok(r.stderr.indexOf('/repo/') < r.stderr.indexOf('/verlag/'), r.stderr)
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

test('spur-hochladen gibt für Quellen ohne DOI Autoren, Jahr, Art, Institution und Adresse mit', async () => {
  writeFileSync(join(arbeit, 'report.pdf'), PDF)
  const r = await laufAsync('spur-hochladen', [
    `${basis}/upload/ok`, 'report.pdf', '--titel', 'AI at Work', '--autoren', 'Meyer, Jana; Okafor, Chidi',
    '--jahr', '2023', '--art', 'report', '--institution', 'OECD', '--url', 'https://oecd.example/ai-at-work?a=1&b=2',
  ])
  assert.equal(r.status, 0, r.stderr)
  assert.equal(r.stdout.trim(), `report.pdf: Quelle ${QUELLE_ID}`)
  assert.deepEqual(
    { ...uploads[0], pfad: undefined, datei: undefined },
    { pfad: undefined, datei: undefined, doi: undefined, titel: 'AI at Work', autoren: 'Meyer, Jana; Okafor, Chidi', jahr: '2023', art: 'report', institution: 'OECD', url: 'https://oecd.example/ai-at-work?a=1&b=2' }
  )
})

test('spur-hochladen nennt Hinweise zu Autoren und Metadaten in eigenen Zeilen (P13)', async () => {
  writeFileSync(join(arbeit, 'nirgends.pdf'), PDF)
  const r = await laufAsync('spur-hochladen', [`${basis}/upload/ok`, 'nirgends.pdf', '--doi', '10.9999/nirgends.1'])
  assert.equal(r.status, 0, r.stderr)
  assert.deepEqual(r.stdout.trim().split('\n'), [
    `nirgends.pdf: Quelle ${QUELLE_ID}`,
    'nirgends.pdf: Autoren im PDF nicht gefunden – bitte prüfen',
    'nirgends.pdf: Crossref kennt die DOI 10.9999/nirgends.1 nicht. Der .bib-Eintrag ist @misc mit dem Titel; prüfe die DOI und ergänze die Angaben.',
  ])
})

test('spur-hochladen verlangt zu jeder Option einen Wert', () => {
  const r = lauf('spur-hochladen', [`${basis}/upload/ok`, 'a.pdf', '--art'])
  assert.equal(r.status, 2)
  assert.match(r.stderr, /--art braucht einen Wert/)
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

test('spur-hochladen legt mit --projektdatei eine Datei im Projekt an und meldet ihren Pfad (P15)', async () => {
  writeFileSync(join(arbeit, 'diagramm.pdf'), PDF)
  const r = await laufAsync('spur-hochladen', [`${basis}/upload/ok`, 'diagramm.pdf', '--projektdatei', 'abbildungen/diagramm.pdf'])
  assert.equal(r.status, 0, r.stderr)
  assert.equal(r.stdout.trim(), 'diagramm.pdf: Datei abbildungen/diagramm.pdf')
  assert.equal(uploads[0].projektdatei, 'abbildungen/diagramm.pdf')
})

test('spur-hochladen meldet einen Fehler bei --projektdatei mit dem Grund', async () => {
  writeFileSync(join(arbeit, 'diagramm.pdf'), PDF)
  const r = await laufAsync('spur-hochladen', [`${basis}/upload/ok`, 'diagramm.pdf', '--projektdatei', 'abbildungen/da.pdf'])
  assert.equal(r.status, 1)
  assert.equal(r.stdout.trim(), 'diagramm.pdf: Die Datei abbildungen/da.pdf gibt es im Projekt schon.')
})

test('spur-hochladen nimmt --projektdatei nur für genau eine Datei', () => {
  const r = lauf('spur-hochladen', [`${basis}/upload/ok`, 'a.png', 'b.png', '--projektdatei', 'abbildungen/a.png'])
  assert.equal(r.status, 2)
  assert.match(r.stderr, /--projektdatei gilt für genau eine Datei/)
  assert.equal(uploads.length, 0)
})
