import { expect } from 'chai'
import fetchMock from 'fetch-mock'
import { fireEvent, render, screen } from '@testing-library/react'
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
  hinweise: [],
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

  it('zeigt „Keine Treffer“ ohne Ergebnis', async function () {
    fetchMock.get(SUCHE, ergebnis({ treffer: [] }))
    suchen('xyzzy')
    await screen.findByText('Keine Treffer')
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
    fireEvent.click(await screen.findByRole('button', { name: 'Zitiert von' }))
    const liste = await screen.findByRole('region', { name: 'Zitiert von' })
    await screen.findByText('Sleep spindles')
    expect(liste.textContent).to.contain('10.1/b')
    const url = fetchMock.callHistory.calls().find(c => ZITATIONEN.test(c.url))!.url
    expect(url).to.contain('richtung=zitiert_von')
    expect(screen.getByRole('button', { name: 'Zitiert von' }).getAttribute('aria-expanded')).to.equal('true')
  })

  it('listet das Suchprotokoll und bietet den Export an', async function () {
    fetchMock.get(PROTOKOLL, {
      eintraege: [{ datum: '2026-11-08T10:00:00.000Z', dienst: 'OpenAlex', anfrage: 'sleep', treffer: 25 }],
      gesamt: 1,
      weiter: false,
    })
    render(<RecherchePanel />, { wrapper: EditorProviders })
    fireEvent.click(screen.getByRole('tab', { name: 'Suchprotokoll' }))
    await screen.findByText('sleep')
    screen.getByText('OpenAlex · 25 Treffer ·', { exact: false })
    const link = screen.getByRole('link', { name: 'Protokoll exportieren' })
    expect(link.getAttribute('href')).to.match(/\/recherche\/protokoll\.csv$/)
  })

  it('zeigt ein leeres Suchprotokoll', async function () {
    fetchMock.get(PROTOKOLL, { eintraege: [], gesamt: 0, weiter: false })
    render(<RecherchePanel />, { wrapper: EditorProviders })
    fireEvent.click(screen.getByRole('tab', { name: 'Suchprotokoll' }))
    await screen.findByText('Noch keine Suchen protokolliert')
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
