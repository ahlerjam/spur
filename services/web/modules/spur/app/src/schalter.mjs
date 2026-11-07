import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const DATEI = fileURLToPath(new URL('../../dev-schalter.json', import.meta.url))

export const IST_DEV = process.env.SPUR_DEV === '1'

function schalter() {
  if (!IST_DEV) return {}
  try {
    return JSON.parse(readFileSync(DATEI, 'utf8'))
  } catch (error) {
    if (error.code === 'ENOENT') return {}
    throw error
  }
}

export function fakeAgent() {
  return schalter().SPUR_FAKE_AGENT === '1'
}

export function paperApiBasis() {
  return schalter().SPUR_PAPER_API_BASE
}

export function jetzt() {
  const fest = schalter().SPUR_NOW
  return fest ? new Date(fest) : new Date()
}
