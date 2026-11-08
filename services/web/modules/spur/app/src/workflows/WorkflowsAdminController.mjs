import Path from 'node:path'
import { fileURLToPath } from 'node:url'
import { menschId } from '../anfrage.mjs'
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
  await Workflows.setzen(req.params.name, req.body.text, menschId(req))
  res.sendStatus(204)
})

export const zuruecksetzen = mitProblemen(async (req, res) => {
  await Workflows.zuruecksetzen(req.params.name)
  res.sendStatus(204)
})
