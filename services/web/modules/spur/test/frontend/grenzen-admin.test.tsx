import { expect } from 'chai'
import fetchMock from 'fetch-mock'
import { fireEvent, render, screen, within } from '@testing-library/react'
import GrenzenAdmin from '@modules/spur/frontend/js/grenzen/grenzen-admin'
import { deutschAktivieren } from './helpers/deutsch'

const DATEN = /\/spur\/admin\/grenzen\.json$/
const STANDARD = /\/spur\/admin\/grenzen\/standard$/

const daten = (tex: object = {}) => ({
  standard: { projekte: null, speicherGb: null, texPaketeAus: false, texPaketMb: null, texProjektMb: null, texProStunde: null, ...tex },
  texStandard: { texPaketMb: 100, texProjektMb: 300, texProStunde: 60 },
  nutzer: [],
  projekte: [],
})

describe('Grenzen für TeX-Pakete im Admin-Bereich', function () {
  deutschAktivieren()

  beforeEach(function () {
    fetchMock.removeRoutes().clearHistory()
  })

  afterEach(function () {
    fetchMock.removeRoutes().clearHistory()
  })

  it('zeigt die Standardwerte als Platzhalter und sendet die eingetragenen Werte', async function () {
    fetchMock.get(DATEN, daten())
    fetchMock.put(STANDARD, 204)
    render(<GrenzenAdmin />)
    const abschnitt = (await screen.findByRole('heading', { name: 'TeX-Pakete' })).closest('section') as HTMLElement
    const feld = (name: string) => within(abschnitt).getByLabelText(name) as HTMLInputElement
    expect(feld('Größe je Paket (MB)').placeholder).to.equal('100')
    expect(feld('Pakete je Projekt (MB)').placeholder).to.equal('300')
    expect(feld('Installationen je Stunde').placeholder).to.equal('60')
    fireEvent.change(feld('Größe je Paket (MB)'), { target: { value: '10' } })
    fireEvent.change(feld('Installationen je Stunde'), { target: { value: '2' } })
    fireEvent.click(within(abschnitt).getByRole('button', { name: 'Speichern' }))
    await screen.findByText('Gespeichert')
    const body = JSON.parse(String(fetchMock.callHistory.lastCall(STANDARD)?.options.body))
    expect(body).to.include({ texPaketMb: '10', texProjektMb: '', texProStunde: '2' })
  })

  it('zeigt gespeicherte Werte im Feld und Fehler am Feld', async function () {
    fetchMock.get(DATEN, daten({ texPaketMb: 10 }))
    fetchMock.put(STANDARD, { status: 422, body: { fehler: { texProStunde: 'Bitte eine ganze Zahl ab 1 eingeben.' } } })
    render(<GrenzenAdmin />)
    const feld = (await screen.findByLabelText('Größe je Paket (MB)')) as HTMLInputElement
    expect(feld.value).to.equal('10')
    fireEvent.change(screen.getByLabelText('Installationen je Stunde'), { target: { value: '0' } })
    fireEvent.click(screen.getByRole('button', { name: 'Speichern' }))
    await screen.findByText('Bitte eine ganze Zahl ab 1 eingeben.')
    expect(screen.getByLabelText('Installationen je Stunde').getAttribute('aria-invalid')).to.equal('true')
  })
})
