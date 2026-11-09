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
let sonder

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
      if (ausfall.has(dienst)) return { ok: false, status: 503 }
      const extra = sonder(String(url))
      if (extra) return { ok: true, status: 200, json: async () => extra }
      const { text, json } = ANTWORTEN[dienst]()
      return { ok: true, status: 200, text: async () => text, json: async () => json }
    })
  )
  Recherche = await import('../../app/src/recherche/Recherche.mjs')
  Abruf = await import('../../app/src/recherche/abruf.mjs')
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
        return { total: 1, data: [{ title: 'Sleep-like replay', externalIds: { ArXiv: '2401.01234' }, abstract: `Aus S2. ${'lang '.repeat(400)}` }] }
      }
      if (url.includes('/fake/works')) {
        return {
          message: {
            'total-results': 1,
            items: [
              {
                DOI: '10.1038/nrn2762',
                title: ['The memory function'],
                abstract: '<jats:title>Abstract</jats:title><jats:p>Aus <jats:italic>Crossref</jats:italic> &amp; &lt;5 %.</jats:p>',
              },
            ],
          },
        }
      }
      return null
    }
    const { treffer } = await suchen('sleep memory consolidation')
    const abstract = doi => treffer.find(t => t.doi === doi).abstract
    expect(abstract('10.1038/nrn2762')).toBe('Aus Crossref & <5 %.')
    // Lange Abstracts werden gekürzt, damit eine Seite paper_search unter 10.000 Tokens bleibt.
    expect(abstract('10.48550/arxiv.2401.01234').startsWith('Aus S2. lang')).toBe(true)
    expect(abstract('10.48550/arxiv.2401.01234')).toHaveLength(601)
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

  it('lässt Dienste ohne Key aus und nennt sie im Hinweis', async () => {
    schalter.paperApiBasis = undefined
    vi.stubEnv('OPENALEX_API_KEY', '')
    vi.stubEnv('SEMANTIC_SCHOLAR_API_KEY', '')
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}), text: async () => '<feed/>' })))
    const ergebnis = await suchen('sleep')
    expect(ergebnis.hinweise).toEqual([
      meldung('spur_fehler_suchdienst_aus', { dienst: 'OpenAlex', variable: 'OPENALEX_API_KEY' }),
      meldung('spur_fehler_suchdienst_aus', { dienst: 'Semantic Scholar', variable: 'SEMANTIC_SCHOLAR_API_KEY' }),
    ])
    const hosts = fetch.mock.calls.map(([url]) => new URL(url).host)
    expect(hosts.sort()).toEqual(['api.crossref.org', 'export.arxiv.org'])
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
    expect(wartezeiten[0]).toBeLessThanOrEqual(3000)
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
