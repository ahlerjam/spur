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

// Die E2E-Suite setzt ihre Daten vor dem Lauf selbst zurück, damit sie auch auf Daten eines früheren Laufs
// grün bleibt. Das Testmodul wird erst beim Aufruf geladen, nicht beim Start des Web-Prozesses.
export async function e2eVorbereiten(_req, res) {
  try {
    const { e2eDatenVorbereiten } = await import('../../../test/e2e/vorbereiten.mjs')
    await e2eDatenVorbereiten()
    res.sendStatus(204)
  } catch (error) {
    res.status(500).send(`E2E-Daten nicht bereit: ${error.message}`)
  }
}
