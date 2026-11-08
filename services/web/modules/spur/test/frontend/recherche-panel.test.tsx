import { expect } from 'chai'
import fetchMock from 'fetch-mock'
import { fireEvent, render, screen } from '@testing-library/react'
import RecherchePanel from '@modules/spur/frontend/js/recherche/recherche-panel'
import { EditorProviders } from '../../../../test/frontend/helpers/editor-providers'
import { deutschAktivieren } from './helpers/deutsch'

const SUCHE = /\/spur\/project\/[^/]+\/recherche\?/

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
})
