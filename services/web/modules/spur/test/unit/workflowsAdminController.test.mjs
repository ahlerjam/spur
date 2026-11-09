import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Antwort, anfrage } from './hilfen/express.mjs'
import { ObjectId } from './hilfen/datenbank.mjs'

let C
let m
const admin = new ObjectId()

beforeEach(async () => {
  m = {
    liste: vi.fn(async () => [{ name: 'folien', text: 'T', angepasst: true }]),
    setzen: vi.fn(async () => {}),
    zuruecksetzen: vi.fn(async () => {}),
  }
  vi.resetModules()
  vi.doMock('../../app/src/workflows/Workflows.mjs', () => m)
  vi.doMock('../../../../app/src/Features/Authentication/SessionManager.mjs', () => ({
    default: { getLoggedInUserId: () => String(admin) },
  }))
  C = await import('../../app/src/workflows/WorkflowsAdminController.mjs')
})

const ausfuehren = async (handler, req) => {
  const res = new Antwort()
  res.render = vi.fn()
  await handler(req, res, vi.fn())
  return res
}

describe('Workflows im Admin-Bereich', () => {
  it('rendert die Seite und liefert die Liste mit vollem Text', async () => {
    const seite = await ausfuehren(C.seite, anfrage())
    expect(seite.render.mock.calls[0][0]).toMatch(/views\/workflows-admin$/)
    expect((await ausfuehren(C.liste, anfrage())).body).toEqual({ workflows: [{ name: 'folien', text: 'T', angepasst: true }] })
  })

  it('speichert einen Text mit der Person, die ihn geändert hat, und setzt zurück', async () => {
    const gesetzt = await ausfuehren(C.setzen, anfrage({ params: { name: 'folien' }, body: { text: 'Neu' } }))
    expect(gesetzt.statusCode).toBe(204)
    expect(m.setzen).toHaveBeenCalledWith('folien', 'Neu', admin)
    expect((await ausfuehren(C.zuruecksetzen, anfrage({ params: { name: 'folien' } }))).statusCode).toBe(204)
    expect(m.zuruecksetzen).toHaveBeenCalledWith('folien')
  })
})
