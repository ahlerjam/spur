import { describe, expect, it } from 'vitest'
import { auszug, heutigePosition, kontextUm, opsFuer, umkehrOps } from '../../app/src/schreiben/ops.mjs'

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

describe('heutigePosition', () => {
  const vorher = 'Erster Satz.\nZweiter Satz.\nDritter Satz.'
  // Angenommene Löschung von „Zweiter Satz.\n“ an Position 13: Im Text steht sie nicht mehr.
  const geloescht = { p: 13, d: 'Zweiter Satz.\n' }
  const danach = 'Erster Satz.\nDritter Satz.'

  it('findet die Stelle nach einer Handänderung weiter oben', () => {
    const eintrag = { op: geloescht, ...kontextUm(danach, geloescht) }
    const heute = 'Ganz neuer Anfang. Erster Satz.\nDritter Satz.'
    expect(heutigePosition(heute, eintrag)).toBe(32)
    expect(heute.slice(0, 32) + geloescht.d + heute.slice(32)).toBe(
      'Ganz neuer Anfang. ' + vorher
    )
  })

  it('meldet keinen Treffer, wenn der Kontext geändert wurde', () => {
    const eintrag = { op: geloescht, ...kontextUm(danach, geloescht) }
    expect(heutigePosition('Erster Satz, geändert.\nDritter Satz.', eintrag)).toBeNull()
  })

  it('gibt bei sehr vielen gleichen Stellen auf, statt quadratisch zu suchen', () => {
    const op = { p: 4, i: 'a' }
    const eintrag = { op, ...kontextUm('aaaaaaaaa', op) }
    expect(heutigePosition('a'.repeat(200000), eintrag)).toBeNull()
  })

  it('findet einen Einschub samt Kontext', () => {
    const op = { p: 6, i: 'großer ' }
    const text = 'Der ein großer Hund.'
    const eintrag = { op: { ...op, p: 8 }, ...kontextUm(text, { ...op, p: 8 }) }
    expect(heutigePosition('Vorab. ' + text, eintrag)).toBe(15)
  })
})

describe('auszug', () => {
  it('ergänzt einen Einschub mitten im Wort zu ganzen Wörtern', () => {
    const text = 'Beta Satz, sprachlich geglättet.'
    // minimaler Einschub „, sprachlich geglätte“ hinter „Satz“, vor „t.“
    expect(auszug(text, { p: 9, i: ', sprachlich geglätte' })).toBe(', sprachlich geglättet')
  })
  it('ergänzt eine Löschung mitten im Wort aus dem Text daneben', () => {
    // „altem Wor“ gelöscht, im Text steht noch „Konflikt Satz mit t.“
    expect(auszug('Konflikt Satz mit t.', { p: 18, d: 'altem Wor' })).toBe('altem Wort')
  })
  it('lässt ganze Wörter unverändert', () => {
    expect(auszug('Alpha Satz. Neu.', { p: 11, i: ' Neu.' })).toBe(' Neu.')
  })
})
