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

export function jetzt() {
  const fest = schalter().SPUR_NOW
  return fest ? new Date(fest) : new Date()
}

// Nur im Dev-Stack: Die E2E-Suite schaltet ohne Neustart um (POST …/_steuerung des Paper-Fakes).
let devUeberschreibung = {}

export function devSchalterSetzen(werte) {
  if (IST_DEV) devUeberschreibung = { ...werte }
}

const wert = name => (IST_DEV && name in devUeberschreibung ? devUeberschreibung[name] : process.env[name])

export const semantikAn = () => wert('SPUR_SEMANTIC_SEARCH') === 'true'
export const fakeEmbeddings = () => wert('SPUR_FAKE_EMBEDDINGS') === '1'
