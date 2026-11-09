import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Antwort, anfrage } from './hilfen/express.mjs'
import { ObjectId } from './hilfen/datenbank.mjs'

let C
let m
let docsImProjekt
const projekt = new ObjectId()
const ada = new ObjectId()

beforeEach(async () => {
  m = {
    Vorschlaege: {
      panel: vi.fn(async () => ({
        stand: { wirksam: { compile_fehler: 'aus' }, limit: 50, heute: 0, limitErreicht: false },
        vorschlaege: [{ id: 'v1', titel: 'Beleg fehlt' }],
      })),
      eigeneSetzen: vi.fn(async () => {}),
      projektSetzen: vi.fn(async () => {}),
      limitSetzen: vi.fn(async () => {}),
      uebernehmen: vi.fn(async () => {}),
      verwerfen: vi.fn(async () => {
        // Erst beim Aufruf laden: nach resetModules ist das die Klasse, die der Controller kennt.
        const { Problem } = await import('../../app/src/probleme.mjs')
        throw new Problem(404, 'vorschlag_fehlt', 'weg')
      }),
      ausloesen: vi.fn(async ({ daten }) => ({ ausgeloest: true, daten: daten() })),
    },
  }
  docsImProjekt = new Set()
  vi.resetModules()
  vi.doMock('../../app/src/vorschlaege/Vorschlaege.mjs', () => m.Vorschlaege)
  vi.doMock('../../../../app/src/Features/Project/ProjectLocator.mjs', () => ({
    default: {
      promises: {
        findElement: async ({ project_id: projektId, element_id: id, type }) => {
          if (String(projektId) === String(projekt) && type === 'doc' && docsImProjekt.has(String(id))) {
            return { element: { _id: id }, path: { fileSystem: '/kapitel.tex' } }
          }
          if (String(id) === 'f'.repeat(24)) throw new Error('Mongo weg')
          const { default: Errors } = await import('../../../../app/src/Features/Errors/Errors.js')
          throw new Errors.NotFoundError('weg')
        },
      },
    },
  }))
  vi.doMock('../../../../app/src/Features/Authentication/SessionManager.mjs', () => ({
    default: { getLoggedInUserId: () => String(ada) },
  }))
  C = await import('../../app/src/vorschlaege/VorschlaegeController.mjs')
})

const req = (felder = {}) => anfrage({ params: { project_id: String(projekt) }, ...felder })
async function ausfuehren(handler, anfrageObjekt) {
  const res = new Antwort()
  const next = vi.fn()
  await handler(anfrageObjekt, res, next)
  expect(next).not.toHaveBeenCalled()
  return res
}

describe('Vorschläge-Panel', () => {
  it('liefert Schalterstand und offene Vorschläge der angemeldeten Person', async () => {
    const res = await ausfuehren(C.status, req())
    expect(res.body).toEqual({
      stand: { wirksam: { compile_fehler: 'aus' }, limit: 50, heute: 0, limitErreicht: false },
      vorschlaege: [{ id: 'v1', titel: 'Beleg fehlt' }],
    })
    expect(m.Vorschlaege.panel).toHaveBeenCalledWith(projekt, ada)
  })

  it('setzt eigene Schalter, Projekt-Standard und Limit', async () => {
    expect((await ausfuehren(C.eigeneSetzen, req({ body: { art: 'compile_fehler', wert: null } }))).statusCode).toBe(204)
    expect(m.Vorschlaege.eigeneSetzen).toHaveBeenCalledWith(projekt, ada, 'compile_fehler', null)
    await ausfuehren(C.projektSetzen, req({ body: { art: 'compile_fehler', wert: 'vorschlag' } }))
    expect(m.Vorschlaege.projektSetzen).toHaveBeenCalledWith(projekt, 'compile_fehler', 'vorschlag')
    await ausfuehren(C.limitSetzen, anfrage({ body: { limit: 2 } }))
    expect(m.Vorschlaege.limitSetzen).toHaveBeenCalledWith(ada, 2)
  })

  it('übernimmt und meldet einen fehlenden Vorschlag als Problem', async () => {
    const id = String(new ObjectId())
    expect((await ausfuehren(C.uebernehmen, req({ params: { project_id: String(projekt), vorschlag_id: id } }))).statusCode).toBe(204)
    expect(m.Vorschlaege.uebernehmen).toHaveBeenCalledWith(projekt, ada, id)
    const res = await ausfuehren(C.verwerfen, req({ params: { project_id: String(projekt), vorschlag_id: id } }))
    expect(res.statusCode).toBe(404)
  })

  it('löst nach einer Tipp-Pause „belegloses Argument“ für das Dokument aus', async () => {
    const docId = String(new ObjectId())
    docsImProjekt.add(docId)
    const res = await ausfuehren(C.tippPause, req({ body: { doc_id: docId } }))
    expect(res.body).toEqual({ ausgeloest: true, daten: { doc_id: docId } })
    expect(m.Vorschlaege.ausloesen).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: projekt, menschId: ada, art: 'belegloses_argument' })
    )
    expect((await ausfuehren(C.tippPause, req({ body: { doc_id: '../x' } }))).statusCode).toBe(422)
  })

  it('lehnt die Tipp-Pause für ein Dokument ab, das es im Projekt nicht gibt, ohne auszulösen', async () => {
    const res = await ausfuehren(C.tippPause, req({ body: { doc_id: String(new ObjectId()) } }))
    expect(res.statusCode).toBe(404)
    expect(res.body).toMatchObject({ title: 'doc_fehlt' })
    expect(m.Vorschlaege.ausloesen).not.toHaveBeenCalled()
  })

  it('reicht unerwartete Fehler der Dokumentsuche weiter', async () => {
    const next = vi.fn()
    await C.tippPause(req({ body: { doc_id: 'f'.repeat(24) } }), new Antwort(), next)
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ message: 'Mongo weg' }))
    expect(m.Vorschlaege.ausloesen).not.toHaveBeenCalled()
  })
})
