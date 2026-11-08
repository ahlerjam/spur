// Erzeugt die Test-PDFs ohne TeX, damit Seitenzahlen, PageLabels und Zeilenumbrüche exakt feststehen.
// Aufruf auf dem Host: node services/web/modules/spur/test/fixtures/erzeuge-fixtures.mjs
import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))

function escape(text) {
  return text.replace(/[\\()]/g, '\\$&')
}

function pageContent(lines) {
  const body = lines
    .map((line, i) => `1 0 0 1 72 ${720 - i * 16} Tm (${escape(line)}) Tj`)
    .join('\n')
  return `BT /F1 12 Tf\n${body}\nET`
}

function buildPdf({ pages, firstLabel, title }) {
  const objects = []
  const add = body => {
    objects.push(body)
    return objects.length
  }
  const catalogId = add('')
  const pagesId = add('')
  const fontId = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>')
  const infoId = add(`<< /Title (${escape(title)}) >>`)
  const kids = []
  for (const lines of pages) {
    const content = pageContent(lines)
    const contentId = add(
      `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`
    )
    kids.push(
      add(
        `<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 612 792] ` +
          `/Resources << /Font << /F1 ${fontId} 0 R >> >> /Contents ${contentId} 0 R >>`
      )
    )
  }
  objects[pagesId - 1] =
    `<< /Type /Pages /Count ${kids.length} /Kids [${kids.map(k => `${k} 0 R`).join(' ')}] >>`
  const labels = firstLabel
    ? ` /PageLabels << /Nums [0 << /S /D /St ${firstLabel} >>] >>`
    : ''
  objects[catalogId - 1] =
    `<< /Type /Catalog /Pages ${pagesId} 0 R${labels} >>`

  let out = '%PDF-1.5\n'
  const offsets = []
  objects.forEach((body, i) => {
    offsets.push(Buffer.byteLength(out))
    out += `${i + 1} 0 obj\n${body}\nendobj\n`
  })
  const xref = Buffer.byteLength(out)
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  for (const offset of offsets) {
    out += `${String(offset).padStart(10, '0')} 00000 n \n`
  }
  out += `trailer\n<< /Size ${objects.length + 1} /Root ${catalogId} 0 R /Info ${infoId} 0 R >>\n`
  out += `startxref\n${xref}\n%%EOF\n`
  return Buffer.from(out, 'latin1')
}

const filler = n => [
  `Journal of Sleep Research, page ${n}.`,
  'Participants completed the task over two consecutive nights.',
  'Results were analysed with mixed-effects models.',
]

const smith = [
  ['Sleep and Memory', 'A. Smith', 'DOI 10.5555/spur.2024.001', ...filler(345)],
  filler(346),
  [
    'Sleep supports the consolidation of declarative memory.',
    'Memory traces are strengthened during slow-wave sleep',
    'and later integrated into cortical networks.',
    ...filler(347),
  ],
  filler(348),
  [
    'During rest the hippo-',
    'campus replays recent experience.',
    ...filler(349),
  ],
  filler(350),
  filler(351),
  filler(352),
]

const retracted = [
  ['Retracted Findings on Sleep', 'B. Jones', 'DOI 10.5555/spur.retracted'],
  ['Naps improve every kind of memory equally.', ...filler(2)],
]

writeFileSync(
  join(here, 'smith2024.pdf'),
  buildPdf({ pages: smith, firstLabel: 345, title: 'Sleep and Memory' })
)
writeFileSync(
  join(here, 'retracted.pdf'),
  buildPdf({ pages: retracted, title: 'Retracted Findings on Sleep' })
)
writeFileSync(
  join(here, 'scan.pdf'),
  buildPdf({ pages: [[], []], title: 'Scan' })
)
// Freie Volltexte für den Paper-Fake (papers.json).
writeFileSync(
  join(here, 'keller2014.pdf'),
  buildPdf({
    pages: [
      ['Sleep spindles predict overnight memory consolidation', 'M. Keller, T. Ruiz', 'DOI 10.1371/journal.pone.0099999'],
      ['Spindle density correlated with recall after one night.', ...filler(2)],
    ],
    title: 'Sleep spindles predict overnight memory consolidation',
  })
)
writeFileSync(
  join(here, 'arxiv2401.01234.pdf'),
  buildPdf({
    pages: [
      ['Sleep-like replay improves memory consolidation', 'in artificial neural networks', 'arXiv:2401.01234'],
      ['Offline replay reduced catastrophic forgetting.'],
    ],
    title: 'Sleep-like replay improves memory consolidation in artificial neural networks',
  })
)
writeFileSync(
  join(here, 'interview.vtt'),
  `WEBVTT

00:00:01.000 --> 00:00:06.000
Interviewer: How did the night shifts affect your sleep?

00:00:06.500 --> 00:00:12.000
Teilnehmerin: After three weeks I could no longer remember the routines.

00:00:12.500 --> 00:00:18.000
Interviewer: Did declarative memory come back on free days?
`
)
