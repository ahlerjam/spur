// Erzeugt die Test-PDFs ohne TeX, damit Seitenzahlen, PageLabels und Zeilenumbrüche exakt feststehen.
// Aufruf auf dem Host: node services/web/modules/spur/test/fixtures/erzeuge-fixtures.mjs
// Für scan.pdf muss pdftocairo (poppler-utils) installiert sein.
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))

function escape(text) {
  return text.replace(/[\\()]/g, '\\$&')
}

function pageContent(lines, size = 12) {
  const body = lines
    .map((line, i) => `1 0 0 1 72 ${720 - i * (size + 4)} Tm (${escape(line)}) Tj`)
    .join('\n')
  return `BT /F1 ${size} Tf\n${body}\nET`
}

function buildPdf({ pages, firstLabel, title, size, images = [] }) {
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
  for (const [i, lines] of pages.entries()) {
    const bild = images[i]
    const bildId =
      bild &&
      add(
        `<< /Type /XObject /Subtype /Image /Width ${bild.breite} /Height ${bild.hoehe} ` +
          `/ColorSpace /DeviceGray /BitsPerComponent 8 /Filter /FlateDecode ` +
          `/DecodeParms << /Predictor 15 /Colors 1 /BitsPerComponent 8 /Columns ${bild.breite} >> ` +
          `/Length ${bild.daten.length} >>\nstream\n${bild.daten.toString('latin1')}\nendstream`
      )
    const content = bild ? 'q 612 0 0 792 0 0 cm /Im1 Do Q' : pageContent(lines, size)
    const contentId = add(
      `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`
    )
    const xobject = bild ? ` /XObject << /Im1 ${bildId} 0 R >>` : ''
    kids.push(
      add(
        `<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 612 792] ` +
          `/Resources << /Font << /F1 ${fontId} 0 R >>${xobject} >> /Contents ${contentId} 0 R >>`
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
// P12: Volltexte für Ausweichwege, falsche PDFs, Deckblätter und Quellen ohne DOI.
const einfach = (datei, titel, autor, saetze) =>
  writeFileSync(join(here, datei), buildPdf({ pages: [[titel, autor], saetze], title: titel }))
einfach('oa001.pdf', 'Green open access in institutional repositories', 'N. Lind', ['Repositories keep accepted manuscripts available.'])
einfach('oa002.pdf', 'Full text mirrors for biomedical literature', 'O. Haddad', ['Mirrors serve the same article from a second host.'])
einfach('oa003.pdf', 'Rate limits on scholarly infrastructure', 'I. Probst', ['A second request after a short pause usually succeeds.'])
einfach('oa004.pdf', 'Sleep and memory consolidation in adolescents', 'T. Novak', ['Adolescents retained more word pairs after a full night of sleep.'])
einfach('bot001.pdf', 'Publisher walls around open articles', 'R. Stein', ['The article is open, the server still refuses automated requests.'])
einfach('soil.pdf', 'Soil microbes in alpine meadows', 'B. Jones', ['Microbial communities differ with altitude.'])
einfach('p12a.pdf', 'Slow-wave sleep and declarative recall in adults', 'A. Rivers', ['Recall of word pairs rose with the share of slow-wave sleep.'])
einfach('p12b.pdf', 'Sleep deprivation and working memory in nurses', 'B. Lindqvist', ['After night shifts the nurses made more errors in the n-back task.'])
// Volltext zur gedrosselten Crossref-DOI (P6). Seit P12 gleicht spur den Titel ab, ein fremdes PDF fiele durch.
einfach('foods2022.pdf', 'Testwerk fuer gedrosseltes Crossref', 'F. Drossel', ['Households discard a share of the food they buy.'])
einfach('report.pdf', 'AI at Work', 'J. Meyer, C. Okafor', ['Firms adopt generative tools unevenly across occupations.'])
// P13: Volltexte zu den Werken mit Band, Heft, Kapitel, Artikelnummer, Entities und Preprints; die Autoren stehen auf
// Seite 1, wie spur sie für den Abgleich liest.
einfach('mikalef.pdf', 'Dynamic capabilities for digital transformation in public agencies', 'Lena Oldemeyer, Patrick Mikalef', ['Agencies that sensed change early adapted their services faster.'])
einfach('morley2021.pdf', 'Ethics as a service: a pragmatic operationalisation of AI ethics', 'Jessica Morley', ['Ethics boards rarely see the systems they approve.'])
einfach('berg2019.pdf', 'Circadian rhythms in shift work', 'Hanna Berg', ['Rotating shifts delay the circadian phase.'])
einfach('reyes2019.pdf', 'Napping habits of university students', 'Tomas Reyes', ['Most students napped twice a week.'])
einfach('asplund2023.pdf', 'Artificial intelligence & firm performance: A review of H2O - 50% more', 'Ida Asplund', ['Firms with AI reported higher margins.'])
einfach('lindgren2022.pdf', 'Mind wandering during online lectures', 'Sofia Lindgren', ['Attention dropped after twenty minutes.'])
einfach('arxiv2402.05555.pdf', 'Replay order in hippocampal place cell sequences', 'Mira Joshi, Kiran Gandhi', ['Sequences replayed in reverse after reward.'])
einfach('arxiv2402.06666.pdf', 'Offline consolidation in recurrent networks', 'Kiran Gandhi and the replay lab', ['Offline phases stabilised earlier tasks.'])
einfach('arxiv2402.07777.pdf', 'Spindle coupling across cortical regions', 'Jonas Muller, Ana Silva', ['Spindles coupled more tightly in frontal regions.'])
einfach('unbekannt.pdf', 'Notes on an unregistered working paper', 'Anonymous', ['The DOI on this paper was never registered.'])
writeFileSync(
  join(here, 'notizen.pdf'),
  buildPdf({ pages: [['Observations from the sleep lab', 'Week 12'], ['Two participants left early.']], title: 'Field notes 2023' })
)
writeFileSync(
  join(here, 'deckblatt.pdf'),
  buildPdf({
    pages: [
      ['University Repository', 'This version is made available under the terms of the archive.', 'Downloaded on 3 March 2025'],
      ['Napping and attention in shift workers', 'L. Brandt'],
      ['Short naps restored attention for about two hours.'],
    ],
    title: 'Repository cover sheet',
  })
)
writeFileSync(
  join(here, 'tampere.pdf'),
  buildPdf({
    pages: Array.from({ length: 14 }, (_, i) =>
      i === 0
        ? ['Generative AI adoption in a large enterprise', 'Aino Virtanen', "Master's thesis", 'Tampere University, 2024']
        : i === 11
          ? ['Employees used the assistant mainly for drafting and summarising.', `Thesis page ${i + 1}.`]
          : [`Thesis page ${i + 1}.`, 'Interviews were coded in two rounds.']
    ),
    title: 'Generative AI adoption in a large enterprise',
  })
)

// Ein Scan: Seite 1 ist nur ein Bild mit dem bekannten Satz (keine Textebene), Seite 2 ist leer.
// Das Bild entsteht, indem pdftocairo eine Textseite in Graustufen rastert; die IDAT-Daten der PNG
// gehen mit PNG-Prädiktor unverändert als FlateDecode-Bild ins PDF.
function graustufenBild(lines) {
  const ordner = mkdtempSync(join(tmpdir(), 'spur-scan-'))
  try {
    writeFileSync(join(ordner, 'text.pdf'), buildPdf({ pages: [lines], title: 'Vorlage', size: 18 }))
    execFileSync('pdftocairo', ['-png', '-gray', '-singlefile', '-r', '150', join(ordner, 'text.pdf'), join(ordner, 'bild')])
    const png = readFileSync(join(ordner, 'bild.png'))
    const idat = []
    let breite
    let hoehe
    for (let pos = 8; pos < png.length; ) {
      const laenge = png.readUInt32BE(pos)
      const typ = png.toString('latin1', pos + 4, pos + 8)
      const daten = png.subarray(pos + 8, pos + 8 + laenge)
      if (typ === 'IHDR') {
        breite = daten.readUInt32BE(0)
        hoehe = daten.readUInt32BE(4)
        if (daten[8] !== 8 || daten[9] !== 0 || daten[12] !== 0) {
          throw new Error('pdftocairo lieferte keine 8-Bit-Graustufen-PNG ohne Interlacing')
        }
      }
      if (typ === 'IDAT') idat.push(daten)
      pos += 12 + laenge
    }
    return { breite, hoehe, daten: Buffer.concat(idat) }
  } finally {
    rmSync(ordner, { recursive: true, force: true })
  }
}

const SCAN = ['Scanned field notes', '', 'Short naps restore attention in night shift workers.', 'The effect lasted for about two hours.']
writeFileSync(
  join(here, 'scan.pdf'),
  buildPdf({ pages: [[], []], title: 'Scan', images: [graustufenBild(SCAN)] })
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
      ['Sleep-like replay improves memory consolidation', 'in artificial neural networks', 'Kiran Gandhi, Mira Joshi', 'arXiv:2401.01234'],
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
// P14: Seitenangaben ohne PageLabels. gandhi2024 trägt auch im Text keine Seitenzahlen (Preprint), weber2018 unten
// allein die gedruckte Zahl 41 bis 52, klein2020 nur vier einzelne Zahlen mit zwei verschiedenen Versätzen.
const absatz = (thema, n) => [`${thema}, part ${String.fromCharCode(64 + n)}.`, 'The analysis follows the same protocol throughout.']
writeFileSync(
  join(here, 'gandhi2024.pdf'),
  buildPdf({
    pages: Array.from({ length: 8 }, (_, i) =>
      i === 5 ? ['Replay strengthens memory traces.', ...absatz('Replay', i + 1)] : absatz('Replay', i + 1)
    ),
    title: 'Replay in artificial neural networks',
  })
)
writeFileSync(
  join(here, 'weber2018.pdf'),
  buildPdf({
    pages: Array.from({ length: 12 }, (_, i) => [
      ...(i === 2 ? ['Bureaucracies codify routines in written rules.'] : []),
      ...absatz('Administration', i + 1),
      String(41 + i),
    ]),
    title: 'Verwaltung und Routinen',
  })
)
writeFileSync(
  join(here, 'klein2020.pdf'),
  buildPdf({
    pages: Array.from({ length: 10 }, (_, i) => [
      ...(i === 3 ? ['Small teams share knowledge informally.'] : []),
      ...absatz('Teams', i + 1),
      ...({ 1: ['12'], 2: ['13'], 5: ['100'], 6: ['101'] }[i] ?? []),
    ]),
    title: 'Teams and knowledge',
  })
)
