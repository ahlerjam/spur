import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { ObjectId, schalterAttrappe, testDatenbank } from './hilfen/datenbank.mjs'
import { fehlerVon } from './hilfen/fehler.mjs'
import { meldung } from '../../app/src/meldungen.mjs'

let Recherche
let Abruf
let datenbank
let schalter
let abrufe
let ausfall
let gedrosselt
let sonder
let stoerungen

const ATOM = `<?xml version="1.0"?>
<feed xmlns="http://www.w3.org/2005/Atom" xmlns:opensearch="http://a9.com/-/spec/opensearch/1.1/" xmlns:arxiv="http://arxiv.org/schemas/atom">
  <opensearch:totalResults>1</opensearch:totalResults>
  <entry>
    <id>http://arxiv.org/abs/2401.01234v2</id>
    <published>2024-01-03T00:00:00Z</published>
    <title>Sleep-like replay
      improves memory</title>
    <summary>  Replay during
      sleep-like phases.  </summary>
    <author><name>Alice Smith</name></author>
    <link title="pdf" href="http://arxiv.org/pdf/2401.01234v2" rel="related"/>
  </entry>
</feed>`

const ANTWORTEN = {
  arxiv: () => ({ text: ATOM }),
  openalex: () => ({
    json: {
      meta: { count: 25 },
      results: [
        {
          doi: 'https://doi.org/10.1038/NRN2762',
          display_name: 'The memory function of sleep',
          authorships: [{ author: { display_name: 'Susanne Diekelmann' } }],
          publication_year: 2010,
          open_access: { is_oa: false },
          abstract_inverted_index: { Sleep: [0], supports: [1], 'memory.': [2] },
        },
      ],
    },
  }),
  crossref: () => ({
    json: {
      message: {
        'total-results': 1,
        items: [
          {
            DOI: '10.1038/nrn2762',
            title: ['The memory function of sleep'],
            author: [{ given: 'Susanne', family: 'Diekelmann' }],
            issued: { 'date-parts': [[2010]] },
          },
        ],
      },
    },
  }),
  s2: () => ({
    json: {
      total: 1,
      data: [
        {
          title: 'Sleep-like replay improves memory',
          year: 2024,
          authors: [{ name: 'Alice Smith' }],
          externalIds: { ArXiv: '2401.01234' },
          isOpenAccess: true,
        },
      ],
    },
  }),
}

function dienstAus(url) {
  const pfad = new URL(url).pathname
  if (pfad.startsWith('/fake/arxiv')) return 'arxiv'
  if (pfad.startsWith('/fake/openalex')) return 'openalex'
  if (pfad.startsWith('/fake/s2')) return 's2'
  return 'crossref'
}

beforeAll(async () => {
  datenbank = await testDatenbank()
})

afterAll(async () => {
  await datenbank.schliessen()
})

beforeEach(async () => {
  await datenbank.leeren()
  abrufe = []
  ausfall = new Set()
  gedrosselt = new Set()
  stoerungen = {}
  sonder = () => null
  schalter = schalterAttrappe()
  schalter.paperApiBasis = 'http://paper.test/fake'
  vi.resetModules()
  vi.doMock('../../app/src/schalter.mjs', () => schalter.modul)
  vi.doMock('../../../../app/src/infrastructure/mongodb.mjs', () => datenbank.mongodbModul)
  vi.stubGlobal(
    'fetch',
    vi.fn(async url => {
      const dienst = dienstAus(url)
      abrufe.push({ dienst, url: String(url), zeit: Date.now() })
      const stoerung = stoerungen[dienst]
      if (stoerung && stoerung.mal !== 0) {
        if (stoerung.mal) stoerung.mal--
        if (stoerung.trennen) throw new Error('ECONNRESET')
        return { ok: false, status: stoerung.status, headers: new Headers(stoerung.retryAfter == null ? {} : { 'Retry-After': String(stoerung.retryAfter) }) }
      }
      if (ausfall.has(dienst)) return { ok: false, status: 500, headers: new Headers() }
      if (gedrosselt.has(dienst)) return { ok: false, status: 429, headers: new Headers() }
      const extra = sonder(String(url))
      if (extra) return { ok: true, status: 200, json: async () => extra }
      const { text, json } = ANTWORTEN[dienst]()
      return { ok: true, status: 200, text: async () => text, json: async () => json }
    })
  )
  Recherche = await import('../../app/src/recherche/Recherche.mjs')
  Abruf = await import('../../app/src/recherche/abruf.mjs')
  Abruf.zeit.warten = vi.fn(async () => {})
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

const projectId = new ObjectId()
const userId = new ObjectId()
const suchen = (anfrage, seite = 0) => Recherche.suchen({ projectId, userId, anfrage, seite })

describe('suchen', () => {
  it('führt Treffer aller Dienste per DOI zusammen und nennt jede Quelle', async () => {
    const ergebnis = await suchen('sleep memory consolidation')
    expect(ergebnis.fehler).toEqual([])
    const nrn = ergebnis.treffer.find(t => t.doi === '10.1038/nrn2762')
    expect(nrn).toMatchObject({
      titel: 'The memory function of sleep',
      autoren: ['Susanne Diekelmann'],
      jahr: 2010,
      dienste: ['OpenAlex', 'Crossref'],
      frei: false,
    })
    const arxiv = ergebnis.treffer.find(t => t.doi === '10.48550/arxiv.2401.01234')
    expect(arxiv).toMatchObject({
      titel: 'Sleep-like replay improves memory',
      dienste: ['arXiv', 'Semantic Scholar'],
      frei: true,
      pdf: 'http://arxiv.org/pdf/2401.01234v2',
      jahr: 2024,
    })
    expect(ergebnis.treffer).toHaveLength(2)
  })

  it('liefert je Treffer das Abstract aus dem ersten Dienst, der eines hat', async () => {
    const { treffer } = await suchen('sleep memory consolidation')
    expect(treffer.find(t => t.doi === '10.1038/nrn2762').abstract).toBe('Sleep supports memory.')
    expect(treffer.find(t => t.doi === '10.48550/arxiv.2401.01234').abstract).toBe('Replay during sleep-like phases.')
  })

  it('nimmt Abstracts aus Crossref und Semantic Scholar und lässt fehlende leer', async () => {
    ausfall.add('arxiv')
    sonder = url => {
      if (url.includes('/fake/openalex')) {
        return { meta: { count: 1 }, results: [{ doi: 'https://doi.org/10.1/ohne', display_name: 'Ohne Abstract' }] }
      }
      if (url.includes('/fake/s2')) {
        return { total: 1, data: [{ title: 'Sleep-like replay', externalIds: { ArXiv: '2401.01234' }, abstract: `Aus S2. ${'lang '.repeat(118)}l😀 danach` }] }
      }
      if (url.includes('/fake/works')) {
        return {
          message: {
            'total-results': 1,
            items: [
              {
                DOI: '10.1038/nrn2762',
                title: ['The memory function'],
                abstract: '<jats:title>Abstract</jats:title><jats:p>Aus <jats:italic>Crossref</jats:italic> &amp; &lt;5 %.&#1114112; H<jats:sub>2</jats:sub>O &#X41;</jats:p><jats:p>Zweiter.</jats:p>',
              },
            ],
          },
        }
      }
      return null
    }
    const { treffer } = await suchen('sleep memory consolidation')
    const abstract = doi => treffer.find(t => t.doi === doi).abstract
    expect(abstract('10.1038/nrn2762')).toBe('Aus Crossref & <5 %.&#1114112; H2O A Zweiter.')
    // Lange Abstracts werden gekürzt, damit eine Seite paper_search unter 10.000 Tokens bleibt.
    expect(abstract('10.48550/arxiv.2401.01234').startsWith('Aus S2. lang')).toBe(true)
    // 600 Zeichen enden genau im Emoji: gekürzt wird an Zeichen, nicht an UTF-16-Einheiten.
    expect(abstract('10.48550/arxiv.2401.01234')).toBe(`Aus S2. ${'lang '.repeat(118)}l😀…`)
    expect(abstract('10.48550/arxiv.2401.01234').endsWith('…')).toBe(true)
    expect(abstract('10.1/ohne')).toBe('')
  })

  it('meldet einen ausgefallenen Dienst mit Namen und zeigt die übrigen Treffer', async () => {
    ausfall.add('s2')
    const ergebnis = await suchen('sleep memory consolidation')
    expect(ergebnis.fehler).toEqual([
      { dienst: 's2', art: 'nicht_erreichbar', text: meldung('spur_fehler_dienst_nicht_erreichbar', { dienst: 'Semantic Scholar' }) },
    ])
    expect(ergebnis.treffer.map(t => t.doi)).toContain('10.1038/nrn2762')
  })

  it('zeigt mehr Seiten, solange ein Dienst weitere Treffer hat', async () => {
    expect((await suchen('sleep')).weiter).toBe(true)
    const zweite = abrufe.filter(a => a.dienst === 'openalex')
    expect(zweite[0].url).toContain('page=1')
    await suchen('sleep', 1)
    expect(abrufe.filter(a => a.dienst === 'openalex').at(-1).url).toContain('page=2')
  })

  it('fragt ohne Keys alle vier Dienste ab, ohne Key-Kopf', async () => {
    schalter.paperApiBasis = undefined
    vi.stubEnv('OPENALEX_API_KEY', '')
    vi.stubEnv('SEMANTIC_SCHOLAR_API_KEY', '')
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}), text: async () => '<feed/>' })))
    const ergebnis = await suchen('sleep')
    const hosts = fetch.mock.calls.map(([url]) => new URL(url).host)
    expect(hosts.sort()).toEqual(['api.crossref.org', 'api.openalex.org', 'api.semanticscholar.org', 'export.arxiv.org'])
    for (const [, optionen] of fetch.mock.calls) {
      expect(optionen.headers ?? {}).not.toHaveProperty('Authorization')
      expect(optionen.headers ?? {}).not.toHaveProperty('x-api-key')
    }
    expect(ergebnis.dienste.map(d => d.antwort)).toEqual(['geantwortet', 'geantwortet', 'geantwortet', 'geantwortet'])
  })

  it('schickt einen gesetzten Key mit', async () => {
    vi.stubEnv('SEMANTIC_SCHOLAR_API_KEY', 's2-key')
    await suchen('sleep')
    const s2 = fetch.mock.calls.find(([url]) => dienstAus(url) === 's2')
    expect(s2[1].headers).toMatchObject({ 'x-api-key': 's2-key' })
  })

  it('nennt je Dienst, ob er geantwortet hat', async () => {
    ausfall.add('s2')
    const ergebnis = await suchen('sleep')
    expect(ergebnis.dienste).toEqual([
      { dienst: 'arXiv', antwort: 'geantwortet', versuche: 1 },
      { dienst: 'OpenAlex', antwort: 'geantwortet', versuche: 1 },
      { dienst: 'Crossref', antwort: 'geantwortet', versuche: 1 },
      { dienst: 'Semantic Scholar', antwort: 'nicht_erreichbar', versuche: 1 },
    ])
    expect(ergebnis.hinweis).toBeNull()
  })

  it('schreibt je Dienst Datum, Datenbank, Anfrage und Trefferzahl ins Protokoll', async () => {
    ausfall.add('s2')
    await suchen('sleep memory consolidation')
    await suchen('sleep memory consolidation', 1)
    const { eintraege } = await Recherche.protokoll(projectId)
    expect(eintraege.map(e => [e.dienst, e.anfrage, e.treffer]).sort()).toEqual([
      ['Crossref', 'sleep memory consolidation', 1],
      ['OpenAlex', 'sleep memory consolidation', 25],
      ['arXiv', 'sleep memory consolidation', 1],
    ])
    expect(eintraege[0].datum).toBeInstanceOf(Date)
  })

  it('lehnt eine leere Anfrage ab', async () => {
    expect(await fehlerVon(suchen('  '))).toMatchObject({ status: 400, typ: 'anfrage_fehlt' })
  })

  it('beantwortet dieselbe Anfrage aus dem Cache', async () => {
    await suchen('sleep')
    const vorher = abrufe.length
    await suchen('sleep')
    expect(abrufe.length).toBe(vorher)
  })
})

describe('platzHolen', () => {
  it('vergibt arXiv-Fenster im Abstand von 3 Sekunden, auch parallel', async () => {
    const dienst = { name: 'arxiv', anzeige: 'arXiv', abstandMs: 3000 }
    const wartezeiten = []
    vi.spyOn(globalThis, 'setTimeout').mockImplementation((weiter, ms) => {
      wartezeiten.push(ms)
      weiter()
    })
    await Promise.all([1, 2, 3].map(() => Abruf.platzHolen(dienst)))
    vi.restoreAllMocks()
    wartezeiten.sort((a, b) => a - b)
    expect(wartezeiten).toHaveLength(2)
    expect(wartezeiten[0]).toBeGreaterThan(2500)
    // Jeder Aufruf liest Date.now() selbst, bevor die Datenbank die Reihenfolge vergibt: 1 bis 2 ms Abweichung sind möglich.
    expect(wartezeiten[0]).toBeLessThanOrEqual(3050)
    expect(wartezeiten[1] - wartezeiten[0]).toBeGreaterThan(2500)
  })

  it('meldet „Limit erreicht“, wenn das nächste Fenster zu weit weg liegt', async () => {
    const dienst = { name: 's2', anzeige: 'Semantic Scholar', abstandMs: 30000 }
    await datenbank.db.collection('spurDrossel').insertOne({ _id: 's2', naechster: Date.now() + 25000 })
    const vorher = (await datenbank.db.collection('spurDrossel').findOne({ _id: 's2' })).naechster
    expect(await fehlerVon(Abruf.platzHolen(dienst))).toMatchObject({
      art: 'limit',
      message: meldung('spur_fehler_dienst_limit', { dienst: 'Semantic Scholar' }),
    })
    expect((await datenbank.db.collection('spurDrossel').findOne({ _id: 's2' })).naechster).toBe(vorher)
  })
})

describe('auswerten', () => {
  it('verschmilzt Treffer ohne DOI und Titel nicht', () => {
    const dienst = { name: 'crossref', anzeige: 'Crossref' }
    const leer = { doi: null, titel: null, autoren: [], dienste: ['crossref'] }
    const { treffer } = Recherche.auswerten([dienst], [{ status: 'fulfilled', value: { treffer: [leer, { ...leer }], gesamt: 2 } }])
    expect(treffer).toHaveLength(2)
  })
})

describe('zitationen', () => {
  const OPENALEX_WERK = { id: 'https://openalex.org/W1' }
  const werk = (doi, titel) => ({ doi: `https://doi.org/${doi}`, display_name: titel, authorships: [], publication_year: 2020 })
  const paper = (doi, titel) => ({ title: titel, year: 2020, authors: [], externalIds: { DOI: doi } })

  beforeEach(() => {
    sonder = url => {
      if (url.includes('/works/doi:')) return OPENALEX_WERK
      if (/filter=(cites|cited_by)/.test(url)) return { meta: { count: 1 }, results: [werk('10.1/a', 'A')] }
      if (/\/(citations|references)/.test(url)) {
        const feld = url.includes('/citations') ? 'citingPaper' : 'citedPaper'
        return { data: [{ [feld]: paper('10.1/A', 'A') }, { [feld]: paper('10.1/b', 'B') }] }
      }
      return null
    }
  })

  it('führt „Zitiert von“ aus OpenAlex und Semantic Scholar per DOI zusammen', async () => {
    const ergebnis = await Recherche.zitationen('10.1038/nrn2762', 'zitiert_von')
    expect(ergebnis.treffer.map(t => [t.doi, t.dienste])).toEqual([
      ['10.1/a', ['OpenAlex', 'Semantic Scholar']],
      ['10.1/b', ['Semantic Scholar']],
    ])
    const urls = abrufe.map(a => a.url)
    expect(urls.some(u => u.includes('filter=cites%3AW1'))).toBe(true)
    expect(urls.some(u => u.includes('/paper/DOI:10.1038/nrn2762/citations'))).toBe(true)
  })

  it('fragt für „Zitiert“ die Referenzen ab', async () => {
    await Recherche.zitationen('10.1038/nrn2762', 'zitiert')
    const urls = abrufe.map(a => a.url)
    expect(urls.some(u => u.includes('filter=cited_by%3AW1'))).toBe(true)
    expect(urls.some(u => u.includes('/references'))).toBe(true)
  })

  it('meldet einen ausgefallenen Dienst und liefert die übrigen Zitationen', async () => {
    ausfall.add('openalex')
    const ergebnis = await Recherche.zitationen('10.1038/nrn2762', 'zitiert_von')
    expect(ergebnis.fehler.map(f => f.text)).toEqual([meldung('spur_fehler_dienst_nicht_erreichbar', { dienst: 'OpenAlex' })])
    expect(ergebnis.treffer).toHaveLength(2)
  })

  it('meldet einen gedrosselten Dienst und liefert die Zitationen der anderen', async () => {
    gedrosselt.add('s2')
    const ergebnis = await Recherche.zitationen('10.1038/nrn2762', 'zitiert_von')
    expect(ergebnis.treffer.map(t => t.doi)).toEqual(['10.1/a'])
    expect(ergebnis.dienste).toEqual([
      { dienst: 'OpenAlex', antwort: 'geantwortet', versuche: 1 },
      { dienst: 'Semantic Scholar', antwort: 'gedrosselt', versuche: 3 },
    ])
  })

  it('liefert keine stille leere Liste, wenn kein Dienst antwortet', async () => {
    ausfall.add('openalex')
    gedrosselt.add('s2')
    const ergebnis = await Recherche.zitationen('10.1038/nrn2762', 'zitiert_von')
    expect(ergebnis.treffer).toEqual([])
    expect(ergebnis.hinweis).toBe(meldung('spur_hinweis_kein_dienst'))
    expect(ergebnis.fehler.map(f => [f.dienst, f.art])).toEqual([['openalex', 'nicht_erreichbar'], ['s2', 'limit']])
  })

  it('lehnt eine ungültige Richtung oder DOI ab', async () => {
    expect(await fehlerVon(Recherche.zitationen('10.1/a', 'quer'))).toMatchObject({ status: 400 })
    expect(await fehlerVon(Recherche.zitationen('keine-doi', 'zitiert'))).toMatchObject({ status: 400 })
  })
})

describe('protokollCsv', () => {
  it('schreibt Datum, Datenbank, Anfrage und Trefferzahl als CSV', async () => {
    await suchen('sleep, "memory"')
    const csv = await Recherche.protokollCsv(projectId)
    const zeilen = csv.trim().split('\n')
    expect(zeilen[0]).toBe('Datum,Datenbank,Anfrage,Trefferzahl')
    expect(zeilen).toContain('2026-11-07T10:00:00.000Z,OpenAlex,"sleep, ""memory""",25')
    expect(zeilen).toHaveLength(5)
  })
})

describe('Unpaywall-Adresse', () => {
  let dienste
  beforeEach(async () => {
    sonder = () => ({ doi: '10.1/x', is_oa: true, best_oa_location: { url_for_pdf: 'https://x.example/a.pdf' } })
    dienste = await import('../../app/src/recherche/dienste.mjs')
  })

  const email = () => new URL(abrufe.at(-1).url).searchParams.get('email')

  it('nimmt UNPAYWALL_EMAIL, wenn gesetzt', async () => {
    vi.stubEnv('UNPAYWALL_EMAIL', 'unpaywall@example.org')
    vi.stubEnv('CROSSREF_MAILTO', 'spur@example.org')
    expect((await dienste.unpaywall.status('10.1/x')).frei).toBe(true)
    expect(email()).toBe('unpaywall@example.org')
  })

  it('nimmt CROSSREF_MAILTO, wenn UNPAYWALL_EMAIL fehlt', async () => {
    vi.stubEnv('UNPAYWALL_EMAIL', '')
    vi.stubEnv('CROSSREF_MAILTO', 'spur@example.org')
    expect((await dienste.unpaywall.status('10.1/x')).frei).toBe(true)
    expect(email()).toBe('spur@example.org')
  })

  it('meldet ohne beide Adressen unpaywall_aus mit beiden Variablen und dem Verweis auf die README', async () => {
    vi.stubEnv('UNPAYWALL_EMAIL', '')
    vi.stubEnv('CROSSREF_MAILTO', '')
    const fehler = await fehlerVon(dienste.unpaywall.status('10.1/x'))
    expect(fehler).toMatchObject({ status: 503, typ: 'unpaywall_aus' })
    expect(fehler.message).toMatch(/UNPAYWALL_EMAIL/)
    expect(fehler.message).toMatch(/CROSSREF_MAILTO/)
    expect(fehler.message).toMatch(/README/)
    expect(abrufe).toHaveLength(0)
  })
})

describe('Unpaywall-Fundorte', () => {
  let dienste
  beforeEach(async () => {
    vi.stubEnv('UNPAYWALL_EMAIL', 'unpaywall@example.org')
    dienste = await import('../../app/src/recherche/dienste.mjs')
  })

  it('liefert alle freien PDF-Adressen, Repositorien vor Verlagsseiten', async () => {
    sonder = () => ({
      doi: '10.1/x',
      is_oa: true,
      best_oa_location: { host_type: 'publisher', url_for_pdf: 'https://verlag.example/a.pdf', license: 'cc-by' },
      oa_locations: [
        { host_type: 'publisher', url_for_pdf: 'https://verlag.example/a.pdf', url_for_landing_page: 'https://verlag.example/a', license: 'cc-by' },
        { host_type: 'repository', url_for_pdf: null, url_for_landing_page: 'https://repo.example/nur-seite' },
        { host_type: 'repository', url_for_pdf: 'https://repo.example/a.pdf', url_for_landing_page: 'https://repo.example/a', license: null },
        { host_type: 'repository', url_for_pdf: 'https://repo.example/a.pdf', license: null },
      ],
    })
    expect(await dienste.unpaywall.status('10.1/x')).toEqual({
      frei: true,
      fundorte: [
        { url: 'https://repo.example/a.pdf', art: 'repository', lizenz: null, seite: 'https://repo.example/a' },
        { url: 'https://verlag.example/a.pdf', art: 'publisher', lizenz: 'cc-by', seite: 'https://verlag.example/a' },
      ],
    })
  })

  it('nimmt best_oa_location, wenn die Liste der Fundorte fehlt', async () => {
    sonder = () => ({ doi: '10.1/x', is_oa: true, best_oa_location: { url_for_pdf: 'https://x.example/a.pdf', license: 'cc-by' } })
    expect((await dienste.unpaywall.status('10.1/x')).fundorte).toEqual([
      { url: 'https://x.example/a.pdf', art: 'publisher', lizenz: 'cc-by', seite: null },
    ])
  })

  it('kennt ohne freien Zugang keinen Fundort', async () => {
    sonder = () => ({ doi: '10.1/x', is_oa: false, best_oa_location: null, oa_locations: [] })
    expect(await dienste.unpaywall.status('10.1/x')).toEqual({ frei: false, fundorte: [] })
  })
})

describe('Europe PMC', () => {
  let dienste
  // Gekürzte echte Antwort (2026-11-16) für eine DOI mit freiem PDF.
  const TREFFER = {
    doi: '10.1371/JOURNAL.PMED.0040040',
    pmcid: 'PMC1817752',
    isOpenAccess: 'Y',
    hasPDF: 'Y',
    license: 'cc by',
    fullTextUrlList: {
      fullTextUrl: [
        { availabilityCode: 'S', documentStyle: 'doi', site: 'DOI', url: 'https://doi.org/10.1371/journal.pmed.0040040' },
        { availabilityCode: 'OA', documentStyle: 'html', site: 'Europe_PMC', url: 'https://europepmc.org/articles/PMC1817752' },
        { availabilityCode: 'OA', documentStyle: 'pdf', site: 'Europe_PMC', url: 'https://europepmc.org/articles/PMC1817752?pdf=render' },
      ],
    },
  }
  beforeEach(async () => {
    dienste = await import('../../app/src/recherche/dienste.mjs')
  })

  it('fragt nach der DOI und liefert das freie PDF als Fundort', async () => {
    sonder = () => ({ resultList: { result: [TREFFER] } })
    expect(await dienste.europepmc.fundort('10.1371/journal.pmed.0040040')).toEqual({
      url: 'https://europepmc.org/articles/PMC1817752?pdf=render',
      art: 'europepmc',
      lizenz: 'cc by',
      seite: null,
    })
    const url = new URL(abrufe.at(-1).url)
    expect(url.pathname).toBe('/fake/europepmc/webservices/rest/search')
    expect(Object.fromEntries(url.searchParams)).toEqual({ query: 'DOI:10.1371/journal.pmed.0040040', format: 'json', resultType: 'core' })
  })

  it('liefert null ohne Treffer, ohne freies PDF und für den Treffer einer anderen DOI', async () => {
    sonder = () => ({ resultList: { result: [] } })
    expect(await dienste.europepmc.fundort('10.1/a')).toBeNull()
    const nurAbo = { ...TREFFER, doi: '10.1/b', fullTextUrlList: { fullTextUrl: [{ availabilityCode: 'S', documentStyle: 'pdf', url: 'https://verlag.example/b.pdf' }] } }
    sonder = () => ({ resultList: { result: [nurAbo] } })
    expect(await dienste.europepmc.fundort('10.1/b')).toBeNull()
    sonder = () => ({ resultList: { result: [TREFFER] } })
    expect(await dienste.europepmc.fundort('10.1/c')).toBeNull()
  })
})

// Echter Fall: Semantic Scholar war bei 16 von 17 Anfragen gedrosselt, OpenAlex bei 7.
describe('Wiederholung bei gedrosselten Diensten', () => {
  const von = (ergebnis, dienst) => ergebnis.dienste.find(d => d.dienst === dienst)
  const anzahl = dienst => abrufe.filter(a => a.dienst === dienst).length

  it('fragt nach zweimal 429 mit Retry-After ein drittes Mal und nennt die Versuche', async () => {
    stoerungen.s2 = { status: 429, retryAfter: 1, mal: 2 }
    const ergebnis = await suchen('sleep memory')
    expect(von(ergebnis, 'Semantic Scholar')).toEqual({ dienst: 'Semantic Scholar', antwort: 'geantwortet', versuche: 3 })
    expect(von(ergebnis, 'OpenAlex')).toEqual({ dienst: 'OpenAlex', antwort: 'geantwortet', versuche: 1 })
    expect(ergebnis.treffer.some(t => t.dienste.includes('Semantic Scholar'))).toBe(true)
    expect(anzahl('s2')).toBe(3)
    expect(Abruf.zeit.warten.mock.calls).toEqual([[1000], [1000]])
  })

  it('meldet nach drei Versuchen gedrosselt und liefert die Treffer der anderen', async () => {
    stoerungen.s2 = { status: 429, retryAfter: 1 }
    const ergebnis = await suchen('sleep memory')
    expect(von(ergebnis, 'Semantic Scholar')).toEqual({ dienst: 'Semantic Scholar', antwort: 'gedrosselt', versuche: 3 })
    expect(ergebnis.fehler).toMatchObject([{ dienst: 's2', art: 'limit' }])
    expect(ergebnis.treffer.length).toBeGreaterThan(0)
    expect(anzahl('s2')).toBe(3)
  })

  it('fragt nach einem 503 ohne Retry-After nach 1 s erneut', async () => {
    stoerungen.openalex = { status: 503, mal: 1 }
    const ergebnis = await suchen('sleep memory')
    expect(von(ergebnis, 'OpenAlex')).toEqual({ dienst: 'OpenAlex', antwort: 'geantwortet', versuche: 2 })
    expect(Abruf.zeit.warten.mock.calls).toEqual([[1000]])
  })

  it('wartet ohne Retry-After 1 und 2 Sekunden', async () => {
    stoerungen.s2 = { status: 429 }
    await suchen('sleep memory')
    expect(Abruf.zeit.warten.mock.calls).toEqual([[1000], [2000]])
  })

  it('wiederholt einen Netzfehler, aber keinen anderen Fehlerstatus', async () => {
    stoerungen.s2 = { trennen: true, mal: 1 }
    ausfall.add('openalex')
    const ergebnis = await suchen('sleep memory')
    expect(von(ergebnis, 'Semantic Scholar')).toMatchObject({ antwort: 'geantwortet', versuche: 2 })
    expect(von(ergebnis, 'OpenAlex')).toEqual({ dienst: 'OpenAlex', antwort: 'nicht_erreichbar', versuche: 1 })
  })

  it('hört nach 20 Sekunden auf, auch wenn noch Versuche übrig wären', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    try {
      Abruf.zeit.warten.mockImplementation(async ms => vi.advanceTimersByTime(ms))
      stoerungen.s2 = { status: 429, retryAfter: 30 }
      const ergebnis = await suchen('sleep memory')
      // Retry-After zählt höchstens 10 s: nach zwei Pausen sind die 20 s um.
      expect(von(ergebnis, 'Semantic Scholar')).toMatchObject({ antwort: 'gedrosselt' })
      const gewartet = Abruf.zeit.warten.mock.calls.reduce((summe, [ms]) => summe + ms, 0)
      expect(gewartet).toBeLessThanOrEqual(20000)
    } finally {
      vi.useRealTimers()
    }
  })

  it('zählt keine Versuche, wenn die Antwort aus dem Cache kommt', async () => {
    await suchen('sleep memory')
    const ergebnis = await suchen('sleep memory')
    expect(ergebnis.dienste.map(d => d.versuche)).toEqual([0, 0, 0, 0])
  })

  it('verhält sich bei Zitationen genauso', async () => {
    sonder = url => (url.includes('/works/doi:') ? { id: 'https://openalex.org/W1' } : null)
    stoerungen.s2 = { status: 429, retryAfter: 1, mal: 2 }
    const ergebnis = await Recherche.zitationen('10.1038/nrn2762', 'zitiert_von')
    expect(von(ergebnis, 'Semantic Scholar')).toEqual({ dienst: 'Semantic Scholar', antwort: 'geantwortet', versuche: 3 })
  })

  it('meldet bei Zitationen nach drei Versuchen gedrosselt', async () => {
    sonder = url => (url.includes('/works/doi:') ? { id: 'https://openalex.org/W1' } : null)
    stoerungen.s2 = { status: 429 }
    const dauerhaft = await Recherche.zitationen('10.1371/journal.pone.0099999', 'zitiert')
    expect(von(dauerhaft, 'Semantic Scholar')).toEqual({ dienst: 'Semantic Scholar', antwort: 'gedrosselt', versuche: 3 })
    expect(von(dauerhaft, 'OpenAlex').antwort).toBe('geantwortet')
  })
})

