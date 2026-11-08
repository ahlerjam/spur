// Nur mit SPUR_DEV=1 eingehängt (SpurRouter): Testseite für Web-Schnappschüsse und ein Schalter,
// mit dem der E2E-Test SPUR_NOW für einen Schritt fest- und danach wieder freigibt.
import { readFileSync } from 'node:fs'
import { zeitFestlegen } from '../schalter.mjs'

const TESTSEITE = new URL('../../../test/fixtures/testseite.html', import.meta.url)

export function testseite(_req, res) {
  res.type('html').send(readFileSync(TESTSEITE, 'utf8'))
}

export function zeitSetzen(req, res) {
  const { jetzt } = req.body ?? {}
  if (jetzt !== null && Number.isNaN(Date.parse(jetzt))) {
    return res.status(422).json({ detail: 'jetzt muss ein ISO-Datum oder null sein.' })
  }
  zeitFestlegen(jetzt)
  res.sendStatus(204)
}
