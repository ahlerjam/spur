import { expect } from 'chai'
import fetchMock from 'fetch-mock'
import { fireEvent, render, screen } from '@testing-library/react'
import Semantik from '@modules/spur/frontend/js/quellen/semantik'
import { EditorProviders } from '../../../../test/frontend/helpers/editor-providers'
import { deutschAktivieren } from './helpers/deutsch'

const STAND = /\/quellen\/semantik$/

function zeigen() {
  render(<Semantik quellenAnzahl={1} oeffnen={() => {}} />, { wrapper: EditorProviders })
}

describe('Sinngemäße Suche', function () {
  deutschAktivieren()

  afterEach(function () {
    fetchMock.removeRoutes().clearHistory()
  })

  it('zeigt ohne Schalter nichts', async function () {
    fetchMock.get(STAND, { an: false })
    zeigen()
    await new Promise(r => setTimeout(r, 10))
    expect(screen.queryByText('Sinngemäß suchen')).to.not.exist
  })

  it('startet das Indexieren und zeigt den Fortschritt', async function () {
    fetchMock.get(STAND, { an: true, gesamt: 8, indexiert: 3, laeuft: false })
    fetchMock.post(/\/semantik\/indexieren$/, { status: 202, body: { job_id: 'j1' } })
    zeigen()
    await screen.findByText('Indexiert 3 von 8 Seiten')
    expect(fetchMock.callHistory.called(/\/semantik\/indexieren$/)).to.equal(true)
  })

  it('zeigt Treffer mit dem Hinweis, dass sie nichts belegen', async function () {
    fetchMock.get(STAND, { an: true, gesamt: 8, indexiert: 8, laeuft: false })
    fetchMock.get(/\/semantik\/suche\?q=/, {
      treffer: [{ quelleId: 'q1', dateiname: 'smith2024.pdf', seite: 3, label: '347', auszug: 'Sleep supports' }],
    })
    zeigen()
    fireEvent.change(await screen.findByRole('searchbox', { name: 'Sinngemäß suchen' }), {
      target: { value: 'memories' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Suchen' }))
    await screen.findByText('smith2024.pdf')
    screen.getByText('S. 347')
    screen.getByText('Ein Zitat belegen sie nicht.', { exact: false })
  })
})
