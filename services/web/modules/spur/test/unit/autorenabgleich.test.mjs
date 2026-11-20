import { describe, expect, it } from 'vitest'
import { autorenAbgleich } from '../../app/src/recherche/autorenabgleich.mjs'

const GANDHI = { family: 'Gandhi', given: 'Kiran' }
const JOSHI = { family: 'Joshi', given: 'Mira' }

describe('autorenAbgleich', () => {
  it('übernimmt die Reihenfolge des PDFs, wenn alle Namen dort anders stehen (Gandhi/Joshi)', () => {
    expect(autorenAbgleich([GANDHI, JOSHI], 'Replay order\nMira Joshi, Kiran Gandhi\nAbstract')).toEqual({
      zustand: 'aus_pdf',
      autoren: [JOSHI, GANDHI],
    })
  })

  it('bestätigt die Reihenfolge, wenn sie im PDF gleich ist', () => {
    expect(autorenAbgleich([GANDHI, JOSHI], 'K. GANDHI and M. JOSHI')).toEqual({ zustand: 'bestaetigt', autoren: [GANDHI, JOSHI] })
  })

  it('lässt die Metadaten stehen und meldet abweichend, wenn ein Nachname fehlt', () => {
    expect(autorenAbgleich([GANDHI, JOSHI], 'Kiran Gandhi and the replay lab')).toEqual({ zustand: 'abweichend', autoren: [GANDHI, JOSHI] })
  })

  it('ignoriert Diakritika und Groß- und Kleinschreibung (Müller und Muller)', () => {
    const muller = { family: 'Müller', given: 'Jonas' }
    expect(autorenAbgleich([muller], 'JONAS MULLER').zustand).toBe('bestaetigt')
  })

  it('zählt nur ganze Wörter: „Lee“ steht nicht in „sleep“', () => {
    expect(autorenAbgleich([{ family: 'Lee', given: 'Ben' }], 'Sleep and memory').zustand).toBe('abweichend')
  })

  it('findet mehrteilige Nachnamen und Organisationen', () => {
    const autoren = [{ family: 'van der Berg', given: 'Anna' }, { family: 'Sleep Consortium', given: '' }]
    expect(autorenAbgleich(autoren, 'The Sleep Consortium; A. van der Berg').zustand).toBe('aus_pdf')
  })

  it('nimmt die Reihenfolge im Autorenblock, nicht ein früheres Vorkommen im Titel', () => {
    const autoren = [{ family: 'Smith', given: 'Alice' }, { family: 'Jones', given: 'Bob' }]
    expect(autorenAbgleich(autoren, 'The Jones hypothesis revisited\nAlice Smith, Bob Jones\nAbstract').zustand).toBe('bestaetigt')
    expect(autorenAbgleich(autoren, 'The Smith effect\nBob Jones and Alice Smith').autoren.map(a => a.family)).toEqual(['Jones', 'Smith'])
  })

  it('bleibt bei sehr vielen Vorkommen schnell (linear statt quadratisch)', () => {
    const text = `${'li '.repeat(200000)}wang`
    const start = performance.now()
    expect(autorenAbgleich([{ family: 'Li', given: 'A' }, { family: 'Wang', given: 'B' }], text).zustand).toBe('bestaetigt')
    expect(performance.now() - start).toBeLessThan(2000)
  })

  it('gleicht nichts ab ohne Autoren oder ohne Text', () => {
    expect(autorenAbgleich([], 'Text')).toBeNull()
    expect(autorenAbgleich(undefined, 'Text')).toBeNull()
    expect(autorenAbgleich([GANDHI], '  ')).toBeNull()
    expect(autorenAbgleich([GANDHI, { family: '', given: '' }], 'Kiran Gandhi')).toBeNull()
  })
})
