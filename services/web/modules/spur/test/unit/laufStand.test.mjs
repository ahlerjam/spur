// Stand eines Laufs für run_status, run_finish und die Laufkarte (P15).
import { describe, expect, it } from 'vitest'
import { meldung } from '../../app/src/meldungen.mjs'
import { laufStand } from '../../app/src/schreiben/laufStand.mjs'

// Die Sätze kommen aus der Sprachdatei der Installation; Overleafs Suite läuft auf Englisch.
const WOERTER = meldung('spur_zahlwoerter').split(',')
const satz = (schluessel, n) => {
  const text = meldung(schluessel).replace('__anzahl__', WOERTER[n] ?? String(n))
  return text.charAt(0).toUpperCase() + text.slice(1)
}

const S1 = 'a'.repeat(18)
const S2 = 'b'.repeat(18)
const S3 = 'c'.repeat(18)
const id = (seed, n = 1) => `${seed}${String(n).padStart(6, '0')}`
const ZAHLWOERTER = new RegExp(`\\b(${[...WOERTER, 'eins', 'ein', 'einer', 'einen'].join('|')})\\b|\\d`, 'i')

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
    expect(hinweis).toBe(
      [
        satz('spur_lauf_hinweis_automatisch_n', 2),
        meldung('spur_lauf_hinweis_offen_1'),
        meldung('spur_lauf_hinweis_rot_1'),
        satz('spur_lauf_hinweis_rueckgaengig_n', 3),
      ].join(' ')
    )
    if (meldung('spur_zahlwoerter').startsWith('null')) {
      expect(hinweis).toContain('Zwei Änderungen stehen bereits im Text')
      expect(hinweis).toContain('„Lauf rückgängig“ nimmt alle drei zurück, auch die angenommenen')
    }
  })

  it('zählt eine von der Person angenommene Änderung nicht mehr als offen', () => {
    const angenommen = [...lauf().angenommen, { seed: S3 }]
    const { aenderungen, hinweis } = laufStand(lauf({ status: 'angenommen', angenommen }), [])
    expect(aenderungen).toEqual({ gesamt: 3, automatisch_angenommen: 2, offen: 0, rot: 1 })
    expect(hinweis).toContain(meldung('spur_lauf_hinweis_von_hand_1'))
    expect(hinweis).not.toContain(meldung('spur_lauf_hinweis_offen_1'))
    expect(hinweis).not.toContain(meldung('spur_lauf_hinweis_rot_1'))
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
    expect(hinweis).toContain(satz('spur_lauf_hinweis_offen_n', 14))
    expect(hinweis).toContain(satz('spur_lauf_hinweis_rueckgaengig_n', 14))
  })

  it('zählt bei Läufen von vor P15 offene Bearbeitungen über ihre Seeds', () => {
    const l = { status: 'offen', aenderungen: 2, angenommen: [{ op: { p: 0, i: 'x' } }] }
    expect(laufStand(l, offen([id(S1, 1), id(S1, 2), id(S2, 1)])).aenderungen).toEqual({ gesamt: 2, automatisch_angenommen: 0, offen: 2, rot: 0 })
  })

  it('sagt nach „Lauf rückgängig“, dass nichts mehr im Text steht', () => {
    const { hinweis } = laufStand(lauf({ status: 'zurueckgenommen' }), [])
    expect(hinweis).toBe(meldung('spur_lauf_hinweis_zurueckgenommen'))
  })
})
