import { EventEmitter } from 'node:events'
import { beforeEach, describe, expect, it, vi } from 'vitest'

let beobachten
let m
const PROJEKT = '0123456789abcdef01234567'
const THREAD = 'aaaaaaaaaaaaaaaaaaaaaaaa'
const MENSCH = 'bbbbbbbbbbbbbbbbbbbbbbbb'

beforeEach(async () => {
  m = {
    Erwaehnung: { kommentarGesendet: vi.fn(async () => {}) },
    Vorschlaege: { ausloesen: vi.fn(async ({ daten }) => ({ daten: await daten() })) },
    Kompilieren: { fehlerDesCompiles: vi.fn(async () => [{ zeile: 4, meldung: 'Undefined control sequence.' }]) },
    SessionManager: { getLoggedInUserId: vi.fn(session => session?.user?._id ?? null) },
  }
  vi.resetModules()
  vi.doMock('../../app/src/erwaehnung/Erwaehnung.mjs', () => m.Erwaehnung)
  vi.doMock('../../app/src/vorschlaege/Vorschlaege.mjs', () => m.Vorschlaege)
  vi.doMock('../../app/src/kompilieren/Kompilieren.mjs', () => m.Kompilieren)
  vi.doMock('../../../../app/src/Features/Authentication/SessionManager.mjs', () => ({ default: m.SessionManager }))
  ;({ beobachten } = await import('../../app/src/Beobachter.mjs'))
})

function anfrage(pfad, { body = {}, query = {}, angemeldet = true } = {}) {
  const res = new EventEmitter()
  res.statusCode = 200
  res.json = vi.fn(() => res)
  const req = { method: 'POST', path: pfad, body, query, session: angemeldet ? { user: { _id: MENSCH } } : {} }
  const next = vi.fn()
  beobachten(req, res, next)
  expect(next).toHaveBeenCalledOnce()
  return res
}

const ruhe = () => new Promise(r => setImmediate(r))

describe('Kommentare', () => {
  it('meldet einen gesendeten Kommentar mit Projekt, Thread, Person und Text', async () => {
    const res = anfrage(`/project/${PROJEKT}/thread/${THREAD}/messages`, { body: { content: '@claude prüfe das' } })
    res.statusCode = 204
    res.emit('finish')
    await ruhe()
    const [aufruf] = m.Erwaehnung.kommentarGesendet.mock.calls[0]
    expect(String(aufruf.projectId)).toBe(PROJEKT)
    expect(String(aufruf.menschId)).toBe(MENSCH)
    expect(aufruf).toMatchObject({ threadId: THREAD, text: '@claude prüfe das' })
  })

  it('übergeht abgelehnte Kommentare und Bearbeitungen', async () => {
    const abgelehnt = anfrage(`/project/${PROJEKT}/thread/${THREAD}/messages`, { body: { content: '@claude' } })
    abgelehnt.statusCode = 403
    abgelehnt.emit('finish')
    anfrage(`/project/${PROJEKT}/thread/${THREAD}/messages/m1/edit`, { body: { content: '@claude' } }).emit('finish')
    await ruhe()
    expect(m.Erwaehnung.kommentarGesendet).not.toHaveBeenCalled()
  })
})

describe('Compile', () => {
  it('löst nach einem Compile mit den Fehlern aus dem Log aus', async () => {
    const res = anfrage(`/project/${PROJEKT}/compile`)
    res.json({ status: 'success', buildId: 'b1', clsiServerId: 'c1' })
    await ruhe()
    const [aufruf] = m.Vorschlaege.ausloesen.mock.calls[0]
    expect(aufruf).toMatchObject({ art: 'compile_fehler' })
    expect(m.Kompilieren.fehlerDesCompiles).toHaveBeenCalledWith(
      expect.objectContaining({ buildId: 'b1', clsiServerId: 'c1' })
    )
    expect(await m.Vorschlaege.ausloesen.mock.results[0].value).toEqual({
      daten: { fehler: [{ zeile: 4, meldung: 'Undefined control sequence.' }] },
    })
  })

  it('nimmt den Build aus outputFiles, wie Overleaf CE ihn liefert', async () => {
    anfrage(`/project/${PROJEKT}/compile`).json({
      status: 'success',
      outputFiles: [
        { path: 'output.pdf', build: '1a1b-pdf' },
        { path: 'output.log', build: '1a1b-log' },
      ],
    })
    await ruhe()
    expect(await m.Vorschlaege.ausloesen.mock.results[0].value).toMatchObject({ daten: { fehler: [{ zeile: 4 }] } })
    expect(m.Kompilieren.fehlerDesCompiles).toHaveBeenCalledWith(expect.objectContaining({ buildId: '1a1b-log' }))
  })

  it('ohne Fehler im Log gibt es keinen Anlass', async () => {
    m.Kompilieren.fehlerDesCompiles.mockResolvedValue([])
    anfrage(`/project/${PROJEKT}/compile`).json({ status: 'success', buildId: 'b1' })
    await ruhe()
    expect(await m.Vorschlaege.ausloesen.mock.results[0].value).toEqual({ daten: null })
  })

  it('übergeht Auto-Compiles, Compiles ohne Build und fremde Pfade', async () => {
    anfrage(`/project/${PROJEKT}/compile`, { query: { auto_compile: 'true' } }).json({ status: 'success', buildId: 'b1' })
    anfrage(`/project/${PROJEKT}/compile`).json({ status: 'too-recently-compiled' })
    anfrage(`/project/${PROJEKT}/compile`, { angemeldet: false }).json({ status: 'success', buildId: 'b1' })
    anfrage(`/project/${PROJEKT}/compile/stop`).json({})
    await ruhe()
    expect(m.Vorschlaege.ausloesen).not.toHaveBeenCalled()
  })
})
