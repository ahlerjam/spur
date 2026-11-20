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

  it('gleicht nichts ab ohne Autoren oder ohne Text', () => {
    expect(autorenAbgleich([], 'Text')).toBeNull()
    expect(autorenAbgleich(undefined, 'Text')).toBeNull()
    expect(autorenAbgleich([GANDHI], '  ')).toBeNull()
    expect(autorenAbgleich([GANDHI, { family: '', given: '' }], 'Kiran Gandhi')).toBeNull()
  })
})
