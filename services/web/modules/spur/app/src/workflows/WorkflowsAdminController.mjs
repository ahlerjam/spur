import Path from 'node:path'
import { fileURLToPath } from 'node:url'
import SessionManager from '../../../../../app/src/Features/Authentication/SessionManager.mjs'
import { ObjectId } from '../../../../../app/src/infrastructure/mongodb.mjs'
import { mitProblemen } from '../probleme.mjs'
import * as Workflows from './Workflows.mjs'

const SEITE = Path.resolve(Path.dirname(fileURLToPath(import.meta.url)), '../../views/workflows-admin')

export function seite(req, res) {
  res.render(SEITE, { title: 'Workflows' })
}

export const liste = mitProblemen(async (req, res) => {
  res.json({ workflows: await Workflows.liste() })
})

export const setzen = mitProblemen(async (req, res) => {
  const admin = new ObjectId(String(SessionManager.getLoggedInUserId(req.session)))
  await Workflows.setzen(req.params.name, req.body.text, admin)
  res.sendStatus(204)
})

export const zuruecksetzen = mitProblemen(async (req, res) => {
  await Workflows.zuruecksetzen(req.params.name)
  res.sendStatus(204)
})
