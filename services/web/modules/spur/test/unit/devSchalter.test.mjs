import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Antwort, anfrage } from './hilfen/express.mjs'

let Dev
let gesetzt

beforeEach(async () => {
  gesetzt = []
  vi.resetModules()
  vi.doMock('../../app/src/schalter.mjs', () => ({ zeitFestlegen: iso => gesetzt.push(iso) }))
  Dev = await import('../../app/src/dev/DevSchalter.mjs')
})

const setzen = jetzt => {
  const res = new Antwort()
  Dev.zeitSetzen(anfrage({ body: { jetzt } }), res)
  return res
}

describe('zeitSetzen', () => {
  it('legt SPUR_NOW fest und gibt es mit null frei', () => {
    expect(setzen('2026-11-01T09:00:00Z').statusCode).toBe(204)
    setzen(null)
    expect(gesetzt).toEqual(['2026-11-01T09:00:00Z', null])
  })

  it('lehnt Unsinn ab', () => {
    expect(setzen('quatsch').statusCode).toBe(422)
    expect(setzen(undefined).statusCode).toBe(422)
    expect(gesetzt).toEqual([])
  })
})

describe('testseite', () => {
  it('liefert die statische Testseite als HTML', () => {
    const res = new Antwort()
    let gesendet
    res.send = inhalt => ((gesendet = inhalt), res)
    Dev.testseite(anfrage(), res)
    expect(res.kopfzeilen['Content-Type']).toBe('html')
    expect(gesendet).toContain('<title>Schlafhygiene im Schichtdienst</title>')
  })
})
