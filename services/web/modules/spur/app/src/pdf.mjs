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

export async function seitenBild(pfad, seite, ziel) {
  await ausfuehren(
    'pdftocairo',
    ['-png', '-singlefile', '-r', '110', '-f', String(seite), '-l', String(seite), pfad, ziel],
    GRENZEN
  )
  return `${ziel}.png`
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
