import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let dateisystem
let schalter

function dateiVorgeben(inhalt, stand = 1) {
  dateisystem.datei = inhalt === undefined ? undefined : { inhalt: JSON.stringify(inhalt), stand }
}

async function laden(dev) {
  vi.stubEnv('SPUR_DEV', dev ? '1' : '0')
  vi.resetModules()
  vi.doMock('node:fs', () => ({
    statSync: () => (dateisystem.datei ? { mtimeMs: dateisystem.datei.stand } : undefined),
    readFileSync: () => {
      dateisystem.gelesen++
      return dateisystem.datei.inhalt
    },
  }))
  schalter = await import('../../app/src/schalter.mjs')
}

beforeEach(() => {
  dateisystem = { datei: undefined, gelesen: 0 }
})
afterEach(() => vi.unstubAllEnvs())

describe('Testschalter außerhalb der Dev-Umgebung', () => {
  it('ignoriert die Schalterdatei', async () => {
    dateiVorgeben({ SPUR_NOW: '2020-01-01T00:00:00Z', SPUR_PAPER_API_BASE: 'http://fake' })
    await laden(false)
    expect(schalter.IST_DEV).toBe(false)
    expect(schalter.paperApiBasis()).toBeUndefined()
    expect(schalter.jetzt().getFullYear()).toBeGreaterThan(2025)
    expect(dateisystem.gelesen).toBe(0)
  })
})

describe('Testschalter in der Dev-Umgebung', () => {
  it('nimmt die echte Zeit und keine Basis-URL, solange die Datei fehlt', async () => {
    await laden(true)
    expect(schalter.IST_DEV).toBe(true)
    expect(schalter.paperApiBasis()).toBeUndefined()
    expect(Math.abs(schalter.jetzt() - new Date())).toBeLessThan(1000)
  })

  it('setzt Zeit und Basis-URL aus der Datei', async () => {
    dateiVorgeben({ SPUR_NOW: '2026-12-24T18:00:00Z', SPUR_PAPER_API_BASE: 'http://127.0.0.1/fake' })
    await laden(true)
    expect(schalter.jetzt()).toEqual(new Date('2026-12-24T18:00:00Z'))
    expect(schalter.paperApiBasis()).toBe('http://127.0.0.1/fake')
  })

  it('gibt bei jedem Aufruf eine neue Zeit-Instanz zurück', async () => {
    dateiVorgeben({ SPUR_NOW: '2026-12-24T18:00:00Z' })
    await laden(true)
    const a = schalter.jetzt()
    a.setFullYear(1999)
    expect(schalter.jetzt().getFullYear()).toBe(2026)
  })

  it('liest die Datei nur neu, wenn sie sich geändert hat', async () => {
    dateiVorgeben({ SPUR_PAPER_API_BASE: 'http://a' }, 1)
    await laden(true)
    schalter.paperApiBasis()
    schalter.paperApiBasis()
    expect(dateisystem.gelesen).toBe(1)
    dateiVorgeben({ SPUR_PAPER_API_BASE: 'http://b' }, 2)
    expect(schalter.paperApiBasis()).toBe('http://b')
    expect(dateisystem.gelesen).toBe(2)
  })

  it('fällt auf die echte Zeit zurück, wenn die Datei wieder verschwindet', async () => {
    dateiVorgeben({ SPUR_NOW: '2020-01-01T00:00:00Z' })
    await laden(true)
    expect(schalter.jetzt().getFullYear()).toBe(2020)
    dateiVorgeben(undefined)
    expect(schalter.jetzt().getFullYear()).toBeGreaterThan(2025)
  })
})

describe('SPUR_NOW zur Laufzeit (E2E)', () => {
  it('legt die Zeit im Prozess fest, vor der Datei, und gibt sie mit null wieder frei', async () => {
    dateiVorgeben({ SPUR_NOW: '2020-01-01T00:00:00Z' })
    await laden(true)
    schalter.zeitFestlegen('2026-11-01T09:00:00Z')
    expect(schalter.jetzt()).toEqual(new Date('2026-11-01T09:00:00Z'))
    schalter.zeitFestlegen(null)
    expect(schalter.jetzt()).toEqual(new Date('2020-01-01T00:00:00Z'))
  })

  it('wirkt außerhalb der Dev-Umgebung nicht', async () => {
    await laden(false)
    schalter.zeitFestlegen('2020-01-01T00:00:00Z')
    expect(schalter.jetzt().getFullYear()).toBeGreaterThan(2025)
  })
})
