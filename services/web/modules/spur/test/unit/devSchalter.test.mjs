import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Antwort, anfrage } from './hilfen/express.mjs'

let Dev
let gesetzt
let vorbereitet

beforeEach(async () => {
  gesetzt = []
  vorbereitet = vi.fn(async () => {})
  vi.resetModules()
  vi.doMock('../../app/src/schalter.mjs', () => ({ zeitFestlegen: iso => gesetzt.push(iso) }))
  vi.doMock('../../test/e2e/vorbereiten.mjs', () => ({ e2eDatenVorbereiten: vorbereitet }))
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

describe('e2eVorbereiten', () => {
  it('setzt die E2E-Daten im laufenden Prozess zurück und meldet 204', async () => {
    const res = new Antwort()
    await Dev.e2eVorbereiten(anfrage(), res)
    expect(vorbereitet).toHaveBeenCalledTimes(1)
    expect(res.statusCode).toBe(204)
  })

  it('meldet einen Fehler beim Zurücksetzen mit 500 und Text', async () => {
    vorbereitet.mockRejectedValueOnce(new Error('Mongo weg'))
    const res = new Antwort()
    let gesendet
    res.send = inhalt => ((gesendet = inhalt), res)
    await Dev.e2eVorbereiten(anfrage(), res)
    expect(res.statusCode).toBe(500)
    expect(gesendet).toContain('Mongo weg')
  })
})
