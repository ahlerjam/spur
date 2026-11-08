import { beforeEach, describe, expect, it, vi } from 'vitest'

let live
let gesendet

beforeEach(async () => {
  gesendet = []
  vi.resetModules()
  vi.doMock('../../../../app/src/Features/Editor/EditorRealTimeController.mjs', () => ({
    default: { emitToRoom: (...args) => gesendet.push(args) },
  }))
  live = await import('../../app/src/live.mjs')
})

describe('live', () => {
  it('meldet Änderungen an Zitaten und Quellen nur mit IDs in den Raum des Projekts', () => {
    const quelle = { _id: 'q1', projectId: 'p1', text: 'geheim' }
    live.zitateGeaendert(quelle)
    live.quelleGeaendert(quelle)
    expect(gesendet).toEqual([
      ['p1', 'spur:zitate', { quelleId: 'q1' }],
      ['p1', 'spur:quellen', { quelleId: 'q1' }],
    ])
  })
})
