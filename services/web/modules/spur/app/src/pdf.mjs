import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const ausfuehren = promisify(execFile)
const GRENZEN = { timeout: 120000, maxBuffer: 256 * 1024 * 1024 }

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

export async function seitenzahl(pfad) {
  const { stdout } = await ausfuehren('pdfinfo', [pfad], GRENZEN)
  return Number(/^Pages:\s+(\d+)/m.exec(stdout)?.[1] ?? 0)
}
