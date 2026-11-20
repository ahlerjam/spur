import _ from 'lodash'
import { execFile } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import Path from 'node:path'
import { promisify } from 'node:util'

const ausfuehren = promisify(execFile)
const GRENZEN = { timeout: 120000, maxBuffer: 256 * 1024 * 1024 }
// Ein Thread je Tesseract-Lauf: OpenMP belegte sonst alle Kerne des Web-Containers, und die
// (höchstens zwei, siehe QuellenManager) parallelen Läufe überbuchten sich gegenseitig.
const TESSERACT = { ...GRENZEN, env: { ...process.env, OMP_THREAD_LIMIT: '1' } }

export async function seitenTexte(pfad) {
  const { stdout } = await ausfuehren('pdftotext', ['-raw', '-enc', 'UTF-8', pfad, '-'], GRENZEN)
  const seiten = stdout.split('\f')
  // pdftotext schließt jede Seite mit einem Seitenvorschub ab.
  seiten.pop()
  return seiten
}

// Liefert den Versatz gedruckte Seite minus PDF-Seite, wenn die PageLabels dezimal beginnen.
export async function versatzAusLabels(pfad) {
  const { stdout } = await ausfuehren(
    'qpdf',
    [pfad, '--json', '--json-key=pagelabels'],
    GRENZEN
  )
  const dezimal = (JSON.parse(stdout).pagelabels ?? []).filter(l => l.label?.['/S'] === '/D')
  // Mehrere dezimale Abschnitte (z. B. Teil-Nummerierung) passen in keinen einzelnen Versatz.
  if (dezimal.length !== 1) return null
  const [eintrag] = dezimal
  return (eintrag.label['/St'] ?? 1) - (eintrag.index + 1)
}

const SEITENZAHL = /^\d{1,5}$/
const ERSTE_SEITEN = 30
const MIN_SEITEN = 5
const MIN_ANTEIL = 0.8

// Rückfall für PDFs ohne PageLabels: eine arabische Zahl allein in der ersten oder letzten Zeile gilt als gedruckte
// Seitenzahl. Den Versatz gibt es nur, wenn genug Seiten ihn übereinstimmend ergeben; ein falscher wäre schlimmer als
// keiner, weil er still ein falsches „stimmt“ erzeugte.
export function versatzAusSeitentext(texte) {
  const haeufigkeit = new Map()
  let erkannt = 0
  for (const [i, text] of texte.slice(0, ERSTE_SEITEN).entries()) {
    const zeilen = text.split('\n').map(z => z.trim()).filter(Boolean)
    const zahl = [zeilen[0], zeilen.at(-1)].find(z => SEITENZAHL.test(z ?? ''))
    if (!zahl) continue
    erkannt++
    const versatz = Number(zahl) - (i + 1)
    haeufigkeit.set(versatz, (haeufigkeit.get(versatz) ?? 0) + 1)
  }
  const [versatz, anzahl] = [...haeufigkeit].sort((a, b) => b[1] - a[1])[0] ?? []
  return anzahl >= MIN_SEITEN && anzahl >= MIN_ANTEIL * erkannt ? versatz : null
}

// Ohne Angabe mit 110 dpi; mit breite genau so viele Pixel breit, mit kante höchstens so viele Pixel an der längsten
// Seite (die andere folgt dem Seitenformat). pdftocairo rundet die Pixel auf (-scale-to 1600 ergibt 1601), daher die
// Auflösung mit einem halben Pixel Abstand zur Grenze.
export async function seitenBild(pfad, seite, ziel, { breite = null, kante = null } = {}) {
  let aufloesung = ['-r', '110']
  if (breite) aufloesung = ['-scale-to-x', String(breite), '-scale-to-y', '-1']
  else if (kante) {
    const groesse = await seitenGroesse(pfad, seite)
    aufloesung = ['-r', String(((kante - 0.5) * 72) / Math.max(groesse.breite, groesse.hoehe))]
  }
  await ausfuehren(
    'pdftocairo',
    ['-png', '-singlefile', ...aufloesung, '-f', String(seite), '-l', String(seite), pfad, ziel],
    GRENZEN
  )
  return `${ziel}.png`
}

// Ausschnitt einer Seite als PNG; x, y, breite und hoehe sind Anteile der Seite (0 bis 1, y von oben).
export async function ausschnittBild(pfad, seite, ziel, { x, y, breite, hoehe }, dpi = 300) {
  const groesse = await seitenGroesse(pfad, seite)
  const px = punkte => Math.round((punkte * dpi) / 72)
  const rechteck = [
    ['-x', px(x * groesse.breite)],
    ['-y', px(y * groesse.hoehe)],
    ['-W', px(breite * groesse.breite)],
    ['-H', px(hoehe * groesse.hoehe)],
  ].flatMap(([name, wert]) => [name, String(wert)])
  await ausfuehren('pdftocairo', ['-png', '-singlefile', '-r', String(dpi), ...rechteck, '-f', String(seite), '-l', String(seite), pfad, ziel], GRENZEN)
  return `${ziel}.png`
}

const ENTITAETEN = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }
const entschluesseln = text => text.replace(/&(amp|lt|gt|quot|apos);/g, (_m, name) => ENTITAETEN[name])
const runden = zahl => Math.round(zahl * 1000) / 1000

// Zeilen aus `pdftotext -bbox-layout`: Lage in Punkten (x, y oben links, Breite b, Höhe h) und Text.
export function textEbeneAuswerten(xml) {
  const seite = xml.match(/<page width="([\d.]+)" height="([\d.]+)"/)
  const zeilen = [...xml.matchAll(/<line xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">([\s\S]*?)<\/line>/g)]
    .map(([, x0, y0, x1, y1, inhalt]) => ({
      x: runden(Number(x0)),
      y: runden(Number(y0)),
      b: runden(x1 - x0),
      h: runden(y1 - y0),
      text: [...inhalt.matchAll(/<word[^>]*>([\s\S]*?)<\/word>/g)].map(w => entschluesseln(w[1])).join(' '),
    }))
    .filter(zeile => zeile.text)
  return { breite: Number(seite[1]), hoehe: Number(seite[2]), zeilen }
}

export async function textEbene(pfad, seite) {
  const { stdout } = await ausfuehren(
    'pdftotext',
    ['-bbox-layout', '-enc', 'UTF-8', '-f', String(seite), '-l', String(seite), pfad, '-'],
    GRENZEN
  )
  return textEbeneAuswerten(stdout)
}

// Text einer Tesseract-TSV-Ausgabe: Wörter je Zeile, Leerzeile zwischen Blöcken und Absätzen.
// Die Konfidenz ist der gerundete Mittelwert über alle Wörter (0 bis 100), ohne Wörter null.
export function tsvAuswerten(tsv) {
  const absaetze = []
  const konfidenzen = []
  let absatz = null
  let zeile = null
  for (const roh of tsv.split('\n').slice(1)) {
    const spalten = roh.split('\t')
    const [level, , block, par, line] = spalten
    const conf = Number(spalten[10])
    const wort = spalten[11]?.trim()
    if (level !== '5' || !wort) continue
    const absatzKey = `${block}.${par}`
    if (absatz?.key !== absatzKey) {
      absatz = { key: absatzKey, zeilen: [] }
      absaetze.push(absatz)
      zeile = null
    }
    if (zeile?.key !== line) {
      zeile = { key: line, woerter: [] }
      absatz.zeilen.push(zeile)
    }
    zeile.woerter.push(wort)
    if (conf >= 0) konfidenzen.push(conf)
  }
  const text = absaetze
    .map(a => a.zeilen.map(z => z.woerter.join(' ')).join('\n'))
    .join('\n\n')
  const konfidenz = konfidenzen.length ? Math.round(_.mean(konfidenzen)) : null
  return { text, konfidenz }
}

// Rastert eine PDF-Seite mit 300 dpi und lässt Tesseract (Deutsch und Englisch) den Text lesen.
export async function ocrSeite(pfad, seite) {
  const ordner = await mkdtemp(Path.join(tmpdir(), 'spur-ocr-'))
  try {
    const bild = Path.join(ordner, 'seite')
    await ausfuehren(
      'pdftoppm',
      ['-png', '-gray', '-r', '300', '-singlefile', '-f', String(seite), '-l', String(seite), pfad, bild],
      GRENZEN
    )
    const { stdout } = await ausfuehren(
      'tesseract',
      [`${bild}.png`, 'stdout', '-l', 'deu+eng', 'tsv'],
      TESSERACT
    )
    return tsvAuswerten(stdout)
  } finally {
    await rm(ordner, { recursive: true, force: true })
  }
}

const ZEITMARKE = /^(\d{2}:)?(\d{2}):(\d{2})[.,]\d{3}\s+-->/

export function vttSeiten(text) {
  const abschnitte = []
  for (const block of text.replace(/\r/g, '').split(/\n{2,}/)) {
    const zeilen = block.split('\n')
    const i = zeilen.findIndex(z => ZEITMARKE.test(z))
    if (i < 0) continue
    const inhalt = zeilen.slice(i + 1).join(' ').trim()
    if (inhalt) abschnitte.push({ label: zeilen[i].split(/[.,]/)[0], text: inhalt })
  }
  return abschnitte
}

// Titel aus den Dokumenteigenschaften des PDFs, sonst null.
export async function titelFeld(pfad) {
  const { stdout } = await ausfuehren('pdfinfo', ['-enc', 'UTF-8', pfad], GRENZEN)
  return /^Title:[ \t]+(.+)$/m.exec(stdout)?.[1].trim() ?? null
}

// Größe einer Seite in Punkten, gedreht wie angezeigt.
export async function seitenGroesse(pfad, seite) {
  const { stdout } = await ausfuehren('pdfinfo', ['-f', String(seite), '-l', String(seite), pfad], GRENZEN)
  const [, b, h] = /^Page\s+\d+ size:\s+([\d.]+) x ([\d.]+)/m.exec(stdout)
  const rot = Number(/^Page\s+\d+ rot:\s+(\d+)/m.exec(stdout)?.[1] ?? 0)
  return rot % 180 ? { breite: Number(h), hoehe: Number(b) } : { breite: Number(b), hoehe: Number(h) }
}

export async function seitenzahl(pfad) {
  const { stdout } = await ausfuehren('pdfinfo', [pfad], GRENZEN)
  return Number(/^Pages:\s+(\d+)/m.exec(stdout)?.[1] ?? 0)
}
