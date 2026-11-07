import { describe, expect, it, vi } from 'vitest'
import { Problem, mitProblemen, problemSenden } from '../../app/src/probleme.mjs'

function antwort() {
  const res = {}
  res.status = vi.fn(() => res)
  res.type = vi.fn(() => res)
  res.json = vi.fn(() => res)
  return res
}

describe('problemSenden', () => {
  it('antwortet nach RFC 9457 als application/problem+json', () => {
    const res = antwort()
    problemSenden(res, new Problem(422, 'zitat_text', 'Bitte eine Textstelle markieren.'))
    expect(res.status).toHaveBeenCalledWith(422)
    expect(res.type).toHaveBeenCalledWith('application/problem+json')
    expect(res.json).toHaveBeenCalledWith({
      type: 'urn:spur:problem:zitat_text',
      title: 'zitat_text',
      status: 422,
      detail: 'Bitte eine Textstelle markieren.',
    })
  })
})

describe('mitProblemen', () => {
  it('beantwortet geworfene Probleme als Problem-Antwort', async () => {
    const res = antwort()
    const next = vi.fn()
    await mitProblemen(async () => {
      throw new Problem(404, 'quelle_fehlt', 'weg')
    })({}, res, next)
    expect(res.status).toHaveBeenCalledWith(404)
    expect(next).not.toHaveBeenCalled()
  })

  it('übergibt andere Fehler an Express', async () => {
    const res = antwort()
    const next = vi.fn()
    const fehler = new Error('kaputt')
    await mitProblemen(async () => {
      throw fehler
    })({}, res, next)
    expect(next).toHaveBeenCalledWith(fehler)
    expect(res.status).not.toHaveBeenCalled()
  })

  it('reicht Request und Response an den Handler', async () => {
    const handler = vi.fn()
    await mitProblemen(handler)('req', 'res', vi.fn())
    expect(handler).toHaveBeenCalledWith('req', 'res')
  })
})
