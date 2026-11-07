import { describe, expect, it } from 'vitest'
import { opsFuer, umkehrOps } from '../../app/src/schreiben/ops.mjs'

describe('opsFuer', () => {
  it('fügt nur den neuen Teil ein', () => {
    expect(opsFuer(10, 'Satz.', 'Satz. Mehr.')).toEqual([{ p: 15, i: ' Mehr.' }])
  })
  it('ersetzt nur das geänderte Wort', () => {
    expect(opsFuer(0, 'mit altem Wort', 'mit neuem Wort')).toEqual([
      { p: 4, d: 'alt' },
      { p: 4, i: 'neu' },
    ])
  })
  it('hängt ohne Alttext am Startpunkt an', () => {
    expect(opsFuer(7, '', 'neu')).toEqual([{ p: 7, i: 'neu' }])
  })
  it('liefert keine Ops bei gleichem Text', () => {
    expect(opsFuer(3, 'gleich', 'gleich')).toEqual([])
  })
})

describe('umkehrOps', () => {
  it('setzt Ersetzungen von hinten nach vorn zurück', () => {
    const changes = [
      { op: { p: 4, i: 'neu' } },
      { op: { p: 7, d: 'alt' } },
    ]
    expect(umkehrOps(changes)).toEqual([
      { p: 7, i: 'alt', u: true },
      { p: 4, d: 'neu', u: true },
    ])
  })
})
