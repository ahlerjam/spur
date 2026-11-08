import { expect } from 'chai'
import fetchMock from 'fetch-mock'
import { render, screen } from '@testing-library/react'
import QuellenPanel from '@modules/spur/frontend/js/quellen/quellen-panel'
import { EditorProviders } from '../../../../test/frontend/helpers/editor-providers'
import { deutschAktivieren } from './helpers/deutsch'

const QUELLEN = /\/spur\/project\/[^/]+\/quellen$/
const ANDERE = /\/spur\/project\/[^/]+\/quellen\/andere$/
const ZUGEWIESEN = /\/spur\/project\/[^/]+\/zitate\/zugewiesen$/

function zeigen() {
  render(<QuellenPanel />, { wrapper: EditorProviders })
}

describe('Quellen-Panel', function () {
  deutschAktivieren()

  beforeEach(function () {
    fetchMock.removeRoutes().clearHistory()
    fetchMock.get(ANDERE, { projekte: [], klonVon: null })
    fetchMock.get(ZUGEWIESEN, { zitate: [] })
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
          ocr: null,
        },
      ],
      gesamt: 1,
    })
    zeigen()
    await screen.findByText('mueller2020.pdf')
    expect(screen.queryByText('Noch keine Quellen')).to.not.exist
  })

  it('zeigt Zitate, die mir zugewiesen sind, und öffnet sie', async function () {
    fetchMock.removeRoutes()
    fetchMock.get(ANDERE, { projekte: [], klonVon: null })
    fetchMock.get(QUELLEN, { quellen: [], gesamt: 0 })
    fetchMock.get(
      ZUGEWIESEN,
      {
        zitate: [
          {
            id: 'z1',
            seite: 3,
            label: '347',
            text: 'Sleep supports',
            von: { id: 'a', name: 'Anna Autor' },
            kommentare: [],
            zugewiesen: { an: { id: 'b', name: 'Ben' }, von: { id: 'a', name: 'Anna Autor' }, am: '2026-11-07T10:00:00Z' },
            quelle: { id: 'q1', dateiname: 'smith2024.pdf', art: 'pdf', seitenzahl: 8 },
          },
        ],
      }
    )
    fetchMock.get(/\/quellen\/q1\/seiten\/3$/, { text: 'Sleep supports', label: '347', seite: 3, seitenzahl: 8 })
    fetchMock.get(/\/quellen\/q1\/zitate$/, { zitate: [] })
    zeigen()
    await screen.findByText('Anna Autor hat Ihnen ein Zitat zugewiesen: „Sleep supports“ (smith2024.pdf, S. 347)')
    screen.getByRole('button', { name: 'Öffnen' }).click()
    await screen.findByText('Seite 347 (PDF-Seite 3 von 8)')
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
