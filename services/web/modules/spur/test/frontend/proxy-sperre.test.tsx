import { expect } from 'chai'
import fetchMock from 'fetch-mock'
import { fireEvent, render, screen } from '@testing-library/react'
import { anfrage, ApiFehler } from '@modules/spur/frontend/js/api'
import QuellenPanel from '@modules/spur/frontend/js/quellen/quellen-panel'
import { fremdeAntwort, proxyFehlerVon } from '@/features/pdf-preview/util/proxy-sperre'
import { EditorProviders } from '../../../../test/frontend/helpers/editor-providers'
import { deutschAktivieren } from './helpers/deutsch'

const SPERRE = 'Ein Proxy oder Filter in deinem Netz blockiert diese Anfrage (Status 403). Das liegt nicht an deinem Dokument. Wende dich an deine IT oder versuch es in einem anderen Netz.'
const SPERRE_OHNE = 'Ein Proxy oder Filter in deinem Netz blockiert diese Anfrage. Das liegt nicht an deinem Dokument. Wende dich an deine IT oder versuch es in einem anderen Netz.'
const HTML = { 'Content-Type': 'text/html' }
const QUELLEN = /\/spur\/project\/[^/]+\/quellen$/

async function fehlerVon(aufruf: Promise<unknown>) {
  try {
    await aufruf
  } catch (error) {
    return error as ApiFehler
  }
  throw new Error('kein Fehler')
}

describe('Proxy-Sperre', function () {
  deutschAktivieren()

  beforeEach(function () {
    fetchMock.removeRoutes().clearHistory()
  })

  afterEach(function () {
    fetchMock.removeRoutes().clearHistory()
  })

  it('meldet eine HTML-Seite mit 403 auf eine spur-Anfrage als Proxy-Sperre mit Status', async function () {
    fetchMock.get('/spur/x', { status: 403, body: '<html>Forbidden</html>', headers: HTML })
    const fehler = await fehlerVon(anfrage('/spur/x'))
    expect(fehler.message).to.equal(SPERRE)
    expect(fehler.status).to.equal(403)
  })

  it('meldet eine HTML-Seite mit 200 als Proxy-Sperre ohne Status', async function () {
    fetchMock.get('/spur/x', { status: 200, body: '<html>Blockiert</html>', headers: HTML })
    expect((await fehlerVon(anfrage('/spur/x'))).message).to.equal(SPERRE_OHNE)
  })

  it('nimmt leere Antworten und JSON-Fehler wie bisher', async function () {
    fetchMock.put('/spur/leer', 204)
    expect(await anfrage('/spur/leer', { method: 'PUT' })).to.equal(null)
    fetchMock.get('/spur/fehler', { status: 422, body: { detail: 'Name fehlt.' } })
    expect((await fehlerVon(anfrage('/spur/fehler'))).message).to.equal('Name fehlt.')
  })

  it('erkennt beim PDF eine fremde Seite, ein echtes (auch defektes) PDF aber nicht', async function () {
    fetchMock.get('/pdf/html', { status: 403, body: '<html></html>', headers: HTML })
    fetchMock.get('/pdf/ok-html', { status: 200, body: '<html></html>', headers: HTML })
    fetchMock.get('/pdf/kaputt', { status: 200, body: '%PDF-1.5\n1 0 obj', headers: { 'Content-Type': 'application/pdf' } })
    expect(await fremdeAntwort('/pdf/html')).to.deep.equal({ status: 403 })
    expect(await fremdeAntwort('/pdf/ok-html')).to.deep.equal({ status: undefined })
    expect(await fremdeAntwort('/pdf/kaputt')).to.equal(null)
    expect(proxyFehlerVon(403)).to.equal('proxy-blocked:403')
    expect(proxyFehlerVon()).to.equal('proxy-blocked')
  })

  it('zeigt im Quellen-Panel die Proxy-Meldung als Alarm und lädt nach „Erneut versuchen“ neu', async function () {
    fetchMock.get(/\/quellen\/andere$/, { projekte: [], klonVon: null })
    fetchMock.get(/\/zitate\/zugewiesen$/, { zitate: [] })
    let gesperrt = true
    fetchMock.get(QUELLEN, () =>
      gesperrt ? { status: 403, body: '<html>Forbidden</html>', headers: HTML } : { quellen: [], gesamt: 0 }
    )
    render(<QuellenPanel />, { wrapper: EditorProviders })
    const meldung = await screen.findByText(SPERRE)
    expect(meldung.closest('[role="alert"]')).to.exist
    gesperrt = false
    fireEvent.click(screen.getByRole('button', { name: 'Erneut versuchen' }))
    await screen.findByText(/^Noch keine Quellen\./)
  })
})
