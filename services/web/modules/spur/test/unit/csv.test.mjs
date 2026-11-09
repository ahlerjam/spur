import { describe, expect, it } from 'vitest'
import { csv } from '../../app/src/csv.mjs'

describe('csv', () => {
  it('schreibt Kopfzeile und maskiert Anführungszeichen und Kommas', () => {
    expect(csv(['A', 'B'], [['x, y', 'sag "hi"']])).toBe('A,B\n"x, y","sag ""hi"""\n')
  })

  it('entschärft Zellen, die eine Tabellenkalkulation als Formel ausführen würde', () => {
    expect(csv(['A'], [['=HYPERLINK("x")'], ['-1+1'], ['@SUM'], [42]])).toBe(
      'A\n"\'=HYPERLINK(""x"")"\n\'-1+1\n\'@SUM\n42\n'
    )
  })
})
