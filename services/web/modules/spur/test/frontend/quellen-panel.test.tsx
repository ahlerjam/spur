import { expect } from 'chai'
import fetchMock from 'fetch-mock'
import { render, screen } from '@testing-library/react'
import QuellenPanel from '@modules/spur/frontend/js/quellen/quellen-panel'
import { EditorProviders } from '../../../../test/frontend/helpers/editor-providers'
import { deutschAktivieren } from './helpers/deutsch'

const QUELLEN = /\/spur\/project\/[^/]+\/quellen$/
const ANDERE = /\/spur\/project\/[^/]+\/quellen\/andere$/

function zeigen() {
  render(<QuellenPanel />, { wrapper: EditorProviders })
}

describe('Quellen-Panel', function () {
  deutschAktivieren()

  beforeEach(function () {
    fetchMock.removeRoutes().clearHistory()
    fetchMock.get(ANDERE, { projekte: [], klonVon: null })
  })

  afterEach(function () {
    fetchMock.removeRoutes().clearHistory()
  })

  it('zeigt „Noch keine Quellen“ ohne Daten', async function () {
    fetchMock.get(QUELLEN, { quellen: [], gesamt: 0 })
    zeigen()
    await screen.findByText('Noch keine Quellen')
  })

  it('zeigt vorhandene Quellen mit Dateiname', async function () {
    fetchMock.get(QUELLEN, {
      quellen: [
        {
          id: 'q1',
          dateiname: 'mueller2020.pdf',
          key: 'mueller2020',
          art: 'pdf',
          seitenzahl: 12,
          status: 'text',
          doi: null,
          titel: null,
          fassung: '',
          versatz: null,
          versatzQuelle: null,
        },
      ],
      gesamt: 1,
    })
    zeigen()
    await screen.findByText('mueller2020.pdf')
    expect(screen.queryByText('Noch keine Quellen')).to.not.exist
  })

  it('zeigt nach einem API-Fehler die Fehlermeldung als Text', async function () {
    fetchMock.get(QUELLEN, {
      status: 500,
      body: { detail: 'Quellen nicht erreichbar' },
    })
    zeigen()
    await screen.findByText('Quellen nicht erreichbar')
    expect(screen.queryByText('Noch keine Quellen')).to.not.exist
  })
})
