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
