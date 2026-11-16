// Fake aller Paper-Dienste für Tests (nur mit SPUR_DEV=1). Antwortet im Format der echten APIs
// aus dem Katalog test/fixtures/papers.json, protokolliert jeden Abruf und kann Dienste ausfallen lassen.
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import express from 'express'
import { crossrefCache, paperCache } from '../sammlungen.mjs'
import { devSchalterSetzen } from '../schalter.mjs'
import { modellOrdner } from '../semantik/einbetten.mjs'
import { texLiveFake } from './TexLiveFake.mjs'

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
// nurDoi: bei Crossref per DOI bekannt, aber in keiner Suche.
const beiCrossref = w => Boolean(w) && (w.dienste.includes('crossref') || w.nurDoi === true)

// stoerungen: je Dienst oder je `crossref:<doi>` eine Antwort statt der echten, z. B. { status: 429, retryAfter: 1,
// mal: 2 } (zweimal, dann normal), { status: 503 } (dauerhaft) oder { trennen: true } (Verbindung bricht ab).
const zustand = { ausfall: new Set(), stoerungen: {}, protokoll: [] }

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

const wurzel = req => `${req.protocol}://${req.get('host')}${req.baseUrl}`
const pdfUrl = (req, w) => (w.pdf ? `${wurzel(req)}/pdf/${w.pdf}` : null)

// Freie Fundorte wie bei Unpaywall. Ein Werk mit `fundorte` im Katalog hat je Art (publisher, repository) eine Adresse
// unter /fundort/<art>/<doi>, die ein PDF, eine HTML-Seite („liefert": "html") oder einen Status liefert.
function oaFundorte(req, w) {
  if (!w.frei) return []
  if (!w.fundorte) return [{ host_type: 'publisher', url_for_pdf: pdfUrl(req, w), url_for_landing_page: `https://doi.org/${w.doi}`, license: w.lizenz }]
  return w.fundorte.map(ort => ({
    host_type: ort.art,
    url_for_pdf: `${wurzel(req)}/fundort/${ort.art}/${w.doi}`,
    url_for_landing_page: ort.seite ?? `https://doi.org/${w.doi}`,
    license: ort.lizenz ?? null,
  }))
}

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

paperFake.post('/_steuerung', express.json(), async (req, res) => {
  zustand.ausfall = new Set(req.body?.ausfall ?? [])
  zustand.stoerungen = req.body?.stoerungen ?? {}
  // Antworten cacht spur einen Tag; ein Test, der Dienste umschaltet, muss danach wirklich abrufen.
  if (req.body?.cachesLeeren) {
    await Promise.all([crossrefCache, paperCache].map(async sammlung => await (await sammlung()).deleteMany({})))
  }
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
  const dienst = /^\/(arxiv|openalex|s2|unpaywall|europepmc|fundort|pdf|doiorg|datacite|texlive|texlive-b)\//.exec(req.path)?.[1] ?? 'crossref'
  zustand.protokoll.push({ dienst, pfad: req.originalUrl, zeit: Date.now() })
  zustand.protokoll = zustand.protokoll.slice(-500)
  if (zustand.ausfall.has(dienst)) return res.status(503).send('Service unavailable')
  const doi = dienst === 'crossref' && /^\/works\/(.+)$/.exec(req.path)?.[1]
  const schluessel = [doi && `crossref:${decodeURIComponent(doi).toLowerCase()}`, dienst].find(k => zustand.stoerungen[k])
  const stoerung = zustand.stoerungen[schluessel]
  if (!stoerung || stoerung.mal === 0) return next()
  if (stoerung.mal) stoerung.mal--
  if (stoerung.trennen) return req.socket.destroy()
  if (stoerung.retryAfter != null) res.set('Retry-After', String(stoerung.retryAfter))
  res.status(stoerung.status).send(stoerung.status === 429 ? 'Too Many Requests' : 'Service unavailable')
})

// Zwei TeX-Live-Spiegel, damit Tests Störungen je Spiegel setzen können (stoerungen.texlive, stoerungen['texlive-b']).
paperFake.get(['/texlive/archive/:datei', '/texlive-b/archive/:datei'], texLiveFake)

const pdfSenden = (res, datei) => res.type('application/pdf').sendFile(fileURLToPath(new URL(datei, FIXTURES)))

paperFake.get('/pdf/:datei', (req, res) => {
  if (!WERKE.some(w => w.pdf === req.params.datei)) return res.sendStatus(404)
  pdfSenden(res, req.params.datei)
})

// So sieht die Seite aus, mit der Verlage Server abweisen: Status 200, aber kein PDF.
const BOT_SEITE = '<!DOCTYPE html><html><head><title>Just a moment...</title></head><body>Checking your browser before accessing the article.</body></html>'

paperFake.get(/^\/fundort\/(publisher|repository)\/(.+)$/, (req, res) => {
  const ort = nachDoi(req.params[1])?.fundorte?.find(f => f.art === req.params[0])
  if (!ort) return res.sendStatus(404)
  if (ort.liefert === 'html') return res.type('html').send(BOT_SEITE)
  if (typeof ort.liefert === 'number') return res.sendStatus(ort.liefert)
  pdfSenden(res, ort.liefert)
})

// Europe PMC: Suche nach DOI im Format der echten Antwort (resultType=core) und das PDF unter /articles/<pmcid>?pdf=render.
paperFake.get('/europepmc/webservices/rest/search', (req, res) => {
  const w = nachDoi(/^DOI:(.+)$/.exec(req.query.query ?? '')?.[1])
  if (!w?.europepmc) return res.json({ version: '6.9', hitCount: 0, resultList: { result: [] } })
  const artikel = `${wurzel(req)}/europepmc/articles/${w.europepmc.pmcid}`
  res.json({
    version: '6.9',
    hitCount: 1,
    resultList: {
      result: [
        {
          id: w.europepmc.pmcid.slice(3),
          source: 'MED',
          pmcid: w.europepmc.pmcid,
          doi: w.doi,
          title: w.titel,
          isOpenAccess: 'Y',
          hasPDF: 'Y',
          license: w.europepmc.lizenz,
          fullTextUrlList: {
            fullTextUrl: [
              { availability: 'Subscription required', availabilityCode: 'S', documentStyle: 'doi', site: 'DOI', url: `https://doi.org/${w.doi}` },
              { availability: 'Open access', availabilityCode: 'OA', documentStyle: 'html', site: 'Europe_PMC', url: artikel },
              { availability: 'Open access', availabilityCode: 'OA', documentStyle: 'pdf', site: 'Europe_PMC', url: `${artikel}?pdf=render` },
            ],
          },
        },
      ],
    },
  })
})

paperFake.get('/europepmc/articles/:pmcid', (req, res) => {
  const w = WERKE.find(w => w.europepmc?.pmcid === req.params.pmcid)
  if (!w || req.query.pdf !== 'render') return res.sendStatus(404)
  pdfSenden(res, w.europepmc.pdf)
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
    best_oa_location: oaFundorte(req, w)[0] ?? null,
    oa_locations: oaFundorte(req, w),
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
  const message = CROSSREF[doi] ?? (beiCrossref(w) ? crossrefWerk(w) : null)
  if (!message) return res.status(404).send('Resource not found.')
  res.json({ status: 'ok', 'message-type': 'work', message })
})

// doi.org nennt die Registrierstelle; ohne Eintrag „DOI does not exist“. 10.3333/ steht für eine dritte Stelle.
function registrierstelle(doi) {
  if (doi.startsWith('10.3333/')) return 'mEDRA'
  if (CROSSREF[doi] || beiCrossref(nachDoi(doi))) return 'Crossref'
  if (nachDoi(doi)?.arxiv) return 'DataCite'
  return null
}

paperFake.get(/^\/doiorg\/doiRA\/(.+)$/, (req, res) => {
  const doi = req.params[0]
  const ra = registrierstelle(doi.toLowerCase())
  res.json([ra ? { DOI: doi, RA: ra } : { DOI: doi, status: 'DOI does not exist' }])
})

paperFake.get(/^\/datacite\/dois\/(.+)$/, (req, res) => {
  const w = nachDoi(req.params[0])
  if (!w?.arxiv) return res.status(404).json({ errors: [{ status: '404', title: 'The resource you are looking for doesn\'t exist.' }] })
  res.json({
    data: {
      id: w.doi,
      type: 'dois',
      attributes: {
        doi: w.doi,
        titles: [{ title: w.titel }],
        creators: w.autoren.map(([givenName, familyName]) => ({ name: `${familyName}, ${givenName}`, givenName, familyName })),
        publicationYear: w.jahr,
      },
    },
  })
})
