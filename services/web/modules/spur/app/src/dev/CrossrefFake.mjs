import { readFileSync } from 'node:fs'

const ANTWORTEN = JSON.parse(
  readFileSync(
    new URL('../../../test/fixtures/crossref.json', import.meta.url),
    'utf8'
  )
)

export function crossrefFake(req, res) {
  const message = ANTWORTEN[req.params.doi.toLowerCase()]
  if (!message) return res.status(404).send('Resource not found.')
  res.json({ status: 'ok', 'message-type': 'work', message })
}
