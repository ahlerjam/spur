import SessionManager from '../../../../../app/src/Features/Authentication/SessionManager.mjs'
import { ObjectId } from '../../../../../app/src/infrastructure/mongodb.mjs'
import { Problem, mitProblemen } from '../probleme.mjs'
import * as Vorschlaege from './Vorschlaege.mjs'

const projektId = req => new ObjectId(req.params.project_id)
const menschId = req => new ObjectId(String(SessionManager.getLoggedInUserId(req.session)))

export const status = mitProblemen(async (req, res) => {
  const [stand, vorschlaege] = await Promise.all([
    Vorschlaege.stand(projektId(req), menschId(req)),
    Vorschlaege.liste(projektId(req), menschId(req)),
  ])
  res.json({ stand, vorschlaege })
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
    throw new Problem(422, 'doc_id', 'doc_id muss die ID eines Dokuments sein.')
  }
  res.json(
    await Vorschlaege.ausloesen({
      projectId: projektId(req),
      menschId: menschId(req),
      art: 'belegloses_argument',
      daten: { doc_id: docId },
    })
  )
})
