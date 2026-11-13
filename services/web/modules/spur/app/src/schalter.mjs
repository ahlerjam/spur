import { readFileSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const DATEI = fileURLToPath(new URL('../../dev-schalter.json', import.meta.url))

export const IST_DEV = process.env.SPUR_DEV === '1'

let zwischenspeicher = { stand: null, werte: {} }

function schalter() {
  if (!IST_DEV) return {}
  const stand = statSync(DATEI, { throwIfNoEntry: false })?.mtimeMs ?? null
  if (stand !== zwischenspeicher.stand) {
    zwischenspeicher = {
      stand,
      werte: stand === null ? {} : JSON.parse(readFileSync(DATEI, 'utf8')),
    }
  }
  return zwischenspeicher.werte
}

export function paperApiBasis() {
  return schalter().SPUR_PAPER_API_BASE
}

// Der E2E-Test legt SPUR_NOW für einen Schritt im laufenden Prozess fest (Route nur bei SPUR_DEV);
// die Schalterdatei ist im Container schreibgeschützt eingehängt.
let festeZeit = null

export function zeitFestlegen(iso) {
  if (IST_DEV) festeZeit = iso
}

export function jetzt() {
  const fest = festeZeit ?? schalter().SPUR_NOW
  return fest ? new Date(fest) : new Date()
}

// Nur im Dev-Stack: Die E2E-Suite schaltet ohne Neustart um (POST …/_steuerung des Paper-Fakes).
let devUeberschreibung = {}

export function devSchalterSetzen(werte) {
  if (IST_DEV) devUeberschreibung = { ...werte }
}

// Fehler auslösen für Tests: nur im Dev-Stack und nur über die Fake-Steuerung, nie aus der Umgebung.
export const testSchalter = name => (IST_DEV ? devUeberschreibung[name] : undefined)

const wert = name => (IST_DEV && name in devUeberschreibung ? devUeberschreibung[name] : process.env[name])

// Mit dem Paper-Fake gilt für Unpaywall eine Testadresse, solange die E2E-Suite sie nicht ausdrücklich leert.
const FAKE_STANDARD = { UNPAYWALL_EMAIL: 'fake@example.org' }

// Umgebungsvariable, im Dev-Stack über den Fake umschaltbar (leerer Text heißt: nicht gesetzt).
export function umgebung(name) {
  const gesetzt = wert(name)
  if (gesetzt === undefined && paperApiBasis()) return FAKE_STANDARD[name]
  return gesetzt || undefined
}

export const semantikAn = () => wert('SPUR_SEMANTIC_SEARCH') === 'true'
export const fakeEmbeddings = () => wert('SPUR_FAKE_EMBEDDINGS') === '1'
