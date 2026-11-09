// Fake aller Paper-Dienste für Tests (nur mit SPUR_DEV=1). Antwortet im Format der echten APIs
// aus dem Katalog test/fixtures/papers.json, protokolliert jeden Abruf und kann Dienste ausfallen lassen.
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import express from 'express'
import { devSchalterSetzen } from '../schalter.mjs'
import { modellOrdner } from '../semantik/einbetten.mjs'

const FIXTURES = new URL('../../../test/fixtures/', import.meta.url)
const KATALOG = JSON.parse(readFileSync(new URL('papers.json', FIXTURES), 'utf8'))
const CROSSREF = JSON.parse(readFileSync(new URL('crossref.json', FIXTURES), 'utf8'))

const ersetzen = (vorlage, n) => vorlage.replace('{n}', String(n).padStart(2, '0'))
const WERKE = [
  ...KATALOG.werke,
  ...Array.from({ length: KATALOG.serie.anzahl }, (_, i) => ({
    ...KATALOG.serie,
    doi: ersetzen(KATALOG.serie.doi, i + 1),
    openalex: ersetzen(KATALOG.serie.openalex, i + 1),
    titel: ersetzen(KATALOG.serie.titel, i + 1),
    jahr: 2010 + (i % 12),
    frei: false,
    zitiertVon: [],
    zitiert: [],
  })),
]
const nachDoi = doi => WERKE.find(w => w.doi === doi?.toLowerCase())

const zustand = { ausfall: new Set(), protokoll: [] }

function begriffe(anfrage) {
  return (anfrage ?? '')
    .toLowerCase()
    .replace(/\ball:/g, ' ')
    .split(/[^a-z0-9]+/)
    .filter(w => w.length > 2 && w !== 'and')
}

function suche(dienst, anfrage) {
  const woerter = begriffe(anfrage)
  return WERKE.filter(
    w => w.dienste.includes(dienst) && woerter.some(b => w.titel.toLowerCase().includes(b))
  )
}

function invertiert(text) {
  if (!text) return null
  const index = {}
  text.split(' ').forEach((wort, i) => (index[wort] ??= []).push(i))
  return index
}

const pdfUrl = (req, w) => (w.pdf ? `${req.protocol}://${req.get('host')}${req.baseUrl}/pdf/${w.pdf}` : null)

function openalexWerk(req, w) {
  return {
    id: `https://openalex.org/${w.openalex ?? `W9${w.doi.length}`}`,
    doi: `https://doi.org/${w.doi}`,
    display_name: w.titel,
    publication_year: w.jahr,
    authorships: w.autoren.map(([vor, nach]) => ({ author: { display_name: `${vor} ${nach}` } })),
    open_access: { is_oa: w.frei },
    abstract_inverted_index: invertiert(w.abstract),
    best_oa_location: w.frei ? { pdf_url: pdfUrl(req, w), license: w.lizenz } : null,
  }
}

function s2Paper(req, w) {
  return {
    paperId: w.s2 ?? w.doi,
    title: w.titel,
    year: w.jahr,
    authors: w.autoren.map(([vor, nach]) => ({ name: `${vor} ${nach}` })),
    externalIds: w.arxiv ? { ArXiv: w.arxiv, DOI: w.doi } : { DOI: w.doi },
    isOpenAccess: w.frei,
    openAccessPdf: w.frei ? { url: pdfUrl(req, w) } : null,
    abstract: w.abstract ?? null,
  }
}

function crossrefWerk(w) {
  return {
    DOI: w.doi,
    title: [w.titel],
    author: w.autoren.map(([given, family]) => ({ given, family })),
    issued: { 'date-parts': [[w.jahr]] },
    ...(w.abstract && { abstract: `<jats:p>${xml(w.abstract)}</jats:p>` }),
    'container-title': [w.journal],
    page: w.seiten,
    type: 'journal-article',
  }
}

const xml = text => String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;')

function atom(req, werke, gesamt) {
  const eintraege = werke
    .map(
      w => `  <entry>
    <id>http://arxiv.org/abs/${w.arxiv}v1</id>
    <published>${w.jahr}-01-03T00:00:00Z</published>
    <title>${xml(w.titel)}</title>
    <summary>${xml(w.abstract ?? '')}</summary>
${w.autoren.map(([vor, nach]) => `    <author><name>${xml(`${vor} ${nach}`)}</name></author>`).join('\n')}
    <link title="pdf" href="${pdfUrl(req, w)}" rel="related" type="application/pdf"/>
  </entry>`
    )
    .join('\n')
  return `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom" xmlns:opensearch="http://a9.com/-/spec/opensearch/1.1/" xmlns:arxiv="http://arxiv.org/schemas/atom">
  <opensearch:totalResults>${gesamt}</opensearch:totalResults>
${eintraege}
</feed>`
}

const seite = (liste, ab, anzahl) => liste.slice(ab, ab + anzahl)

export const paperFake = express.Router()

paperFake.post('/_steuerung', express.json(), (req, res) => {
  zustand.ausfall = new Set(req.body?.ausfall ?? [])
  if (req.body?.protokollLeeren) zustand.protokoll = []
  if (req.body?.schalter) devSchalterSetzen(req.body.schalter)
  res.sendStatus(204)
})

paperFake.get('/zotero/collections', (req, res) => res.json(KATALOG.zotero.sammlungen))

paperFake.get('/zotero/collections/:key/bibtex', (req, res) => {
  const bibtex = KATALOG.zotero.bibtex[req.params.key]
  if (!bibtex) return res.sendStatus(404)
  res.type('text/plain').send(bibtex)
})

paperFake.get('/_semantik', (req, res) => res.json({ modellVorhanden: existsSync(modellOrdner()) }))

paperFake.get('/_protokoll', (req, res) => res.json({ abrufe: zustand.protokoll }))

paperFake.use((req, res, next) => {
  const dienst = /^\/(arxiv|openalex|s2|unpaywall|pdf)\//.exec(req.path)?.[1] ?? 'crossref'
  zustand.protokoll.push({ dienst, pfad: req.originalUrl, zeit: Date.now() })
  zustand.protokoll = zustand.protokoll.slice(-500)
  if (zustand.ausfall.has(dienst)) return res.status(503).send('Service unavailable')
  next()
})

paperFake.get('/pdf/:datei', (req, res) => {
  if (!WERKE.some(w => w.pdf === req.params.datei)) return res.sendStatus(404)
  res.type('application/pdf').sendFile(fileURLToPath(new URL(req.params.datei, FIXTURES)))
})

paperFake.get('/arxiv/api/query', (req, res) => {
  const start = Number(req.query.start ?? 0)
  const treffer = req.query.id_list
    ? WERKE.filter(w => w.arxiv && req.query.id_list.split(',').includes(w.arxiv))
    : suche('arxiv', req.query.search_query)
  res.type('application/atom+xml').send(atom(req, seite(treffer, start, Number(req.query.max_results ?? 10)), treffer.length))
})

paperFake.get('/openalex/works', (req, res) => {
  const proSeite = Number(req.query['per-page'] ?? 25)
  const filter = /^(cites|cited_by):(W\d+)$/.exec(req.query.filter ?? '')
  let treffer
  if (filter) {
    const ziel = WERKE.find(w => w.openalex === filter[2])
    const liste = filter[1] === 'cites' ? ziel?.zitiertVon : ziel?.zitiert
    treffer = (liste ?? []).map(nachDoi).filter(Boolean)
  } else {
    treffer = suche('openalex', req.query.search)
  }
  const ab = (Number(req.query.page ?? 1) - 1) * proSeite
  res.json({
    meta: { count: treffer.length },
    results: seite(treffer, ab, proSeite).map(w => openalexWerk(req, w)),
  })
})

paperFake.get(/^\/openalex\/works\/doi:(.+)$/, (req, res) => {
  const w = nachDoi(req.params[0])
  if (!w?.openalex) return res.status(404).json({ error: 'Not found' })
  res.json(openalexWerk(req, w))
})

paperFake.get('/s2/graph/v1/paper/search', (req, res) => {
  const treffer = suche('s2', req.query.query)
  const ab = Number(req.query.offset ?? 0)
  res.json({ total: treffer.length, offset: ab, data: seite(treffer, ab, Number(req.query.limit ?? 10)).map(w => s2Paper(req, w)) })
})

paperFake.get(/^\/s2\/graph\/v1\/paper\/DOI:(.+)\/(citations|references)$/, (req, res) => {
  const w = nachDoi(req.params[0])
  if (!w?.dienste.includes('s2')) return res.status(404).json({ error: 'Paper not found' })
  const zitiertVon = req.params[1] === 'citations'
  const liste = (zitiertVon ? w.zitiertVon : w.zitiert).map(nachDoi).filter(Boolean)
  res.json({ data: liste.map(z => ({ [zitiertVon ? 'citingPaper' : 'citedPaper']: s2Paper(req, z) })) })
})

paperFake.get(/^\/unpaywall\/v2\/(.+)$/, (req, res) => {
  const w = nachDoi(req.params[0])
  if (!w) return res.status(404).json({ error: true, message: 'not found' })
  res.json({
    doi: w.doi,
    is_oa: w.frei,
    oa_status: w.frei ? 'gold' : 'closed',
    best_oa_location: w.frei ? { url_for_pdf: pdfUrl(req, w), license: w.lizenz } : null,
  })
})

paperFake.get('/works', (req, res) => {
  const treffer = suche('crossref', req.query.query)
  const ab = Number(req.query.offset ?? 0)
  res.json({
    status: 'ok',
    'message-type': 'work-list',
    message: { 'total-results': treffer.length, items: seite(treffer, ab, Number(req.query.rows ?? 20)).map(crossrefWerk) },
  })
})

paperFake.get('/works/:doi', (req, res) => {
  const doi = req.params.doi.toLowerCase()
  const w = nachDoi(doi)
  // arXiv-DOIs stehen wie in Wirklichkeit nicht bei Crossref, sondern bei DataCite.
  const message = CROSSREF[doi] ?? (w?.dienste.includes('crossref') ? crossrefWerk(w) : null)
  if (!message) return res.status(404).send('Resource not found.')
  res.json({ status: 'ok', 'message-type': 'work', message })
})
