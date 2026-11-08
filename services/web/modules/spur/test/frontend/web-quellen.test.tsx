import { expect } from 'chai'
import fetchMock from 'fetch-mock'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import QuellenPanel from '@modules/spur/frontend/js/quellen/quellen-panel'
import Zitate from '@modules/spur/frontend/js/quellen/zitate'
import type { Quelle } from '@modules/spur/frontend/js/quellen/typen'
import { EditorProviders } from '../../../../test/frontend/helpers/editor-providers'
import { deutschAktivieren } from './helpers/deutsch'

const QUELLEN = /\/spur\/project\/[^/]+\/quellen$/
const WEB = /\/spur\/project\/[^/]+\/quellen\/web$/
const ANDERE = /\/spur\/project\/[^/]+\/quellen\/andere$/
const ZUGEWIESEN = /\/spur\/project\/[^/]+\/zitate\/zugewiesen$/

const webQuelle: Quelle = {
  id: 'w1',
  dateiname: 'schlafhygiene-im-schichtdienst.html',
  key: 'schlafhygiene-im-schichtdienst',
  art: 'web',
  seitenzahl: 1,
  status: 'text',
  doi: null,
  titel: 'Schlafhygiene im Schichtdienst',
  fassung: '',
  versatz: null,
  versatzQuelle: null,
  ocr: null,
  web: { url: 'https://example.org/schlaf', abgerufenAm: '2026-11-01T09:00:00.000Z' },
}

describe('Webseiten als Schnappschuss', function () {
  deutschAktivieren()

  beforeEach(function () {
    fetchMock.removeRoutes().clearHistory()
    fetchMock.get(ANDERE, { projekte: [], klonVon: null })
    fetchMock.get(ZUGEWIESEN, { zitate: [] })
  })

  afterEach(function () {
    fetchMock.removeRoutes().clearHistory()
  })

  it('nimmt eine Adresse auf und zeigt danach Titel, Adresse und Abrufdatum', async function () {
    let aufgenommen = false
    fetchMock.get(QUELLEN, () => ({ quellen: aufgenommen ? [webQuelle] : [], gesamt: aufgenommen ? 1 : 0 }))
    fetchMock.post(WEB, () => {
      aufgenommen = true
      return { status: 201, body: webQuelle }
    })
    render(<QuellenPanel />, { wrapper: EditorProviders })
    await screen.findByText('Noch keine Quellen')
    const knopf = screen.getByRole('button', { name: 'Webseite aufnehmen' })
    fireEvent.click(knopf)
    fireEvent.change(screen.getByLabelText('Adresse der Webseite'), { target: { value: 'https://example.org/schlaf' } })
    fireEvent.click(screen.getByRole('button', { name: 'Aufnehmen' }))
    await screen.findByRole('button', { name: 'Schlafhygiene im Schichtdienst' })
    screen.getByText('Webseite · abgerufen am 1. November 2026')
    screen.getByText('https://example.org/schlaf')
    expect(JSON.parse(fetchMock.callHistory.lastCall(WEB)!.options.body as string)).to.deep.equal({ url: 'https://example.org/schlaf' })
    expect(screen.queryByLabelText('Adresse der Webseite')).to.not.exist
    await waitFor(() => expect(document.activeElement).to.equal(knopf))
  })

  it('zeigt bei Zitaten aus einem Schnappschuss keine Seite', async function () {
    fetchMock.get(/\/quellen\/w1\/zitate$/, {
      zitate: [{ id: 'z1', seite: 1, label: null, text: 'Regular sleep times help.', von: { id: 'x', name: 'Ben Berater' }, kommentare: [], zugewiesen: null, bestaetigt: null }],
    })
    render(<Zitate quelle={webQuelle} seite={1} textElement={null} />, { wrapper: EditorProviders })
    await screen.findByText('von Ben Berater')
  })

  it('zeigt „Seite nicht erreichbar“ und behält die Adresse zum Korrigieren', async function () {
    fetchMock.get(QUELLEN, { quellen: [], gesamt: 0 })
    fetchMock.post(WEB, {
      status: 502,
      headers: { 'Content-Type': 'application/problem+json' },
      body: { detail: 'Seite nicht erreichbar. Bitte die Adresse prüfen oder später erneut versuchen.' },
    })
    render(<QuellenPanel />, { wrapper: EditorProviders })
    await screen.findByText('Noch keine Quellen')
    fireEvent.click(screen.getByRole('button', { name: 'Webseite aufnehmen' }))
    const feld = screen.getByLabelText('Adresse der Webseite')
    fireEvent.change(feld, { target: { value: 'http://nicht-erreichbar.invalid/' } })
    fireEvent.click(screen.getByRole('button', { name: 'Aufnehmen' }))
    await screen.findByText('Seite nicht erreichbar. Bitte die Adresse prüfen oder später erneut versuchen.')
    expect(feld).to.have.property('value', 'http://nicht-erreichbar.invalid/')
    screen.getByText('Noch keine Quellen')
  })
})
