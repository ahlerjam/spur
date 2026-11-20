import { expect } from 'chai'
import fetchMock from 'fetch-mock'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import RecherchePanel from '@modules/spur/frontend/js/recherche/recherche-panel'
import { EditorProviders } from '../../../../test/frontend/helpers/editor-providers'
import { deutschAktivieren } from './helpers/deutsch'

const SUCHE = /\/spur\/project\/[^/]+\/recherche\?/
const ZITATIONEN = /\/recherche\/zitationen\?/
const PROTOKOLL = /\/recherche\/protokoll\?/

const NRN = {
  doi: '10.1038/nrn2762',
  titel: 'The memory function of sleep',
  autoren: ['Susanne Diekelmann', 'Jan Born'],
  jahr: 2010,
  dienste: ['OpenAlex', 'Crossref'],
  frei: false,
  pdf: null,
  lizenz: null,
}

const ergebnis = (teil: object) => ({
  anfrage: 'sleep',
  seite: 0,
  treffer: [NRN],
  weiter: false,
  fehler: [],
  hinweis: null,
  ...teil,
})

function suchen(begriff: string) {
  render(<RecherchePanel />, { wrapper: EditorProviders })
  fireEvent.change(screen.getByRole('searchbox', { name: 'Paper suchen' }), {
    target: { value: begriff },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Suchen' }))
}

describe('Recherche-Panel', function () {
  deutschAktivieren()

  beforeEach(function () {
    fetchMock.removeRoutes().clearHistory()
  })

  afterEach(function () {
    fetchMock.removeRoutes().clearHistory()
  })

  it('zeigt Titel, Autoren, Jahr und die Dienste eines Treffers', async function () {
    fetchMock.get(SUCHE, ergebnis({}))
    suchen('sleep')
    await screen.findByText('The memory function of sleep')
    screen.getByText('Susanne Diekelmann, Jan Born · 2010')
    screen.getByText('Gefunden über OpenAlex, Crossref', { exact: false })
    screen.getByText('Nicht frei')
    const url = fetchMock.callHistory.lastCall()?.url ?? ''
    expect(url).to.contain('anfrage=sleep')
  })

  it('nennt einen ausgefallenen Dienst und zeigt die übrigen Treffer', async function () {
    fetchMock.get(
      SUCHE,
      ergebnis({
        fehler: [{ dienst: 's2', art: 'nicht_erreichbar', text: 'Semantic Scholar nicht erreichbar' }],
      })
    )
    suchen('sleep')
    await screen.findByText('Semantic Scholar nicht erreichbar')
    screen.getByText('The memory function of sleep')
  })

  it('nennt bei keinem Treffer den Begriff und den nächsten Schritt', async function () {
    fetchMock.get(SUCHE, ergebnis({ treffer: [] }))
    suchen('xyzxyz')
    await screen.findByText('Keine Treffer für „xyzxyz“. Prüf die Schreibweise oder such nach der DOI.')
  })

  it('zeigt während der Suche Platzhalter in Form der Treffer', async function () {
    let freigeben = () => {}
    fetchMock.get(SUCHE, new Promise(resolve => {
      freigeben = () => resolve(ergebnis({}))
    }))
    suchen('sleep')
    await waitFor(() => expect(document.querySelectorAll('.spur-platzhalter-zeile').length).to.be.greaterThan(0))
    freigeben()
    await screen.findByText('The memory function of sleep')
    expect(document.querySelector('.spur-platzhalter-zeile')).to.equal(null)
  })

  it('wechselt die Reiter mit den Pfeiltasten', async function () {
    render(<RecherchePanel />, { wrapper: EditorProviders })
    const treffer = screen.getByRole('tab', { name: 'Treffer' })
    expect(treffer.getAttribute('tabindex')).to.equal('0')
    fireEvent.keyDown(treffer, { key: 'ArrowRight' })
    const protokoll = screen.getByRole('tab', { name: 'Suchprotokoll' })
    expect(protokoll.getAttribute('aria-selected')).to.equal('true')
    expect(document.activeElement).to.equal(protokoll)
    fireEvent.keyDown(protokoll, { key: 'ArrowLeft' })
    expect(screen.getByRole('tab', { name: 'Treffer' }).getAttribute('aria-selected')).to.equal('true')
    screen.getByRole('tabpanel', { name: 'Treffer' })
  })

  it('blättert zur nächsten Seite', async function () {
    fetchMock.get(SUCHE, ergebnis({ weiter: true }))
    suchen('sleep')
    fireEvent.click(await screen.findByRole('button', { name: 'Nächste Seite' }))
    await screen.findByText('Seite 1')
    const seiten = fetchMock.callHistory
      .calls()
      .filter(c => SUCHE.test(c.url))
      .map(c => new URL(c.url, 'http://x').searchParams.get('seite'))
    expect(seiten).to.deep.equal(['0', '1'])
  })

  it('klappt „Zitiert von“ auf und zeigt die zitierenden Arbeiten', async function () {
    fetchMock.get(SUCHE, ergebnis({}))
    fetchMock.get(ZITATIONEN, {
      treffer: [{ ...NRN, doi: '10.1/b', titel: 'Sleep spindles' }],
      fehler: [],
    })
    suchen('sleep')
    fireEvent.click(await screen.findByRole('button', { name: 'Weitere Aktionen' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Zitiert von' }))
    const liste = await screen.findByRole('region', { name: 'Zitiert von' })
    await screen.findByText('Sleep spindles')
    expect(liste.textContent).to.contain('10.1/b')
    const url = fetchMock.callHistory.calls().find(c => ZITATIONEN.test(c.url))!.url
    expect(url).to.contain('richtung=zitiert_von')
    expect(screen.getByRole('link', { name: '10.1038/nrn2762' }).getAttribute('href')).to.equal('https://doi.org/10.1038/nrn2762')
  })

  it('listet das Suchprotokoll und bietet den Export an', async function () {
    fetchMock.get(PROTOKOLL, {
      eintraege: [
        {
          zeit: '2026-11-16T10:05:00.000Z',
          anfrage: 'slow-wave sleep',
          seite: 1,
          filter: null,
          dienste: [
            { dienst: 'OpenAlex', status: 'geantwortet', treffer: 2, versuche: 1 },
            { dienst: 'Semantic Scholar', status: 'gedrosselt', treffer: 0, versuche: 3 },
            { dienst: 'Crossref', status: 'nicht_erreichbar', treffer: 0, versuche: 1 },
          ],
          treffer: 2,
          dubletten: 1,
        },
        // Ein Eintrag von vor P12: je Dienst gespeichert, ohne Dubletten.
        { zeit: '2026-11-08T10:00:00.000Z', anfrage: 'sleep', seite: 0, filter: null, dienste: [{ dienst: 'OpenAlex', status: 'geantwortet', treffer: 25 }], treffer: 25, dubletten: null },
      ],
      gesamt: 2,
      weiter: false,
      prisma: {
        identifiziert: 9,
        identifiziert_nach_dienst: { OpenAlex: 7, 'Semantic Scholar': 2 },
        dubletten: 2,
        gesichtet: 7,
        aufgenommen: 2,
        ausgeschlossen: { gesamt: 3, nach_grund: { 'falsche Population': 2, 'kein empirischer Beitrag': 1 } },
        nicht_beschaffbar: { nicht_frei: 1 },
        offen: 1,
      },
    })
    render(<RecherchePanel />, { wrapper: EditorProviders })
    fireEvent.click(screen.getByRole('tab', { name: 'Suchprotokoll' }))
    // Die Teile der Summenzeile stehen in eigenen Elementen, damit Zahl und Begriff nicht auseinanderbrechen.
    const summe = await screen.findByText((_, el) => el?.classList.contains('spur-prisma-zeile') ?? false)
    expect(summe.textContent).to.equal('9 identifiziert, 2 Dubletten, 7 gesichtet, 2 aufgenommen, 3 ausgeschlossen, 1 nicht beschaffbar, 1 offen')
    screen.getByText('Ausgeschlossen nach Grund: falsche Population (2), kein empirischer Beitrag (1)')
    screen.getByText('Nicht beschaffbar: nicht frei verfügbar (1)')
    const neu = screen.getByText('slow-wave sleep').closest('li')!
    expect(neu.textContent).to.contain('Seite 2 · 2 Treffer · 1 Dublette ·')
    expect(neu.textContent).to.contain('OpenAlex: 2 Treffer')
    expect(neu.textContent).to.contain('Semantic Scholar: gedrosselt · 3 Versuche')
    expect(neu.textContent).to.contain('Crossref: nicht erreichbar')
    const alt = screen.getByText('sleep').closest('li')!
    expect(alt.textContent).to.contain('Seite 1 · 25 Treffer ·')
    expect(alt.textContent).not.to.contain('Dublette')
    expect(alt.textContent).to.contain('OpenAlex: 25 Treffer')
    const link = screen.getByRole('link', { name: 'Protokoll exportieren' })
    expect(link.getAttribute('href')).to.match(/\/recherche\/protokoll\.csv$/)
  })

  it('zeigt ein leeres Suchprotokoll', async function () {
    fetchMock.get(PROTOKOLL, { eintraege: [], gesamt: 0, weiter: false })
    render(<RecherchePanel />, { wrapper: EditorProviders })
    fireEvent.click(screen.getByRole('tab', { name: 'Suchprotokoll' }))
    await screen.findByText('Noch keine Suche', { exact: false })
  })

  it('nimmt einen freien Treffer auf und meldet eine Dublette als „Bereits vorhanden“', async function () {
    fetchMock.get(SUCHE, ergebnis({ treffer: [{ ...NRN, frei: true }] }))
    let aufrufe = 0
    fetchMock.post(/\/recherche\/aufnehmen$/, () =>
      ++aufrufe === 1
        ? { status: 201, body: { key: 'diekelmann2010' } }
        : { status: 409, body: { detail: 'Bereits vorhanden' } }
    )
    suchen('sleep')
    fireEvent.click(await screen.findByRole('button', { name: 'Aufnehmen' }))
    await screen.findByText('Aufgenommen als „diekelmann2010“: Quelle mit PDF und Eintrag in der .bib')
    const body = fetchMock.callHistory.lastCall(/\/recherche\/aufnehmen$/)?.options.body
    expect(JSON.parse(String(body))).to.deep.equal({ doi: '10.1038/nrn2762' })

    fireEvent.click(screen.getByRole('button', { name: 'Aufnehmen' }))
    await screen.findByText('Bereits vorhanden')
  })

  it('bietet „Aufnehmen“ nur für freie Treffer an', async function () {
    fetchMock.get(SUCHE, ergebnis({}))
    suchen('sleep')
    await screen.findByText('The memory function of sleep')
    expect(screen.queryByRole('button', { name: 'Aufnehmen' })).to.not.exist
  })
})
