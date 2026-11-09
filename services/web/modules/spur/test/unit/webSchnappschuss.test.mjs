import { createServer } from 'node:http'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { abrufen, adresseGesperrt, htmlZuText } from '../../app/src/WebSchnappschuss.mjs'
import { fehlerVon } from './hilfen/fehler.mjs'

const SEITE = `<!doctype html><html><head><meta charset="utf-8"><title>Schlaf &amp; Schicht</title>
<style>p { color: red }</style><script>alert('x')</script></head>
<body><nav>Menü</nav><h1>Überschrift</h1><p>Erster&nbsp;Absatz mit &lt;Klammern&gt; und &quot;Zitat&quot;.</p>
<p>Zweiter<br>Absatz</p><ul><li>Eins</li><li>Zwei</li></ul><noscript>ohne JS</noscript></body></html>`

let server
let basis
let antworten

beforeAll(async () => {
  server = createServer((req, res) => {
    const antwort = antworten[req.url] ?? { status: 404, body: 'weg' }
    res.writeHead(antwort.status ?? 200, antwort.kopf ?? { 'Content-Type': 'text/html; charset=utf-8' })
    if (antwort.haengen) return
    res.end(antwort.body)
  })
  await new Promise(r => server.listen(0, '127.0.0.1', r))
  basis = `http://127.0.0.1:${server.address().port}`
})
afterAll(() => server.close())

describe('htmlZuText', () => {
  it('liefert Titel und lesbaren Text ohne Skripte, Stile und Markup, mit Absätzen', () => {
    const { titel, text } = htmlZuText(SEITE)
    expect(titel).toBe('Schlaf & Schicht')
    expect(text).toBe('Menü\n\nÜberschrift\n\nErster Absatz mit <Klammern> und "Zitat".\n\nZweiter\nAbsatz\n\nEins\nZwei')
  })

  it('kommt ohne Titel aus', () => {
    expect(htmlZuText('<p>Nur Text</p>')).toEqual({ titel: null, text: 'Nur Text' })
  })
})

describe('adresseGesperrt', () => {
  it.each([
    '127.0.0.1', '10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.1.1', '169.254.169.254',
    '100.64.0.1', '0.0.0.0', '224.0.0.1', '::1', '::', 'fe80::1', 'fd00::1', '::ffff:127.0.0.1', 'ff02::1',
    // Gemappte und übersetzte IPv4-Adressen, auch in Hex-Schreibweise (so normalisiert sie new URL).
    '::ffff:7f00:1', '::ffff:a9fe:a9fe', '64:ff9b::7f00:1', '2002:7f00:1::', '::7f00:1',
    '64:ff9b:1::1', '100::1', '2001:0:4136:e378:8000:63bf:3fff:fdd2', '2001:db8::1', 'ff00::1', '192.0.0.1', '198.18.0.1', '198.19.255.255',
  ])('sperrt %s', ip => {
    expect(adresseGesperrt(ip)).toBe(true)
  })

  it.each(['93.184.216.34', '172.32.0.1', '2606:4700::1', '::ffff:93.184.216.34'])('erlaubt %s', ip => {
    expect(adresseGesperrt(ip)).toBe(false)
  })
})

describe('abrufen', () => {
  // Der Testserver lauscht lokal; die Sperre selbst prüft der Block „sperrt Adressen …“.
  const offen = { gesperrt: () => false }

  it('holt eine Seite mit Titel, Text, HTML und der endgültigen Adresse nach Umleitungen', async () => {
    antworten = {
      '/alt': { status: 301, kopf: { Location: '/seite' } },
      '/seite': { body: SEITE },
    }
    const ergebnis = await abrufen(`${basis}/alt`, offen)
    expect(ergebnis).toMatchObject({ titel: 'Schlaf & Schicht', url: `${basis}/seite`, html: SEITE })
    expect(ergebnis.text).toContain('Erster Absatz')
  })

  it('liest Latin-1, wenn der Server es angibt', async () => {
    antworten = { '/latin': { kopf: { 'Content-Type': 'text/html; charset=iso-8859-1' }, body: Buffer.from('<p>Gr\xfc\xdfe</p>', 'latin1') } }
    expect((await abrufen(`${basis}/latin`, offen)).text).toBe('Grüße')
  })

  it.each([
    ['ohne Schema', 'example.org/seite'],
    ['mit falschem Schema', 'ftp://example.org/datei'],
    ['mit Zugangsdaten', 'http://nutzer:geheim@example.org/'],
    ['zu lang', `https://example.org/${'a'.repeat(2100)}`],
    ['kein Text', 42],
  ])('lehnt eine Adresse %s ab', async (_name, url) => {
    expect(await fehlerVon(abrufen(url, offen))).toMatchObject({ status: 422, typ: 'adresse_ungueltig' })
  })

  it('sperrt Adressen im lokalen Netz, auch als Ziel einer Umleitung', async () => {
    expect(await fehlerVon(abrufen(`${basis}/seite`))).toMatchObject({ status: 422, typ: 'adresse_gesperrt' })
    expect(await fehlerVon(abrufen('http://localhost:1/'))).toMatchObject({ typ: 'adresse_gesperrt' })
    for (const url of ['http://[::ffff:127.0.0.1]:1/', 'http://[::ffff:169.254.169.254]/', 'http://[::1]:1/']) {
      expect(await fehlerVon(abrufen(url))).toMatchObject({ typ: 'adresse_gesperrt' })
    }
    antworten = { '/weiter': { status: 302, kopf: { Location: 'http://169.254.169.254/latest' } } }
    // Der erste Schritt geht an den Testserver, das Ziel der Umleitung prüft die Sperre erneut.
    const nurErster = { gesperrt: ip => ip === '169.254.169.254' }
    expect(await fehlerVon(abrufen(`${basis}/weiter`, nurErster))).toMatchObject({ typ: 'adresse_gesperrt' })
  })

  it('meldet „Seite nicht erreichbar“ bei unbekanntem Host, Verbindungsfehler, Fehlerstatus und Zeitüberschreitung', async () => {
    antworten = { '/haengt': { haengen: true } }
    for (const url of ['http://nicht-erreichbar.invalid/', 'http://127.0.0.1:1/', `${basis}/gibt-es-nicht`]) {
      expect(await fehlerVon(abrufen(url, offen))).toMatchObject({ status: 502, typ: 'seite_nicht_erreichbar' })
    }
    expect(await fehlerVon(abrufen(`${basis}/haengt`, { ...offen, zeitMs: 200 }))).toMatchObject({ typ: 'seite_nicht_erreichbar' })
  })

  it('folgt höchstens fünf Umleitungen', async () => {
    antworten = Object.fromEntries(Array.from({ length: 7 }, (_, i) => [`/r${i}`, { status: 302, kopf: { Location: `/r${i + 1}` } }]))
    expect(await fehlerVon(abrufen(`${basis}/r0`, offen))).toMatchObject({ typ: 'seite_nicht_erreichbar' })
  })

  it('nimmt nur HTML und Text an und begrenzt die Größe', async () => {
    antworten = {
      '/bild': { kopf: { 'Content-Type': 'image/png' }, body: 'png' },
      '/gross': { body: 'x'.repeat(5 * 1024 * 1024 + 1) },
    }
    expect(await fehlerVon(abrufen(`${basis}/bild`, offen))).toMatchObject({ status: 415, typ: 'keine_webseite' })
    expect(await fehlerVon(abrufen(`${basis}/gross`, offen))).toMatchObject({ status: 413, typ: 'seite_zu_gross' })
  })
})
