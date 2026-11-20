// Stand eines Laufs für run_status, run_finish und die Laufkarte (P15).
import { describe, expect, it } from 'vitest'
import { laufStand } from '../../app/src/schreiben/laufStand.mjs'

const S1 = 'a'.repeat(18)
const S2 = 'b'.repeat(18)
const S3 = 'c'.repeat(18)
const id = (seed, n = 1) => `${seed}${String(n).padStart(6, '0')}`
const ZAHLWOERTER = /\b(null|eins?|eine[rnms]?|zwei|drei|vier|fünf|sechs|sieben|acht|neun|zehn|elf|zwölf)\b|\d/i

// Echter Fall: Claude wusste nicht, ob seine Änderungen noch als Track Changes zur Prüfung stehen.
const lauf = (extra = {}) => ({
  status: 'offen',
  aenderungen: 3,
  bearbeitungen: [
    { seed: S1, anzahl: 1, rot: false },
    { seed: S2, anzahl: 1, rot: false },
    { seed: S3, anzahl: 1, rot: true },
  ],
  angenommen: [
    { seed: S1, automatisch: true },
    { seed: S1, automatisch: true },
    { seed: S2, automatisch: true },
  ],
  ...extra,
})
const offen = ids => [{ changes: ids.map(i => ({ id: i })) }]

describe('laufStand', () => {
  it('zählt automatisch angenommene, offene und rote Änderungen', () => {
    const { aenderungen, hinweis } = laufStand(lauf(), offen([id(S3, 1), id(S3, 2)]))
    expect(aenderungen).toEqual({ gesamt: 3, automatisch_angenommen: 2, offen: 1, rot: 1 })
    expect(hinweis).toContain('Zwei Änderungen stehen bereits im Text')
    expect(hinweis).toContain('Eine Änderung wartet als Track Change auf deine Entscheidung')
    expect(hinweis).toMatch(/rot/)
    expect(hinweis).toContain('„Lauf rückgängig“ nimmt alle drei zurück, auch die angenommenen')
  })

  it('zählt eine von der Person angenommene Änderung nicht mehr als offen', () => {
    const angenommen = [...lauf().angenommen, { seed: S3 }]
    const { aenderungen, hinweis } = laufStand(lauf({ status: 'angenommen', angenommen }), [])
    expect(aenderungen).toEqual({ gesamt: 3, automatisch_angenommen: 2, offen: 0, rot: 1 })
    expect(hinweis).toContain('Eine Änderung hast du angenommen')
    expect(hinweis).not.toMatch(/wartet|rot markiert/)
  })

  it('sagt ohne Textänderung, dass sich nichts geändert hat, ohne Zahlenwörter', () => {
    for (const l of [null, lauf({ aenderungen: 0, bearbeitungen: [], angenommen: [] })]) {
      const { aenderungen, hinweis } = laufStand(l, [])
      expect(aenderungen).toEqual({ gesamt: 0, automatisch_angenommen: 0, offen: 0, rot: 0 })
      expect(hinweis.length).toBeGreaterThan(10)
      expect(hinweis).not.toMatch(ZAHLWOERTER)
    }
  })

  it('zählt Ersetzungen mit alle_vorkommen einzeln und nennt große Zahlen in Ziffern', () => {
    const l = { status: 'offen', aenderungen: 14, bearbeitungen: [{ seed: S1, anzahl: 14, rot: false }], angenommen: [] }
    const { aenderungen, hinweis } = laufStand(l, offen([id(S1, 1), id(S1, 2)]))
    expect(aenderungen).toEqual({ gesamt: 14, automatisch_angenommen: 0, offen: 14, rot: 0 })
    expect(hinweis).toContain('14 Änderungen warten als Track Changes auf deine Entscheidung')
    expect(hinweis).toContain('alle 14')
  })

  it('zählt bei Läufen von vor P15 offene Bearbeitungen über ihre Seeds', () => {
    const l = { status: 'offen', aenderungen: 2, angenommen: [{ op: { p: 0, i: 'x' } }] }
    expect(laufStand(l, offen([id(S1, 1), id(S1, 2), id(S2, 1)])).aenderungen).toEqual({ gesamt: 2, automatisch_angenommen: 0, offen: 2, rot: 0 })
  })

  it('sagt nach „Lauf rückgängig“, dass nichts mehr im Text steht', () => {
    const { hinweis } = laufStand(lauf({ status: 'zurueckgenommen' }), [])
    expect(hinweis).toContain('zurückgenommen')
    expect(hinweis).not.toContain('bereits im Text')
  })
})
