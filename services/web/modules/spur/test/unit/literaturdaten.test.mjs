import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { werkAuswerten } from '../../app/src/Crossref.mjs'
import { arxivWerk } from '../../app/src/recherche/dienste.mjs'
import { bibEintrag, bibLesen } from '../../app/src/pruefung/bib.mjs'
import { klartext } from '../../app/src/fremdtext.mjs'
import { abweichungen } from '../../app/src/pruefung/bewertung.mjs'
import { fixture } from './hilfen/quellen.mjs'

const WERKE = JSON.parse(readFileSync(fixture('crossref.json'), 'utf8'))

const mitDoi = (doi, meta = werkAuswerten(WERKE[doi])) => ({ doi, meta, dateiname: `${doi}.pdf` })
const felder = eintrag => Object.fromEntries([...eintrag.matchAll(/^ {2}(\w+) = \{(.*)\},?$/gm)].map(m => [m[1], m[2]]))

describe('werkAuswerten (P13)', () => {
  it('liest Band, Heft und das Jahr der Heftausgabe statt des Online-Jahrs (Oldemeyer 2025 statt 2024)', () => {
    expect(werkAuswerten(WERKE['10.5555/spur.heft.001'])).toMatchObject({ jahr: 2025, jahrOnline: 2024, band: '35', heft: '2', seiten: '101-118' })
  })

  it('nimmt journal-issue.published-print nach published-print und vor issued (Morley 2023 statt 2021)', () => {
    const roh = { title: ['Ethics as a service'], issued: { 'date-parts': [[2021, 7]] }, 'published-online': { 'date-parts': [[2021, 7]] }, 'journal-issue': { issue: '1', 'published-print': { 'date-parts': [[2023, 3]] } } }
    expect(werkAuswerten(roh)).toMatchObject({ jahr: 2023, jahrOnline: 2021 })
    expect(werkAuswerten({ ...roh, 'published-print': { 'date-parts': [[2022]] } }).jahr).toBe(2022)
  })

  it('setzt ohne Abweichung kein jahrOnline und ohne Band und Heft keine leeren Felder', () => {
    const werk = werkAuswerten(WERKE['10.5555/spur.heft.002'])
    expect(werk.jahr).toBe(2021)
    expect(werk).not.toHaveProperty('jahrOnline')
    expect(werk).not.toHaveProperty('band')
    expect(werk).not.toHaveProperty('heft')
  })

  it('liest Artikelnummer, Verlag und den Namen des Preprint-Archivs', () => {
    expect(werkAuswerten(WERKE['10.5555/spur.enr.001'])).toMatchObject({ artikelnummer: 'e0209899', seiten: null })
    expect(werkAuswerten(WERKE['10.5555/spur.kap.001'])).toMatchObject({ verlag: 'Springer', journal: 'Handbook of Sleep' })
    expect(werkAuswerten(WERKE['10.5555/spur.pre.001'])).toMatchObject({ typ: 'posted-content', archiv: 'PsyArXiv', jahr: 2022 })
    expect(werkAuswerten({ ...WERKE['10.5555/spur.pre.001'], 'group-title': 'PsyArXiv Preprints' }).archiv).toBe('PsyArXiv Preprints')
  })

  it('löst Entities und Tags in Titel, Zeitschrift, Autoren und Verlag zu Klartext auf', () => {
    const werk = werkAuswerten({
      ...WERKE['10.5555/spur.ent.001'],
      author: [{ given: 'J&ouml;rg', family: 'M&uuml;ller' }],
      publisher: 'Taylor &amp; Francis',
    })
    expect(werk.titel).toBe('Artificial intelligence & firm performance: A review of H2O – 50% more')
    expect(werk.journal).toBe('Information & Management')
    expect(werk.autoren).toEqual([{ family: 'Müller', given: 'Jörg' }])
    expect(werk.verlag).toBe('Taylor & Francis')
  })
})

describe('klartext', () => {
  it.each([
    ['A &amp;amp; B', 'A &amp; B'],
    ['p &lt; 0.05', 'p < 0.05'],
    ['&#x2013;&#8212;', '–—'],
    ['&#99999999; bleibt', 'bleibt'],
    ['<script>x</script>Titel', 'Titel'],
  ])('%j → %j', (roh, text) => {
    expect(klartext(roh)).toBe(text)
  })
})

describe('bibEintrag (P13)', () => {
  it('schreibt @article mit volume, number, pages und dem Jahr der Heftausgabe', () => {
    const eintrag = bibEintrag('oldemeyer2025', mitDoi('10.5555/spur.heft.001'))
    expect(eintrag.startsWith('@article{oldemeyer2025,\n')).toBe(true)
    expect(felder(eintrag)).toMatchObject({ volume: '35', number: '2', pages: '101--118', year: '2025', journal: 'Government Information Quarterly' })
  })

  it('lässt fehlende Felder weg statt leer', () => {
    const eintrag = bibEintrag('morley2021', mitDoi('10.5555/spur.heft.002'))
    expect(felder(eintrag)).toMatchObject({ year: '2021' })
    expect(eintrag).not.toMatch(/volume|number|pages|= \{\}/)
  })

  it('schreibt ein Kapitel als @incollection mit booktitle und publisher', () => {
    const eintrag = bibEintrag('berg2019', mitDoi('10.5555/spur.kap.001'))
    expect(eintrag.startsWith('@incollection{berg2019,\n')).toBe(true)
    expect(felder(eintrag)).toMatchObject({ booktitle: 'Handbook of Sleep', publisher: 'Springer', pages: '45--67' })
    expect(eintrag).not.toContain('journal')
  })

  it.each([
    ['book', 'book', 'publisher'],
    ['monograph', 'book', 'publisher'],
    ['proceedings-article', 'inproceedings', 'booktitle'],
    ['dataset', 'misc', null],
  ])('ordnet den Crossref-Typ %s @%s zu', (typ, eintragstyp, feld) => {
    const meta = { ...werkAuswerten(WERKE['10.5555/spur.kap.001']), typ }
    const eintrag = bibEintrag('k', mitDoi('10.5555/spur.kap.001', meta))
    expect(eintrag.startsWith(`@${eintragstyp}{k,`)).toBe(true)
    if (feld) expect(felder(eintrag)[feld]).toBeTruthy()
  })

  it('schreibt eine Artikelnummer als eid und lässt pages weg', () => {
    const eintrag = bibEintrag('reyes2019', mitDoi('10.5555/spur.enr.001'))
    expect(felder(eintrag)).toMatchObject({ eid: 'e0209899', volume: '14', number: '1' })
    expect(eintrag).not.toContain('pages')
  })

  it('maskiert den Titel erst nach dem Auflösen der Entities und macht aus <i> \\textit', () => {
    const eintrag = bibEintrag('asplund2023', mitDoi('10.5555/spur.ent.001'))
    expect(felder(eintrag)).toMatchObject({
      title: 'Artificial intelligence \\& firm performance: \\textit{A review} of H2O – 50\\% more',
      journal: 'Information \\& Management',
    })
    expect(eintrag).not.toMatch(/amp;|<i>|&#/)
  })

  it('lässt ungültige Zeichennummern auch im kursiven Titel weg', () => {
    const meta = werkAuswerten({ title: ['<i>Foo</i> &#xD800;bar'], type: 'journal-article' })
    expect(felder(bibEintrag('k', mitDoi('10.1/k', meta))).title).toBe('\\textit{Foo} bar')
  })

  it('maskiert TeX-Zeichen auch in Band, Heft, Artikelnummer, Seiten und Jahr (^^-Notation, %)', () => {
    const meta = { ...werkAuswerten(WERKE['10.5555/spur.heft.001']), band: '^^5cinput^^7bx^^7d', heft: '3%', seiten: '1$-2#', artikelnummer: undefined }
    const f = felder(bibEintrag('k', mitDoi('10.5555/spur.heft.001', meta)))
    expect(f.volume).toBe('\\textasciicircum{}\\textasciicircum{}5cinput\\textasciicircum{}\\textasciicircum{}7bx\\textasciicircum{}\\textasciicircum{}7d')
    expect(f.number).toBe('3\\%')
    expect(f.pages).toBe('1\\$--2\\#')
    const nummer = felder(bibEintrag('k', mitDoi('10.5555/spur.enr.001', { ...werkAuswerten(WERKE['10.5555/spur.enr.001']), artikelnummer: 'e1^^5c' })))
    expect(nummer.eid).toBe('e1\\textasciicircum{}\\textasciicircum{}5c')
  })

  it('lässt ein maskiertes &lt;i&gt; als Text stehen', () => {
    const meta = werkAuswerten({ title: ['<i>Kursiv</i> und &lt;i&gt;wörtlich'], type: 'journal-article' })
    expect(felder(bibEintrag('k', mitDoi('10.1/k', meta))).title).toBe('\\textit{Kursiv} und <i>wörtlich')
  })

  it('hält die Klammern auch bei unausgeglichenen Tags und LaTeX-Zeichen im Titel', () => {
    const meta = werkAuswerten({ title: ['<i>Open {brace} \\ and <b>bold'], type: 'journal-article' })
    const titel = felder(bibEintrag('k', mitDoi('10.1/k', meta))).title
    expect(titel).toBe('\\textit{Open \\{brace\\} \\textbackslash{} and bold}')
  })

  it('schreibt ein arXiv-Preprint als @online mit eprint, doi und date, ohne journal', () => {
    const meta = arxivWerk({ titel: 'Sleep-like replay improves memory consolidation', autoren: ['Kiran Gandhi', 'Mira Joshi'], jahr: 2024, pdf: null })
    const eintrag = bibEintrag('gandhi2024', mitDoi('10.48550/arxiv.2401.01234', meta))
    expect(eintrag.startsWith('@online{gandhi2024,\n')).toBe(true)
    expect(felder(eintrag)).toEqual({
      author: 'Gandhi, Kiran and Joshi, Mira',
      title: 'Sleep-like replay improves memory consolidation',
      date: '2024',
      eprint: 'arXiv',
      doi: '10.48550/arXiv.2401.01234',
    })
  })

  it('erkennt ein Preprint auch an der arXiv-DOI, wenn die Metadaten von Crossref kommen', () => {
    const meta = { ...werkAuswerten(WERKE['10.5555/spur.heft.002']), typ: 'journal-article' }
    expect(bibEintrag('k', mitDoi('10.48550/arXiv.2401.01234', meta)).startsWith('@online{k,')).toBe(true)
  })

  it('schreibt einen Upload mit unbekannter DOI als @misc mit dem Ersatztitel und ohne DOI', () => {
    const quelle = { doi: '10.9999/nirgends.1', meta: { titel: 'unbekannt', art: 'misc' }, metadaten: 'unvollstaendig', dateiname: 'unbekannt.pdf' }
    expect(bibEintrag('unbekannt', quelle)).toBe('@misc{unbekannt,\n  title = {unbekannt}\n}')
  })

  it('schreibt posted-content als @online mit dem Archiv als eprint', () => {
    const eintrag = bibEintrag('lindgren2022', mitDoi('10.5555/spur.pre.001'))
    expect(eintrag.startsWith('@online{lindgren2022,\n')).toBe(true)
    expect(felder(eintrag)).toMatchObject({ eprint: 'PsyArXiv', date: '2022', doi: '10.5555/spur.pre.001' })
    expect(eintrag).not.toContain('journal')
  })
})

describe('abweichungen (bib_list, P13)', () => {
  const crossref = doi => ({ ...werkAuswerten(WERKE[doi]), registrierstelle: 'crossref' })
  const eintrag = (bib, key) => bibLesen(bib).get(key)

  it('nennt fehlendes volume und number und das Online-Jahr statt der Heftausgabe (alt2024)', () => {
    const alt = eintrag('@article{alt2024, title = {Dynamic capabilities}, year = {2024}, doi = {10.5555/spur.heft.001}}', 'alt2024')
    expect(abweichungen(alt, crossref('10.5555/spur.heft.001'))).toEqual({
      abweichungen: [
        { feld: 'volume', eintrag: null, erwartet: '35' },
        { feld: 'number', eintrag: null, erwartet: '2' },
        { feld: 'year', eintrag: '2024', erwartet: '2025' },
      ],
    })
  })

  it('liefert eine leere Liste, wenn der Eintrag zu Crossref passt, auch mit -- in den Seiten', () => {
    const neu = eintrag(bibEintrag('oldemeyer2025', mitDoi('10.5555/spur.heft.001')), 'oldemeyer2025')
    expect(abweichungen(neu, crossref('10.5555/spur.heft.001'))).toEqual({ abweichungen: [] })
    const nummer = eintrag(bibEintrag('reyes2019', mitDoi('10.5555/spur.enr.001')), 'reyes2019')
    expect(abweichungen(nummer, crossref('10.5555/spur.enr.001'))).toEqual({ abweichungen: [] })
  })

  it('meldet einen arXiv-Eintrag als @article mit erwartetem Typ online, ohne Crossref zu brauchen', () => {
    const arxiv = eintrag('@article{gandhi2024, title = {Sleep-like replay}, doi = {10.48550/arXiv.2401.01234}}', 'gandhi2024')
    expect(abweichungen(arxiv, null)).toEqual({ abweichungen: [{ feld: 'eintragstyp', eintrag: 'article', erwartet: 'online' }] })
    const richtig = eintrag(bibEintrag('gandhi2024', mitDoi('10.48550/arxiv.2401.01234', arxivWerk({ titel: 'T', autoren: [], jahr: 2024 }))), 'gandhi2024')
    expect(abweichungen(richtig, null)).toEqual({ abweichungen: [] })
  })

  it('erwartet zu posted-content @online und zu einem Kapitel @incollection; misc passt zu allem', () => {
    const pre = eintrag(bibEintrag('lindgren2022', mitDoi('10.5555/spur.pre.001')), 'lindgren2022')
    expect(abweichungen(pre, crossref('10.5555/spur.pre.001'))).toEqual({ abweichungen: [] })
    const kapitel = eintrag('@article{berg2019, year = {2019}, pages = {45-67}, doi = {10.5555/spur.kap.001}}', 'berg2019')
    expect(abweichungen(kapitel, crossref('10.5555/spur.kap.001')).abweichungen).toEqual([{ feld: 'eintragstyp', eintrag: 'article', erwartet: 'incollection' }])
    const sonstiges = eintrag('@article{x, doi = {10.1/x}}', 'x')
    expect(abweichungen(sonstiges, { gefunden: true, registrierstelle: 'crossref', typ: 'dataset' })).toEqual({ abweichungen: [] })
  })

  it('nennt andere Seiten, fehlende Seiten aber nicht (Schritt f6: drei Abweichungen für alt2024)', () => {
    const falsch = eintrag('@article{k, volume = {35}, number = {2}, pages = {101--119}, year = {2025}, doi = {10.5555/spur.heft.001}}', 'k')
    expect(abweichungen(falsch, crossref('10.5555/spur.heft.001')).abweichungen).toEqual([{ feld: 'pages', eintrag: '101--119', erwartet: '101-118' }])
  })

  it('liest das Jahr eines @online-Eintrags aus date', () => {
    const pre = eintrag('@online{l, date = {2021-03-01}, doi = {10.5555/spur.pre.001}}', 'l')
    expect(abweichungen(pre, crossref('10.5555/spur.pre.001')).abweichungen).toEqual([{ feld: 'year', eintrag: '2021', erwartet: '2022' }])
  })

  it.each([
    ['ohne DOI', '@article{k, title = {X}}', undefined, 'ohne_doi'],
    ['Crossref nicht erreichbar', '@article{k, doi = {10.1/k}}', null, 'crossref_nicht_erreichbar'],
    ['Registrierstelle nicht erreichbar', '@article{k, doi = {10.1/k}}', { nichtPruefbar: 'registrierstelle_nicht_erreichbar' }, 'registrierstelle_nicht_erreichbar'],
    ['nicht bei Crossref', '@article{k, doi = {10.1/k}}', { gefunden: true, registrierstelle: 'datacite' }, 'nicht_bei_crossref'],
    ['nicht registriert', '@article{k, doi = {10.1/k}}', { gefunden: false, registrierstelle: null }, 'nicht_bei_crossref'],
  ])('ist null mit Grund, wenn nichts zu vergleichen ist: %s', (_name, bib, werk, grund) => {
    expect(abweichungen(eintrag(bib, 'k'), werk)).toEqual({ abweichungen: null, abweichungen_grund: grund })
  })
})
