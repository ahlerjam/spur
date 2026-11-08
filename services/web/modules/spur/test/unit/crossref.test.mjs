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

const json = (daten, status = 200) => ({ status, ok: status < 400, json: async () => daten })
const mitUpdates = (...typen) => json({ message: { ...ANTWORT.message, 'updated-by': typen.map(type => ({ type })) } })

beforeEach(async () => {
  abrufe = []
  cache = new Map()
  schalter = schalterAttrappe()
  vi.useFakeTimers({ toFake: ['Date'] })
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

  it('liefert bei Ausfall nichts und wartet fünf Minuten bis zum nächsten Versuch', async () => {
    antworten(new Error('Netz weg'), json(ANTWORT))
    expect(await Crossref.werk('10.1/a')).toBeNull()
    expect(await Crossref.werk('10.1/a')).toBeNull()
    expect(abrufe).toHaveLength(1)
    vi.setSystemTime(new Date('2026-11-07T10:05:01Z'))
    expect((await Crossref.werk('10.1/a')).gefunden).toBe(true)
    expect(abrufe).toHaveLength(2)
  })

  it('behandelt einen Serverfehler wie einen Ausfall', async () => {
    antworten(json({}, 503))
    expect(await Crossref.werk('10.1/a')).toBeNull()
  })

  it('behält bei Ausfall den abgelaufenen Eintrag', async () => {
    antworten(json(ANTWORT), new Error('Netz weg'))
    await Crossref.werk('10.1/a')
    schalter.zeit = new Date('2026-11-09T10:00:00Z')
    expect((await Crossref.werk('10.1/a')).titel).toBe('Sleep and Memory')
  })
})
