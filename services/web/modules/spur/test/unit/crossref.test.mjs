import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { schalterAttrappe } from './hilfen/datenbank.mjs'

let Crossref
let schalter
let cache
let abrufe

const ANTWORT = {
  message: {
    title: ['Sleep and Memory'],
    author: [{ given: 'Alice', family: 'Smith' }, { name: 'Sleep Consortium' }],
    issued: { 'date-parts': [[2024, 5]] },
    'container-title': ['Journal of Sleep Research'],
    page: '345-352',
    type: 'journal-article',
  },
}

function antworten(...antworten) {
  const liste = [...antworten]
  vi.stubGlobal(
    'fetch',
    vi.fn(async url => {
      abrufe.push(String(url))
      const naechste = liste.length > 1 ? liste.shift() : liste[0]
      if (naechste instanceof Error) throw naechste
      return naechste
    })
  )
}

const json = (daten, status = 200, kopf = {}) => ({ status, ok: status < 400, headers: new Headers(kopf), json: async () => daten })
const mitUpdates = (...typen) => json({ message: { ...ANTWORT.message, 'updated-by': typen.map(type => ({ type })) } })

beforeEach(async () => {
  abrufe = []
  cache = new Map()
  schalter = schalterAttrappe()
  vi.useFakeTimers({ toFake: ['Date', 'setTimeout'] })
  vi.setSystemTime(new Date('2026-11-07T10:00:00Z'))
  vi.resetModules()
  vi.doMock('../../app/src/schalter.mjs', () => schalter.modul)
  vi.doMock('../../app/src/sammlungen.mjs', () => ({
    crossrefCache: async () => ({
      findOne: async ({ _id }) => cache.get(_id) ?? null,
      updateOne: async ({ _id }, { $set }) => void cache.set(_id, { _id, ...$set }),
    }),
  }))
  Crossref = await import('../../app/src/Crossref.mjs')
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe('werk', () => {
  it('liest Titel, Autoren, Jahr, Zeitschrift, Seiten und Typ aus der Antwort', async () => {
    antworten(json(ANTWORT))
    expect(await Crossref.werk('10.5555/spur.2024.001')).toEqual({
      gefunden: true,
      titel: 'Sleep and Memory',
      autoren: [
        { family: 'Smith', given: 'Alice' },
        { family: 'Sleep Consortium', given: '' },
      ],
      jahr: 2024,
      journal: 'Journal of Sleep Research',
      seiten: '345-352',
      typ: 'journal-article',
      retraction: 'keine_meldung',
    })
  })

  it('fragt die DOI maskiert ab und hängt die Kontaktadresse an', async () => {
    vi.stubEnv('CROSSREF_MAILTO', 'team@example.org')
    antworten(json(ANTWORT))
    await Crossref.werk('10.1000/a/b(1)')
    expect(abrufe).toEqual(['https://api.crossref.org/works/10.1000%2Fa%2Fb(1)?mailto=team%40example.org'])
  })

  it('nimmt im Test die Basis-URL aus dem Schalter', async () => {
    schalter.paperApiBasis = 'http://127.0.0.1/spur/dev/crossref'
    antworten(json(ANTWORT))
    await Crossref.werk('10.5555/x')
    expect(abrufe[0]).toMatch(/^http:\/\/127\.0\.0\.1\/spur\/dev\/crossref\/works\//)
  })

  it.each([
    [['retraction'], 'zurueckgezogen'],
    [['Withdrawal'], 'zurueckgezogen'],
    [['removal'], 'zurueckgezogen'],
    [['correction'], 'korrektur'],
    [['erratum'], 'korrektur'],
    [['corrigendum'], 'korrektur'],
    [['addendum'], 'korrektur'],
    [['clarification'], 'korrektur'],
    [['new_edition'], 'keine_meldung'],
    [['correction', 'retraction'], 'zurueckgezogen'],
  ])('bewertet Änderungsmeldungen %j als %s', async (typen, erwartet) => {
    antworten(mitUpdates(...typen))
    expect((await Crossref.werk('10.1/a')).retraction).toBe(erwartet)
  })

  it('meldet eine unbekannte DOI als nicht gefunden und merkt sich das', async () => {
    antworten(json({}, 404))
    expect(await Crossref.werk('10.1/fehlt')).toEqual({ gefunden: false })
    expect(await Crossref.werk('10.1/fehlt')).toEqual({ gefunden: false })
    expect(abrufe).toHaveLength(1)
  })

  it('ruft innerhalb eines Tages nicht erneut ab, auch nicht bei anderer Schreibweise', async () => {
    antworten(json(ANTWORT))
    await Crossref.werk('10.5555/ABC')
    schalter.zeit = new Date('2026-11-08T09:59:00Z')
    await Crossref.werk('10.5555/abc')
    expect(abrufe).toHaveLength(1)
  })

  it('ruft nach einem Tag erneut ab und aktualisiert den Eintrag', async () => {
    antworten(json(ANTWORT), mitUpdates('retraction'))
    await Crossref.werk('10.5555/abc')
    schalter.zeit = new Date('2026-11-08T10:00:01Z')
    expect((await Crossref.werk('10.5555/abc')).retraction).toBe('zurueckgezogen')
    expect(abrufe).toHaveLength(2)
  })

  it('fragt nach einem Netzfehler 30 s lang nicht erneut, danach wieder', async () => {
    antworten(new Error('Netz weg'), json(ANTWORT))
    expect(await Crossref.werk('10.1/a')).toBeNull()
    expect(await Crossref.werk('10.1/b')).toBeNull()
    expect(abrufe).toHaveLength(1)
    vi.setSystemTime(Date.now() + 31 * 1000)
    expect((await Crossref.werk('10.1/a')).gefunden).toBe(true)
    expect(abrufe).toHaveLength(2)
  })

  it('versucht es nach einer HTTP-Fehlerantwort beim nächsten Aufruf sofort wieder', async () => {
    antworten(json({}, 500), json(ANTWORT))
    expect(await Crossref.werk('10.1/a')).toBeNull()
    expect((await Crossref.werk('10.1/a')).gefunden).toBe(true)
  })

  // Die Pausen laufen mit falschen Uhren; gemessen wird die vergangene Zeit.
  async function mitPausen(aufruf) {
    const start = Date.now()
    const ergebnis = aufruf()
    await vi.runAllTimersAsync()
    return { ergebnis: await ergebnis, ms: Date.now() - start }
  }

  it('wartet bei 429 die Zeit aus Retry-After ab und versucht es erneut', async () => {
    antworten(json({}, 429, { 'Retry-After': '1' }), json({}, 429, { 'Retry-After': '1' }), json(ANTWORT))
    const { ergebnis, ms } = await mitPausen(() => Crossref.werk('10.3390/foods11223570'))
    expect(ergebnis.gefunden).toBe(true)
    expect(abrufe).toHaveLength(3)
    expect(ms).toBe(2000)
  })

  it('wartet bei 503 ohne Retry-After steigend und gibt nach vier Versuchen auf', async () => {
    antworten(json({}, 503))
    const { ergebnis, ms } = await mitPausen(() => Crossref.werk('10.1/a'))
    expect(ergebnis).toBeNull()
    expect(abrufe).toHaveLength(4)
    expect(ms).toBe(1000 + 2000 + 4000)
  })

  it('wartet höchstens 5 s auf einmal, auch bei längerem Retry-After', async () => {
    antworten(json({}, 429, { 'Retry-After': '120' }), json(ANTWORT))
    const { ergebnis, ms } = await mitPausen(() => Crossref.werk('10.1/a'))
    expect(ergebnis.gefunden).toBe(true)
    expect(ms).toBe(5000)
  })

  it('versucht nach einem ganz gescheiterten Abruf eine Minute lang je DOI nur einmal', async () => {
    antworten(json({}, 503))
    await mitPausen(() => Crossref.werk('10.1/a'))
    expect(abrufe).toHaveLength(4)
    expect((await mitPausen(() => Crossref.werk('10.1/b'))).ergebnis).toBeNull()
    expect(abrufe).toHaveLength(5)
    // Der Einzelversuch nach 50 s verlängert das Fenster nicht.
    vi.setSystemTime(Date.now() + 50 * 1000)
    await mitPausen(() => Crossref.werk('10.1/c'))
    expect(abrufe).toHaveLength(6)
    vi.setSystemTime(Date.now() + 11 * 1000)
    await mitPausen(() => Crossref.werk('10.1/d'))
    expect(abrufe).toHaveLength(10)
  })

  it('wiederholt andere Fehler nicht', async () => {
    antworten(json({}, 500))
    expect(await Crossref.werk('10.1/a')).toBeNull()
    expect(abrufe).toHaveLength(1)
  })

  it('behält bei Ausfall den abgelaufenen Eintrag', async () => {
    antworten(json(ANTWORT), new Error('Netz weg'))
    await Crossref.werk('10.1/a')
    schalter.zeit = new Date('2026-11-09T10:00:00Z')
    expect((await Crossref.werk('10.1/a')).titel).toBe('Sleep and Memory')
  })
})

describe('pruefen (Registrierstellen)', () => {
  const nichtGefunden = json({}, 404)
  const ra = name => json([{ DOI: '10.48550/arXiv.2401.01234', RA: name }])
  const DATACITE = {
    data: {
      attributes: {
        titles: [{ title: 'Sleep-like replay improves memory consolidation' }],
        creators: [{ familyName: 'Smith', givenName: 'Alice', name: 'Smith, Alice' }, { name: 'arXiv Team' }],
        publicationYear: 2024,
      },
    },
  }

  it('nimmt Crossref, wenn Crossref die DOI kennt', async () => {
    antworten(json(ANTWORT))
    const ergebnis = await Crossref.pruefen('10.5555/x')
    expect(ergebnis).toMatchObject({ gefunden: true, registrierstelle: 'crossref', titel: 'Sleep and Memory' })
    expect(abrufe).toHaveLength(1)
  })

  it('fragt bei 404 doi.org nach der Registrierstelle und holt Titel, Autoren und Jahr bei DataCite', async () => {
    antworten(nichtGefunden, ra('DataCite'), json(DATACITE))
    const ergebnis = await Crossref.pruefen('10.48550/arXiv.2401.01234')
    expect(abrufe.slice(1)).toEqual([
      'https://doi.org/doiRA/10.48550/arXiv.2401.01234',
      'https://api.datacite.org/dois/10.48550/arXiv.2401.01234',
    ])
    expect(ergebnis).toEqual({
      gefunden: true,
      registrierstelle: 'datacite',
      registrierstelleName: 'DataCite',
      titel: 'Sleep-like replay improves memory consolidation',
      autoren: [
        { family: 'Smith', given: 'Alice' },
        { family: 'arXiv Team', given: '' },
      ],
      jahr: 2024,
      retraction: null,
    })
  })

  it('kodiert Sonderzeichen der DOI in jedem Pfadteil', async () => {
    antworten(nichtGefunden, json([{ RA: 'mEDRA' }]))
    await Crossref.pruefen('10.1000/a?b#c d')
    expect(abrufe[1]).toBe('https://doi.org/doiRA/10.1000/a%3Fb%23c%20d')
  })

  it('lehnt DOIs mit Pfadsprüngen ab, ohne doi.org zu fragen', async () => {
    antworten(nichtGefunden)
    expect(await Crossref.pruefen('10.1000/../../x')).toEqual({ gefunden: false, registrierstelle: null })
    expect(abrufe).toHaveLength(1)
  })

  it('meldet eine andere Registrierstelle neutral ohne Metadaten', async () => {
    antworten(nichtGefunden, json([{ DOI: '10.3333/andere.1', RA: 'mEDRA' }]))
    expect(await Crossref.pruefen('10.3333/andere.1')).toEqual({
      gefunden: true,
      registrierstelle: 'medra',
      registrierstelleName: 'mEDRA',
      metadaten: false,
      retraction: null,
    })
  })

  it('meldet eine DOI, die doi.org nicht kennt, als nicht registriert und merkt sich das einen Tag', async () => {
    antworten(nichtGefunden, json([{ DOI: '10.9999/nirgends.1', status: 'DOI does not exist' }]))
    expect(await Crossref.pruefen('10.9999/nirgends.1')).toEqual({ gefunden: false, registrierstelle: null })
    await Crossref.pruefen('10.9999/nirgends.1')
    expect(abrufe).toHaveLength(2)
  })

  it('gibt nicht prüfbar zurück, wenn doi.org nicht antwortet, und merkt sich das nicht', async () => {
    antworten(nichtGefunden, json('Service unavailable', 503))
    expect(await Crossref.pruefen('10.48550/arXiv.2401.01234')).toEqual({ nichtPruefbar: 'registrierstelle_nicht_erreichbar' })
    // Die Antwort von Crossref liegt schon im Cache.
    antworten(ra('DataCite'), json(DATACITE))
    expect((await Crossref.pruefen('10.48550/arXiv.2401.01234')).registrierstelle).toBe('datacite')
  })

  it('gibt nicht prüfbar zurück, wenn DataCite nicht antwortet', async () => {
    antworten(nichtGefunden, ra('DataCite'), new Error('ECONNRESET'))
    expect(await Crossref.pruefen('10.48550/arXiv.2401.01234')).toEqual({ nichtPruefbar: 'registrierstelle_nicht_erreichbar' })
  })

  it('fragt neu, wenn vor dem Update „bei Crossref unbekannt“ im Cache lag', async () => {
    cache.set('10.48550/arxiv.2401.01234', { werk: { gefunden: false }, abgerufenAm: new Date() })
    antworten(ra('DataCite'), json(DATACITE))
    const ergebnis = await Crossref.pruefen('10.48550/arXiv.2401.01234')
    expect(ergebnis).toMatchObject({ gefunden: true, registrierstelle: 'datacite', jahr: 2024 })
  })

  it('leitet doi.org und DataCite im Test auf den Fake um', async () => {
    schalter.paperApiBasis = 'http://127.0.0.1/spur/dev/crossref'
    antworten(nichtGefunden, ra('DataCite'), json(DATACITE))
    await Crossref.pruefen('10.48550/x')
    expect(abrufe.slice(1)).toEqual([
      'http://127.0.0.1/spur/dev/crossref/doiorg/doiRA/10.48550/x',
      'http://127.0.0.1/spur/dev/crossref/datacite/dois/10.48550/x',
    ])
  })
})
