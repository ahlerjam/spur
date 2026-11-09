import { describe, expect, it } from 'vitest'
import { bibLesen } from '../../app/src/pruefung/bib.mjs'

describe('bibLesen', () => {
  it('liest Schlüssel und DOI aus Klammern und aus Anführungszeichen', () => {
    const bib = `
@article{smith2024,
  title = {Sleep and {Memory}},
  doi = {10.5555/spur.2024.001},
}
@book{meier2020, title = "Gedächtnis", DOI = "10.1000/xyz" }
`
    expect([...bibLesen(bib).values()]).toEqual([
      { key: 'smith2024', doi: '10.5555/spur.2024.001' },
      { key: 'meier2020', doi: '10.1000/xyz' },
    ])
  })

  it('normalisiert DOIs als URL oder mit Präfix', () => {
    const bib = '@article{a, doi = {https://doi.org/10.1/a}}\n@article{b, doi = {doi: 10.1/b}}\n@article{c, doi = {http://dx.doi.org/10.1/c}}'
    expect([...bibLesen(bib).values()].map(e => e.doi)).toEqual(['10.1/a', '10.1/b', '10.1/c'])
  })

  it('lässt die DOI leer, wenn der Eintrag keine hat, und nimmt keine aus dem Nachbareintrag', () => {
    const bib = '@article{ohne, title = {X}}\n@article{mit, doi = {10.1/mit}}'
    const eintraege = bibLesen(bib)
    expect(eintraege.get('ohne').doi).toBeNull()
    expect(eintraege.get('mit').doi).toBe('10.1/mit')
  })

  it('ignoriert comment, string und preamble', () => {
    const bib = '@comment{x, doi = {10.9/a}}\n@string{kurz = "Lang"}\n@preamble{"\\newcommand"}\n@misc{echt, doi={10.1/e}}'
    expect([...bibLesen(bib).keys()]).toEqual(['echt'])
  })

  it('findet eine DOI hinter verschachtelten Klammern und escaped Anführungszeichen', () => {
    const bib = '@article{k, title = {A {B {C}} D}, note = "ein \\" Zitat", doi = {10.1/k}}'
    expect(bibLesen(bib).get('k').doi).toBe('10.1/k')
  })

  it('liest nichts aus Text ohne Einträge', () => {
    expect(bibLesen('% nur ein Kommentar').size).toBe(0)
  })
})
