import Errors from '../../../../../app/src/Features/Errors/Errors.js'
import ProjectLocator from '../../../../../app/src/Features/Project/ProjectLocator.mjs'
import { menschId, projektId } from '../anfrage.mjs'
import { Problem, mitProblemen } from '../probleme.mjs'
import * as Vorschlaege from './Vorschlaege.mjs'

export const status = mitProblemen(async (req, res) => {
  res.json(await Vorschlaege.panel(projektId(req), menschId(req)))
})

export const eigeneSetzen = mitProblemen(async (req, res) => {
  await Vorschlaege.eigeneSetzen(projektId(req), menschId(req), req.body.art, req.body.wert)
  res.sendStatus(204)
})

export const projektSetzen = mitProblemen(async (req, res) => {
  await Vorschlaege.projektSetzen(projektId(req), req.body.art, req.body.wert)
  res.sendStatus(204)
})

export const limitSetzen = mitProblemen(async (req, res) => {
  await Vorschlaege.limitSetzen(menschId(req), req.body.limit)
  res.sendStatus(204)
})

export const uebernehmen = mitProblemen(async (req, res) => {
  await Vorschlaege.uebernehmen(projektId(req), menschId(req), req.params.vorschlag_id)
  res.sendStatus(204)
})

export const verwerfen = mitProblemen(async (req, res) => {
  await Vorschlaege.verwerfen(projektId(req), menschId(req), req.params.vorschlag_id)
  res.sendStatus(204)
})

export const tippPause = mitProblemen(async (req, res) => {
  const docId = req.body.doc_id
  if (typeof docId !== 'string' || !/^[0-9a-f]{24}$/.test(docId)) {
    throw new Problem(422, 'doc_id', 'spur_fehler_doc_id')
  }
  // Eine erfundene ID darf keinen Auslöser anlegen und so das Tageslimit verbrauchen (D4).
  try {
    await ProjectLocator.promises.findElement({ project_id: projektId(req), element_id: docId, type: 'doc' })
  } catch (error) {
    if (error instanceof Errors.NotFoundError) throw new Problem(404, 'doc_fehlt', 'spur_fehler_doc_fehlt')
    throw error
  }
  res.json(
    await Vorschlaege.ausloesen({
      projectId: projektId(req),
      menschId: menschId(req),
      art: 'belegloses_argument',
      daten: () => ({ doc_id: docId }),
    })
  )
})
