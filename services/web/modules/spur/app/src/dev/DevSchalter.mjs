// Nur mit SPUR_DEV=1 eingehängt (SpurRouter): Testseite für Web-Schnappschüsse und ein Schalter,
// mit dem der E2E-Test SPUR_NOW für einen Schritt fest- und danach wieder freigibt.
import { readFileSync } from 'node:fs'
import { appendFile } from 'node:fs/promises'
import { db } from '../../../../../app/src/infrastructure/mongodb.mjs'
import { dateiPfad } from '../QuellenManager.mjs'
import { quellen } from '../sammlungen.mjs'
import { testSchalter, zeitFestlegen } from '../schalter.mjs'
import { mailFakeAus } from './MailFake.mjs'

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
    await mailFakeAus()
    await e2eDatenVorbereiten()
    res.sendStatus(204)
  } catch (error) {
    res.status(500).send(`E2E-Daten nicht bereit: ${error.message}`)
  }
}

// Ändert eine Quelldatei in der Ablage, ohne den gespeicherten Stand anzufassen: Der E2E-Test prüft damit
// „Speicher neu berechnen“.
export async function quelleVergroessern(req, res) {
  const { projekt, bytes } = req.body ?? {}
  const p = await db.projects.findOne({ name: projekt }, { projection: { _id: 1 } })
  const quelle = p && (await (await quellen()).findOne({ projectId: p._id }))
  if (!quelle || !(bytes > 0)) return res.status(422).json({ detail: 'Projekt mit Quelle und bytes > 0 nötig.' })
  await appendFile(dateiPfad(quelle), Buffer.alloc(bytes))
  res.sendStatus(204)
}

// Ahmt einen Firmenproxy nach (Testschalter `name`): '403' und '200' antworten mit einer HTML-Seite, 'kaputt' mit
// einem abgeschnittenen PDF. Ohne Schalter geht die Anfrage weiter an die echte Route.
const SPERRSEITE = '<!doctype html><html><body><h1>Access denied</h1><p>This site is blocked by your network policy.</p></body></html>'

export function proxySperre(name) {
  return (_req, res, next) => {
    const art = testSchalter(name)
    if (!art) return next()
    if (art === 'kaputt') return res.type('application/pdf').send(Buffer.from('%PDF-1.5\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R'))
    res.status(art === '200' ? 200 : 403).type('html').send(SPERRSEITE)
  }
}

// Mit SPUR_PROXY_PDF zeigt die PDF-Adresse der Compile-Antwort auf die nachgeahmte Sperre.
export function pdfUmleiten(_req, res, next) {
  if (!testSchalter('SPUR_PROXY_PDF')) return next()
  const json = res.json.bind(res)
  res.json = body => {
    for (const datei of body?.outputFiles ?? []) {
      if (datei.type === 'pdf') datei.url = '/spur/dev/proxy-pdf/output.pdf'
    }
    return json(body)
  }
  next()
}
