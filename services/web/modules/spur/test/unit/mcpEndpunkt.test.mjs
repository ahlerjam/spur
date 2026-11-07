import { createServer } from 'node:http'
import express from 'express'
import * as z from 'zod/v4'
import logger from '@overleaf/logger'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

let server
let basis
let verbrauchen
let aufgerufen
const zugang = { menschId: 'mensch1', botId: 'bot1', tokenId: 't1' }

// Erst nach dem Zurücksetzen der Module gebaut: Fehlerklassen müssen dieselben sein wie im Endpunkt.
let WERKZEUGE
let WerkzeugFehler
let Problem

const werkzeuge = () => ({
  echo: {
    description: 'Gibt die Eingabe zurück.',
    inputSchema: z.object({ text: z.string() }),
    ausfuehren: async (args, kontext) => {
      aufgerufen.push({ args, kontext })
      return { text: args.text }
    },
  },
  werkzeugfehler: {
    description: 'Wirft einen Werkzeugfehler.',
    inputSchema: z.object({}),
    ausfuehren: async () => {
      throw new WerkzeugFehler('keine_rechte', 'Die Projektrolle erlaubt das nicht.')
    },
  },
  problem: {
    description: 'Wirft ein Problem.',
    inputSchema: z.object({}),
    ausfuehren: async () => {
      throw new Problem(404, 'quelle_fehlt', 'Diese Quelle gibt es nicht mehr.')
    },
  },
  abstuerzen: {
    description: 'Wirft einen unerwarteten Fehler.',
    inputSchema: z.object({}),
    ausfuehren: async () => {
      throw new Error('Passwort ist hunter2')
    },
  },
})

beforeAll(async () => {
  verbrauchen = vi.fn(async () => {})
  vi.resetModules()
  ;({ WerkzeugFehler } = await import('../../app/src/mcp/fehler.mjs'))
  ;({ Problem } = await import('../../app/src/probleme.mjs'))
  WERKZEUGE = werkzeuge()
  vi.doMock('@overleaf/settings', () => ({ default: { siteUrl: 'http://localhost:8080', max_json_request_size: 2000 } }))
  vi.doMock('../../../../app/src/infrastructure/RateLimiter.mjs', () => ({
    RateLimiter: class {
      consume = (...args) => verbrauchen(...args)
    },
  }))
  vi.doMock('../../app/src/ClaudeZugang.mjs', () => ({
    SCOPE: 'spur_mcp',
    pruefen: async token => (token === 'gut' ? zugang : null),
  }))
  vi.doMock('../../app/src/mcp/werkzeuge.mjs', () => ({ WERKZEUGE }))
  const { mcpAnfrage, mcpJson } = await import('../../app/src/mcp/McpEndpunkt.mjs')
  const app = express()
  app.use('/spur/mcp', mcpJson)
  app.all('/spur/mcp', mcpAnfrage)
  server = createServer(app)
  await new Promise(fertig => server.listen(0, '127.0.0.1', fertig))
  basis = `http://127.0.0.1:${server.address().port}/spur/mcp`
})
afterAll(() => new Promise(fertig => server.close(fertig)))

beforeEach(() => {
  aufgerufen = []
  verbrauchen.mockReset()
  verbrauchen.mockResolvedValue(undefined)
})

async function senden(nachricht, { token = 'gut', header = {}, body } = {}) {
  const antwort = await fetch(basis, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...header,
    },
    body: body ?? JSON.stringify({ jsonrpc: '2.0', id: 1, ...nachricht }),
  })
  const text = await antwort.text()
  const daten = antwort.headers.get('content-type')?.includes('event-stream')
    ? [...text.matchAll(/^data: (.*)$/gm)].map(m => JSON.parse(m[1]))
    : text && JSON.parse(text)
  return { antwort, daten, text }
}

const aufruf = (name, args = {}) => senden({ method: 'tools/call', params: { name, arguments: args } })
const ergebnisVon = ({ daten }) => (Array.isArray(daten) ? daten.at(-1) : daten).result

describe('Zugang', () => {
  it('weist Anfragen ohne Token mit 401 als Problem-Antwort ab', async () => {
    const { antwort, daten } = await senden({ method: 'tools/list' }, { token: null })
    expect(antwort.status).toBe(401)
    expect(antwort.headers.get('www-authenticate')).toBe('Bearer realm="spur"')
    expect(antwort.headers.get('content-type')).toContain('application/problem+json')
    expect(daten).toMatchObject({ type: 'urn:spur:problem:token', status: 401 })
  })

  it('weist ein unbekanntes oder widerrufenes Token ab', async () => {
    expect((await senden({ method: 'tools/list' }, { token: 'widerrufen' })).antwort.status).toBe(401)
  })

  it('weist fremde Origins mit 403 ab', async () => {
    const { antwort, daten } = await senden({ method: 'tools/list' }, { header: { Origin: 'http://boese.example' } })
    expect(antwort.status).toBe(403)
    expect(daten.type).toBe('urn:spur:problem:origin')
  })

  it('lässt die eigene Origin und Anfragen ohne Origin zu', async () => {
    expect((await senden({ method: 'tools/list' }, { header: { Origin: 'http://localhost:8080' } })).antwort.status).toBe(200)
    expect((await senden({ method: 'tools/list' })).antwort.status).toBe(200)
  })
})

describe('Begrenzung', () => {
  it('zählt die Anfragen je Mensch', async () => {
    await senden({ method: 'tools/list' })
    expect(verbrauchen).toHaveBeenCalledWith('mensch1', 1, { method: 'userId' })
  })

  it('antwortet bei Überschreitung mit 429 und Retry-After in ganzen Sekunden', async () => {
    verbrauchen.mockRejectedValue({ msBeforeNext: 12345 })
    const { antwort, daten } = await senden({ method: 'tools/list' })
    expect(antwort.status).toBe(429)
    expect(antwort.headers.get('retry-after')).toBe('13')
    expect(daten.type).toBe('urn:spur:problem:zu_viele_anfragen')
    expect(daten.detail).toContain('13 Sekunden')
  })

  it('wartet mindestens eine Sekunde', async () => {
    verbrauchen.mockRejectedValue({ msBeforeNext: 10 })
    expect((await senden({ method: 'tools/list' })).antwort.headers.get('retry-after')).toBe('1')
  })

  it('behandelt einen Ausfall des Zählers als Fehler, nicht als Limit', async () => {
    verbrauchen.mockRejectedValue(new Error('Redis weg'))
    const { antwort, daten } = await senden({ method: 'tools/list' })
    expect(antwort.status).toBe(500)
    expect(daten.type).toBe('urn:spur:problem:intern')
    expect(antwort.headers.get('retry-after')).toBeNull()
  })
})

describe('Eingabe', () => {
  it('antwortet auf kaputtes JSON mit 400 json_kaputt', async () => {
    const { antwort, daten } = await senden(null, { body: '{"jsonrpc":' })
    expect(antwort.status).toBe(400)
    expect(daten.type).toBe('urn:spur:problem:json_kaputt')
  })

  it('antwortet auf zu große Anfragen mit 413 zu_gross', async () => {
    const { antwort, daten } = await senden(null, { body: JSON.stringify({ x: 'a'.repeat(5000) }) })
    expect(antwort.status).toBe(413)
    expect(daten.type).toBe('urn:spur:problem:zu_gross')
  })
})

describe('Werkzeugaufrufe', () => {
  it('listet die Werkzeuge mit Beschreibung', async () => {
    const ergebnis = ergebnisVon(await senden({ method: 'tools/list' }))
    expect(ergebnis.tools.map(t => t.name).sort()).toEqual(['abstuerzen', 'echo', 'problem', 'werkzeugfehler'])
    expect(ergebnis.tools.find(t => t.name === 'echo').description).toBe('Gibt die Eingabe zurück.')
  })

  it('führt ein Werkzeug mit dem Kontext des Tokens aus und liefert das Ergebnis als JSON-Text', async () => {
    const ergebnis = ergebnisVon(await aufruf('echo', { text: 'Hallo' }))
    expect(JSON.parse(ergebnis.content[0].text)).toEqual({ text: 'Hallo' })
    expect(ergebnis.isError).toBeUndefined()
    expect(aufgerufen).toEqual([{ args: { text: 'Hallo' }, kontext: zugang }])
  })

  it('gibt Werkzeugfehler als isError mit stabilem Code zurück', async () => {
    const ergebnis = ergebnisVon(await aufruf('werkzeugfehler'))
    expect(ergebnis.isError).toBe(true)
    expect(JSON.parse(ergebnis.content[0].text)).toEqual({
      fehler: 'keine_rechte',
      detail: 'Die Projektrolle erlaubt das nicht.',
    })
  })

  it('gibt Probleme der Manager mit ihrem Typ als Code zurück', async () => {
    const ergebnis = ergebnisVon(await aufruf('problem'))
    expect(JSON.parse(ergebnis.content[0].text)).toEqual({ fehler: 'quelle_fehlt', detail: 'Diese Quelle gibt es nicht mehr.' })
  })

  it('verbirgt unerwartete Fehler hinter interner_fehler und protokolliert sie', async () => {
    const ergebnis = ergebnisVon(await aufruf('abstuerzen'))
    expect(ergebnis.isError).toBe(true)
    const inhalt = JSON.parse(ergebnis.content[0].text)
    expect(inhalt.fehler).toBe('interner_fehler')
    expect(ergebnis.content[0].text).not.toContain('hunter2')
    expect(logger.error).toHaveBeenCalledWith(expect.objectContaining({ werkzeug: 'abstuerzen' }), expect.any(String))
  })

  it('weist ungültige Argumente zurück, ohne das Werkzeug aufzurufen', async () => {
    const antwort = await aufruf('echo', { text: 42 })
    const daten = Array.isArray(antwort.daten) ? antwort.daten.at(-1) : antwort.daten
    expect(daten.error || daten.result?.isError).toBeTruthy()
    expect(aufgerufen).toEqual([])
  })
})
