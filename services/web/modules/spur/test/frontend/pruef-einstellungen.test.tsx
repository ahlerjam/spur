import { expect } from 'chai'
import fetchMock from 'fetch-mock'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import PruefEinstellungen from '@modules/spur/frontend/js/pruefung/pruef-einstellungen'
import { EditorProviders } from '../../../../test/frontend/helpers/editor-providers'
import { deutschAktivieren } from './helpers/deutsch'

const MAKROS = /\/spur\/project\/[^/]+\/pruefbericht\/makros$/
const BERICHT = /\/spur\/project\/[^/]+\/pruefbericht$/

describe('Einstellungen der Prüfung', function () {
  deutschAktivieren()

  beforeEach(function () {
    fetchMock.removeRoutes().clearHistory()
    fetchMock.get(MAKROS, { zitat: [], ausgeblendet: ['alt'], erkannt: { zitat: ['zitat'], ausgeblendet: [] } })
    fetchMock.put(MAKROS, { zitat: ['wort'], ausgeblendet: ['alt'] })
    fetchMock.get(BERICHT, { zeilen: [], zaehlung: {}, uebersprungen: 0 })
  })

  afterEach(function () {
    fetchMock.removeRoutes().clearHistory()
  })

  it('zeigt erkannte Makros, lehnt ungültige Namen am Feld ab und speichert ohne Backslash', async function () {
    render(<PruefEinstellungen />, { wrapper: EditorProviders })
    const knopf = screen.getByRole('button', { name: 'Einstellungen der Prüfung' })
    fireEvent.click(knopf)
    await screen.findByText('Automatisch erkannt: zitat')
    const feld = screen.getByLabelText('Zitatmakros')
    expect((screen.getByLabelText('Ausgeblendete Makros') as HTMLInputElement).value).to.equal('alt')

    fireEvent.change(feld, { target: { value: 'wort 2' } })
    fireEvent.click(screen.getByRole('button', { name: 'Speichern' }))
    await screen.findByText('Nur Buchstaben, ohne Backslash')
    expect(fetchMock.callHistory.calls(MAKROS, { method: 'PUT' })).to.have.length(0)

    fireEvent.change(feld, { target: { value: '\\wort' } })
    fireEvent.click(screen.getByRole('button', { name: 'Speichern' }))
    await waitFor(() => expect(document.activeElement).to.equal(knopf))
    const [aufruf] = fetchMock.callHistory.calls(MAKROS, { method: 'PUT' })
    expect(JSON.parse(aufruf.options.body as string)).to.deep.equal({ zitat: ['wort'], ausgeblendet: ['alt'] })
    expect(screen.queryByLabelText('Zitatmakros')).to.not.exist
  })
})
