import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

export const fixture = name => fileURLToPath(new URL(`../../fixtures/${name}`, import.meta.url))

const WERKE = JSON.parse(readFileSync(fixture('crossref.json'), 'utf8'))

// Ersatz für Crossref.mjs auf Grundlage der Fixture: gleiche Auswertung wie im Produktivcode, ohne Netz.
export function crossrefAttrappe() {
  const abfragen = []
  return {
    abfragen,
    modul: {
      werk: async doi => {
        abfragen.push(doi)
        const roh = WERKE[doi.toLowerCase()]
        if (!roh) return { gefunden: false }
        return {
          gefunden: true,
          titel: roh.title[0],
          autoren: roh.author.map(a => ({ family: a.family, given: a.given })),
          jahr: roh.issued['date-parts'][0][0],
          journal: roh['container-title'][0],
          seiten: roh.page,
          typ: roh.type,
          retraction: roh['updated-by']?.some(u => u.type === 'retraction')
            ? 'zurueckgezogen'
            : roh['updated-by']
              ? 'korrektur'
              : 'keine_meldung',
        }
      },
    },
  }
}
