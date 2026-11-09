import { describe, expect, it, vi } from 'vitest'
import { Problem, mitProblemen, problemSenden } from '../../app/src/probleme.mjs'
import { Antwort } from './hilfen/express.mjs'
import { meldung } from '../../app/src/meldungen.mjs'

describe('problemSenden', () => {
  it('antwortet nach RFC 9457 als application/problem+json', () => {
    const res = new Antwort()
    problemSenden(res, new Problem(422, 'zitat_text', 'spur_fehler_zitat_text', { max: 2000 }))
    expect(res.statusCode).toBe(422)
    expect(res.kopfzeilen['Content-Type']).toBe('application/problem+json')
    expect(res.body).toEqual({
      type: 'urn:spur:problem:zitat_text',
      title: 'zitat_text',
      status: 422,
      detail: meldung('spur_fehler_zitat_text', { max: 2000 }),
    })
  })
})

describe('mitProblemen', () => {
  it('beantwortet geworfene Probleme als Problem-Antwort', async () => {
    const res = new Antwort()
    const next = vi.fn()
    await mitProblemen(async () => {
      throw new Problem(404, 'quelle_fehlt', 'spur_fehler_quelle_fehlt')
    })({}, res, next)
    expect(res.statusCode).toBe(404)
    expect(next).not.toHaveBeenCalled()
  })

  it('übergibt andere Fehler an Express', async () => {
    const res = new Antwort()
    const next = vi.fn()
    const fehler = new Error('kaputt')
    await mitProblemen(async () => {
      throw fehler
    })({}, res, next)
    expect(next).toHaveBeenCalledWith(fehler)
    expect(res.body).toBeUndefined()
  })

  it('reicht Request und Response an den Handler', async () => {
    const handler = vi.fn()
    await mitProblemen(handler)('req', 'res', vi.fn())
    expect(handler).toHaveBeenCalledWith('req', 'res')
  })
})
