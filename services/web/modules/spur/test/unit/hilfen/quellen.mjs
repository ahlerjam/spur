import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { werkAuswerten } from '../../../app/src/Crossref.mjs'

export const fixture = name => fileURLToPath(new URL(`../../fixtures/${name}`, import.meta.url))

const WERKE = JSON.parse(readFileSync(fixture('crossref.json'), 'utf8'))

// Ersatz für Crossref.mjs auf Grundlage der Fixture: echte Auswertung, ohne Netz.
export function crossrefAttrappe() {
  const abfragen = []
  return {
    abfragen,
    modul: {
      werk: async doi => {
        abfragen.push(doi)
        const roh = WERKE[doi.toLowerCase()]
        return roh ? werkAuswerten(roh) : { gefunden: false }
      },
    },
  }
}
