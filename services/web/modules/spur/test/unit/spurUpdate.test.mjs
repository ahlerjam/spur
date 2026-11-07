import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fehlerVon } from './hilfen/fehler.mjs'

let fetchNothing
let spurUpdate

class RequestFailedError extends Error {
  constructor(status) {
    super(`status ${status}`)
    this.response = { status }
  }
}

beforeEach(async () => {
  fetchNothing = vi.fn(async () => {})
  vi.resetModules()
  vi.doMock('@overleaf/fetch-utils', () => ({ fetchNothing, RequestFailedError }))
  vi.doMock('@overleaf/settings', () => ({ default: { apis: { documentupdater: { url: 'http://du' } } } }))
  ;({ spurUpdate } = await import('../../app/src/schreiben/spurUpdate.mjs'))
})

describe('spurUpdate', () => {
  it('schickt Ops, Version und Quelle an den spur-Endpunkt des document-updater', async () => {
    await spurUpdate('p1', 'd1', [{ p: 0, i: 'x' }], 7, { userId: 'u1' })
    const [url, optionen] = fetchNothing.mock.calls[0]
    expect(url).toBe('http://du/project/p1/doc/d1/spur-update')
    expect(optionen.method).toBe('POST')
    expect(optionen.json).toEqual({ op: [{ p: 0, i: 'x' }], v: 7, meta: { user_id: 'u1', source: 'spur' } })
  })

  it('fügt für Track Changes eine Kennung aus 18 Hex-Zeichen hinzu, jedes Mal eine neue', async () => {
    await spurUpdate('p1', 'd1', [], 1, { userId: 'u1', tracked: true })
    await spurUpdate('p1', 'd1', [], 1, { userId: 'u1', tracked: true })
    const [a, b] = fetchNothing.mock.calls.map(([, o]) => o.json.meta.tc)
    expect(a).toMatch(/^[0-9a-f]{18}$/)
    expect(a).not.toBe(b)
  })

  it('meldet 409 des document-updater als konflikt', async () => {
    fetchNothing.mockRejectedValueOnce(new RequestFailedError(409))
    expect(await fehlerVon(spurUpdate('p1', 'd1', [], 1, {}))).toMatchObject({ status: 409, typ: 'konflikt' })
  })

  it('meldet 404 als doc_fehlt', async () => {
    fetchNothing.mockRejectedValueOnce(new RequestFailedError(404))
    expect(await fehlerVon(spurUpdate('p1', 'd1', [], 1, {}))).toMatchObject({ status: 404, typ: 'doc_fehlt' })
  })

  it('reicht andere Fehler weiter', async () => {
    fetchNothing.mockRejectedValueOnce(new RequestFailedError(500))
    expect((await fehlerVon(spurUpdate('p1', 'd1', [], 1, {}))).response.status).toBe(500)
    fetchNothing.mockRejectedValueOnce(new Error('Netz'))
    expect((await fehlerVon(spurUpdate('p1', 'd1', [], 1, {}))).message).toBe('Netz')
  })
})
