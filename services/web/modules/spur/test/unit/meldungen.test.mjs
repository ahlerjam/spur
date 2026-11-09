import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'

const MODUL = fileURLToPath(new URL('../../', import.meta.url))
const laden = sprache =>
  JSON.parse(readFileSync(new URL(`../../../../locales/${sprache}.json`, import.meta.url), 'utf8'))

async function mitSprache(sprache) {
  vi.resetModules()
  vi.doMock('@overleaf/settings', () => ({ default: { i18n: { defaultLng: sprache } } }))
  return {
    ...(await import('../../app/src/meldungen.mjs')),
    ...(await import('../../app/src/probleme.mjs')),
    ...(await import('../../app/src/mcp/fehler.mjs')),
  }
}

afterEach(() => {
  vi.doUnmock('@overleaf/settings')
})

describe('Meldungen in der Sprache der Installation', () => {
  it('liefert auf einer deutschen Installation den deutschen Text, Fehlercode bleibt', async () => {
    const { Problem } = await mitSprache('de')
    const problem = new Problem(404, 'doc_fehlt', 'spur_fehler_doc_fehlt')
    expect(problem.typ).toBe('doc_fehlt')
    expect(problem.message).toBe(laden('de').spur_fehler_doc_fehlt)
    expect(problem.message).toMatch(/Dokument/)
  })

  it('liefert auf einer englischen Installation den englischen Text, Fehlercode bleibt', async () => {
    const { Problem } = await mitSprache('en')
    const problem = new Problem(404, 'doc_fehlt', 'spur_fehler_doc_fehlt')
    expect(problem.typ).toBe('doc_fehlt')
    expect(problem.message).toBe('The document does not exist (anymore).')
  })

  it('setzt Platzhalter in beiden Sprachen ein', async () => {
    for (const sprache of ['de', 'en']) {
      const { Problem } = await mitSprache(sprache)
      const problem = new Problem(422, 'fassung', 'spur_fehler_fassung_zu_lang', { max: 200 })
      expect(problem.message).toContain('200')
      expect(problem.message).not.toContain('__')
    }
  })

  it('fällt bei anderen Sprachen auf Englisch zurück', async () => {
    const { meldung } = await mitSprache('fr')
    expect(meldung('spur_fehler_doc_fehlt')).toBe(laden('en').spur_fehler_doc_fehlt)
  })

  it('übersetzt auch Werkzeugfehler für MCP', async () => {
    const { WerkzeugFehler } = await mitSprache('en')
    const fehler = new WerkzeugFehler('job_fehlt', 'spur_fehler_job_fehlt')
    expect(fehler.code).toBe('job_fehlt')
    expect(fehler.message).toBe(laden('en').spur_fehler_job_fehlt)
  })

  it('meldet einen unbekannten Schlüssel laut statt ihn anzuzeigen', async () => {
    const { meldung } = await mitSprache('de')
    expect(() => meldung('spur_gibt_es_nicht')).toThrow(/spur_gibt_es_nicht/)
  })
})

function dateien(ordner) {
  return readdirSync(ordner).flatMap(name => {
    const pfad = join(ordner, name)
    if (statSync(pfad).isDirectory()) return dateien(pfad)
    return pfad.endsWith('.mjs') ? [pfad] : []
  })
}

describe('Fehlermeldungen im Code', () => {
  const quellen = dateien(join(MODUL, 'app/src')).map(pfad => ({
    pfad: pfad.slice(MODUL.length),
    text: readFileSync(pfad, 'utf8'),
  }))
  // Meldungsargument: drittes bei Problem, zweites bei WerkzeugFehler, erstes bei meldung.
  const MUSTER = [
    /new Problem\(\s*[^,]+,\s*[^,]+,\s*([^,)]+)/g,
    /new WerkzeugFehler\(\s*[^,]+,\s*([^,)]+)/g,
    /\bmeldung\(\s*([^,)]+)/g,
  ]
  // `schluessel` ist das Durchreichen in meldungen.mjs, Problem und WerkzeugFehler selbst.
  const aufrufe = quellen
    .flatMap(({ pfad, text }) =>
      MUSTER.flatMap(muster => [...text.matchAll(muster)].map(m => ({ pfad, argument: m[1].trim() })))
    )
    .filter(a => a.argument !== 'schluessel')

  it('findet die Aufrufe überhaupt', () => {
    expect(aufrufe.length).toBeGreaterThan(100)
  })

  it('keine Meldung steht als fester Text im Code; jede nutzt einen spur-Schlüssel', () => {
    const fest = aufrufe.filter(a => !/^'spur_[a-z0-9_]+'$/.test(a.argument))
    expect(fest.map(a => `${a.pfad}: ${a.argument}`)).toEqual([])
  })

  it('jeder genutzte Schlüssel steht in beiden Sprachen', () => {
    const de = laden('de')
    const en = laden('en')
    const fehlend = aufrufe
      .map(a => a.argument.slice(1, -1))
      .filter(k => !(k in de) || !(k in en))
    expect(fehlend).toEqual([])
  })
})
