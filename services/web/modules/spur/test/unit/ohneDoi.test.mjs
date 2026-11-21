import { describe, expect, it } from 'vitest'
import { fehlerVon } from './hilfen/fehler.mjs'
import { autorenAusText, metadatenOhneDoi } from '../../app/src/recherche/ohneDoi.mjs'
import { bibEintrag } from '../../app/src/pruefung/bib.mjs'

// Echter Fall: eine Masterarbeit der Universität Tampere ohne DOI.
const TAMPERE = {
  titel: 'Generative AI adoption in a large enterprise',
  autoren: [{ family: 'Virtanen', given: 'Aino' }],
  jahr: 2024,
  art: 'thesis',
  abschluss: "Master's thesis",
  institution: 'Tampere University',
}

describe('metadatenOhneDoi', () => {
  it('übernimmt Titel, Autoren, Jahr, Art, Abschluss und Institution', () => {
    expect(metadatenOhneDoi(TAMPERE)).toEqual({ ...TAMPERE, url: null })
  })

  it('nimmt ohne Art „misc“ und lässt fehlende Angaben leer', () => {
    expect(metadatenOhneDoi({ titel: '  Ein   Report ' })).toEqual({
      titel: 'Ein Report',
      autoren: [],
      jahr: null,
      art: 'misc',
      institution: null,
      abschluss: null,
      url: null,
    })
  })

  it.each([
    ['metadaten.titel', {}],
    ['metadaten.titel', { titel: '   ' }],
    ['metadaten.art', { titel: 'T', art: 'article' }],
    ['metadaten.jahr', { titel: 'T', jahr: 'bald' }],
    ['metadaten.jahr', { titel: 'T', jahr: 20245 }],
    ['metadaten.url', { titel: 'T', url: 'javascript:alert(1)' }],
    ['metadaten.autoren', { titel: 'T', autoren: 'Virtanen' }],
  ])('nennt bei ungültiger Eingabe das Feld %s', async (feld, eingabe) => {
    const fehler = await fehlerVon(() => metadatenOhneDoi(eingabe))
    expect(fehler).toMatchObject({ status: 422, typ: 'eingabe_ungueltig', zusatz: { feld } })
    expect(fehler.message).toContain(feld)
  })

  it('liest das Jahr auch als Text, wie es der Upload schickt', () => {
    expect(metadatenOhneDoi({ titel: 'T', jahr: '2023' }).jahr).toBe(2023)
  })
})

describe('autorenAusText', () => {
  it('trennt „Nachname, Vorname; …“ in der Reihenfolge der Eingabe', () => {
    expect(autorenAusText('Meyer, Jana; Okafor, Chidi')).toEqual([
      { family: 'Meyer', given: 'Jana' },
      { family: 'Okafor', given: 'Chidi' },
    ])
    expect(autorenAusText('OECD; ')).toEqual([{ family: 'OECD', given: '' }])
    expect(autorenAusText('')).toEqual([])
  })
})

describe('bibEintrag ohne DOI', () => {
  const quelle = (meta, extra = {}) => ({ art: 'pdf', dateiname: 'x.pdf', doi: null, meta: { ...metadatenOhneDoi(meta), ...extra } })

  it('schreibt eine Abschlussarbeit als @thesis mit type, institution, url und urldate', () => {
    const eintrag = bibEintrag('virtanen2024', quelle(TAMPERE, { url: 'https://trepo.example/thesis.pdf', abgerufenAm: new Date('2026-11-16T10:00:00Z') }))
    expect(eintrag).toBe(`@thesis{virtanen2024,
  author = {Virtanen, Aino},
  title = {Generative AI adoption in a large enterprise},
  year = {2024},
  type = {Master's thesis},
  institution = {Tampere University},
  url = {https://trepo.example/thesis.pdf},
  urldate = {2026-11-16}
}`)
  })

  it('schreibt einen Report mit mehreren Autoren in der Reihenfolge der Eingabe und ohne url ohne urldate', () => {
    const eintrag = bibEintrag('meyer2023', quelle({ titel: 'AI at Work', autoren: autorenAusText('Meyer, Jana; Okafor, Chidi'), jahr: 2023, art: 'report', institution: 'OECD' }))
    expect(eintrag).toBe(`@report{meyer2023,
  author = {Meyer, Jana and Okafor, Chidi},
  title = {AI at Work},
  year = {2023},
  institution = {OECD}
}`)
  })

  it.each([
    ['working_paper', /^@report\{k,[\s\S]*type = \{Working paper\}[\s\S]*institution = \{NBER\}/],
    ['book', /^@book\{k,[\s\S]*publisher = \{NBER\}/],
    ['misc', /^@misc\{k,[\s\S]*organization = \{NBER\}/],
  ])('wählt für %s den passenden Eintragstyp', (art, muster) => {
    const eintrag = bibEintrag('k', quelle({ titel: 'T', art, institution: 'NBER' }))
    expect(eintrag).toMatch(muster)
    if (art !== 'working_paper') expect(eintrag).not.toContain('type =')
  })

  it('maskiert fremden Text, damit die Klammern der .bib halten', () => {
    const eintrag = bibEintrag('k', quelle({ titel: 'R&D {costs} 100%', art: 'report', institution: 'A_B', url: 'https://x.example/a{b}' }, { abgerufenAm: new Date('2026-01-02T00:00:00Z') }))
    expect(eintrag).toContain('title = {R\\&D \\{costs\\} 100\\%}')
    expect(eintrag).toContain('institution = {A\\_B}')
    expect(eintrag).toContain('url = {https://x.example/ab}')
  })
})
