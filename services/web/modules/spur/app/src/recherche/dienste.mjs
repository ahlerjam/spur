import { parseStringPromise } from 'xml2js'
import { paperApiBasis } from '../schalter.mjs'
import { abrufen } from './abruf.mjs'

export const PRO_SEITE = 10
const ZITATIONEN_MAX = 50

const ECHT = {
  arxiv: 'https://export.arxiv.org',
  openalex: 'https://api.openalex.org',
  s2: 'https://api.semanticscholar.org',
  crossref: 'https://api.crossref.org',
  unpaywall: 'https://api.unpaywall.org',
}

// Mit Paper-Fake liegt Crossref wie in P1 direkt unter der Basis, die übrigen Dienste darunter.
export function basis(name) {
  const fake = paperApiBasis()
  if (!fake) return ECHT[name]
  return name === 'crossref' ? fake : `${fake}/${name}`
}

// Der Schrägstrich bleibt, alles andere (?, #, ..) wird kodiert.
const doiPfad = doi => encodeURIComponent(doi).replace(/%2F/gi, '/')
const doiKlein = doi => doi?.replace(/^https?:\/\/(dx\.)?doi\.org\//i, '').toLowerCase() || null
const arxivDoi = id => `10.48550/arxiv.${id.replace(/v\d+$/, '')}`
const leerzeichen = text => text?.replace(/\s+/g, ' ').trim() ?? null
const xmlText = wert => (typeof wert === 'string' ? wert : wert?._)

function treffer(dienst, felder) {
  return { frei: null, pdf: null, lizenz: null, ...felder, dienste: [dienst] }
}

function arxivEintrag(e) {
  const id = xmlText(e.id[0]).split('/abs/').pop()
  return {
    id: id.replace(/v\d+$/, ''),
    doi: doiKlein(xmlText(e['arxiv:doi']?.[0])) ?? arxivDoi(id),
    titel: leerzeichen(xmlText(e.title?.[0])),
    autoren: (e.author ?? []).map(a => xmlText(a.name[0])),
    jahr: Number(xmlText(e.published?.[0])?.slice(0, 4)) || null,
    pdf: (e.link ?? []).find(l => l.$?.title === 'pdf')?.$.href ?? null,
  }
}

async function arxivFeed(dienst, parameter) {
  const url = new URL(`${basis('arxiv')}/api/query`)
  for (const [name, wert] of Object.entries(parameter)) url.searchParams.set(name, wert)
  const xml = await abrufen(dienst, url.toString(), { text: true })
  const { feed } = await parseStringPromise(xml || '<feed/>')
  return {
    eintraege: (feed?.entry ?? []).map(arxivEintrag),
    gesamt: Number(xmlText(feed?.['opensearch:totalResults']?.[0]) ?? 0),
  }
}

const arxiv = {
  name: 'arxiv',
  anzeige: 'arXiv',
  // arXiv erlaubt eine Anfrage alle 3 s; der Puffer fängt Schwankungen der Laufzeit ab.
  abstandMs: 3100,
  async suchen(anfrage, seite) {
    const { eintraege, gesamt } = await arxivFeed(this, {
      search_query: anfrage.split(/\s+/).filter(Boolean).map(b => `all:${b}`).join(' AND '),
      start: seite * PRO_SEITE,
      max_results: PRO_SEITE,
    })
    return {
      treffer: eintraege.map(({ id, ...e }) => treffer('arxiv', { ...e, arxiv: id, frei: true })),
      gesamt,
    }
  },
}

function openalexWerk(w) {
  return treffer('openalex', {
    doi: doiKlein(w.doi),
    titel: w.display_name ?? w.title ?? null,
    autoren: (w.authorships ?? []).map(a => a.author?.display_name).filter(Boolean),
    jahr: w.publication_year ?? null,
    frei: w.open_access?.is_oa ?? null,
    pdf: w.best_oa_location?.pdf_url ?? null,
    lizenz: w.best_oa_location?.license ?? null,
  })
}

const openalex = {
  name: 'openalex',
  anzeige: 'OpenAlex',
  abstandMs: 100,
  keyVariable: 'OPENALEX_API_KEY',
  kopf() {
    const key = process.env.OPENALEX_API_KEY
    return key ? { Authorization: `Bearer ${key}` } : {}
  },
  async werke(parameter) {
    const url = new URL(`${basis('openalex')}/works`)
    for (const [name, wert] of Object.entries(parameter)) url.searchParams.set(name, wert)
    const daten = await abrufen(this, url.toString(), { headers: this.kopf() })
    return { treffer: (daten?.results ?? []).map(openalexWerk), gesamt: daten?.meta?.count ?? 0 }
  },
  suchen(anfrage, seite) {
    return this.werke({ search: anfrage, 'per-page': PRO_SEITE, page: seite + 1 })
  },
  async zitationen(doi, richtung) {
    const werk = await abrufen(this, `${basis('openalex')}/works/doi:${doiPfad(doi)}`, { headers: this.kopf() })
    if (!werk?.id) return []
    const id = werk.id.split('/').pop()
    const filter = richtung === 'zitiert_von' ? `cites:${id}` : `cited_by:${id}`
    return (await this.werke({ filter, 'per-page': ZITATIONEN_MAX })).treffer
  },
}

const S2_FELDER = 'title,year,authors,externalIds,isOpenAccess,openAccessPdf'

function s2Paper(p) {
  const ids = p.externalIds ?? {}
  return treffer('s2', {
    doi: doiKlein(ids.DOI) ?? (ids.ArXiv ? arxivDoi(ids.ArXiv) : null),
    titel: p.title ?? null,
    autoren: (p.authors ?? []).map(a => a.name),
    jahr: p.year ?? null,
    frei: p.isOpenAccess ?? null,
    pdf: p.openAccessPdf?.url || null,
  })
}

const s2 = {
  name: 's2',
  anzeige: 'Semantic Scholar',
  abstandMs: 1000,
  keyVariable: 'SEMANTIC_SCHOLAR_API_KEY',
  kopf() {
    const key = process.env.SEMANTIC_SCHOLAR_API_KEY
    return key ? { 'x-api-key': key } : {}
  },
  async suchen(anfrage, seite) {
    const url = new URL(`${basis('s2')}/graph/v1/paper/search`)
    url.searchParams.set('query', anfrage)
    url.searchParams.set('offset', String(seite * PRO_SEITE))
    url.searchParams.set('limit', String(PRO_SEITE))
    url.searchParams.set('fields', S2_FELDER)
    const daten = await abrufen(this, url.toString(), { headers: this.kopf() })
    return { treffer: (daten?.data ?? []).map(s2Paper), gesamt: daten?.total ?? 0 }
  },
  async zitationen(doi, richtung) {
    const teil = richtung === 'zitiert_von' ? 'citations' : 'references'
    const url = new URL(`${basis('s2')}/graph/v1/paper/DOI:${doiPfad(doi)}/${teil}`)
    url.searchParams.set('fields', S2_FELDER)
    url.searchParams.set('limit', String(ZITATIONEN_MAX))
    const daten = await abrufen(this, url.toString(), { headers: this.kopf() })
    const feld = richtung === 'zitiert_von' ? 'citingPaper' : 'citedPaper'
    return (daten?.data ?? []).map(d => d[feld]).filter(Boolean).map(s2Paper)
  },
}

const crossref = {
  name: 'crossref',
  anzeige: 'Crossref',
  abstandMs: 50,
  async suchen(anfrage, seite) {
    const url = new URL(`${basis('crossref')}/works`)
    url.searchParams.set('query', anfrage)
    url.searchParams.set('rows', String(PRO_SEITE))
    url.searchParams.set('offset', String(seite * PRO_SEITE))
    url.searchParams.set('select', 'DOI,title,author,issued')
    if (process.env.CROSSREF_MAILTO) url.searchParams.set('mailto', process.env.CROSSREF_MAILTO)
    const daten = await abrufen(this, url.toString())
    const items = daten?.message?.items ?? []
    return {
      treffer: items.map(i =>
        treffer('crossref', {
          doi: doiKlein(i.DOI),
          titel: i.title?.[0] ?? null,
          autoren: (i.author ?? []).map(a => [a.given, a.family ?? a.name].filter(Boolean).join(' ')),
          jahr: i.issued?.['date-parts']?.[0]?.[0] ?? null,
        })
      ),
      gesamt: daten?.message?.['total-results'] ?? 0,
    }
  },
}

export const unpaywall = {
  name: 'unpaywall',
  anzeige: 'Unpaywall',
  abstandMs: 100,
  // Ergebnis: { frei, pdf, lizenz } oder null, wenn Unpaywall die DOI nicht kennt.
  async status(doi) {
    // Unpaywall verlangt eine Kontaktadresse; ohne sie bleibt der Status unbekannt.
    const email = process.env.UNPAYWALL_EMAIL ?? (paperApiBasis() && 'fake@example.org')
    if (!email) return null
    const url = new URL(`${basis('unpaywall')}/v2/${doiPfad(doi)}`)
    url.searchParams.set('email', email)
    const daten = await abrufen(this, url.toString(), { cacheSchluessel: `unpaywall:${doi}` })
    if (!daten) return null
    const ort = daten.best_oa_location
    return { frei: daten.is_oa === true, pdf: ort?.url_for_pdf ?? null, lizenz: ort?.license ?? null }
  },
}

// Metadaten im Format von Crossref.werkAuswerten, damit .bib-Einträge gleich entstehen.
export async function arxivMetadaten(id) {
  const [e] = (await arxivFeed(arxiv, { id_list: id })).eintraege
  if (!e) return { gefunden: false }
  return {
    gefunden: true,
    titel: e.titel,
    autoren: e.autoren.map(name => {
      const teile = name.split(' ')
      return { family: teile.pop(), given: teile.join(' ') }
    }),
    jahr: e.jahr,
    journal: null,
    seiten: null,
    typ: 'preprint',
    retraction: 'keine_meldung',
    pdf: e.pdf,
  }
}

export const SUCHDIENSTE = [arxiv, openalex, crossref, s2]
export const ZITATIONSDIENSTE = [openalex, s2]

// Ohne Key bleiben OpenAlex und Semantic Scholar aus; mit Paper-Fake braucht kein Dienst einen.
export function aktiv(dienst) {
  return !dienst.keyVariable || Boolean(paperApiBasis()) || Boolean(process.env[dienst.keyVariable])
}
