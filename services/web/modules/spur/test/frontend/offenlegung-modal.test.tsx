import { expect } from 'chai'
import fetchMock from 'fetch-mock'
import { fireEvent, render, screen } from '@testing-library/react'
import OffenlegungModal from '@modules/spur/frontend/js/claude/offenlegung-modal'
import { EditorProviders } from '../../../../test/frontend/helpers/editor-providers'
import { deutschAktivieren } from './helpers/deutsch'

const TEXT = /\/offenlegung\?/

describe('KI-Offenlegung', function () {
  deutschAktivieren()

  afterEach(function () {
    fetchMock.removeRoutes().clearHistory()
  })

  it('zeigt den Text und fügt ihn als .tex-Abschnitt ein', async function () {
    fetchMock.get(TEXT, { text: 'Protokolliert sind 2 Läufe.', leer: false })
    fetchMock.post(/\/offenlegung\/tex$/, { pfad: 'ki-offenlegung.tex', leer: false })
    render(<OffenlegungModal schliessen={() => {}} />, { wrapper: EditorProviders })
    await screen.findByText('Protokolliert sind 2 Läufe.')
    fireEvent.click(screen.getByRole('button', { name: 'Als .tex-Abschnitt einfügen' }))
    await screen.findByText('In ki-offenlegung.tex eingefügt.', { exact: false })
  })

  it('bietet ohne Läufe nichts zum Kopieren an', async function () {
    fetchMock.get(TEXT, { text: 'Keine KI-Nutzung protokolliert.', leer: true })
    render(<OffenlegungModal schliessen={() => {}} />, { wrapper: EditorProviders })
    await screen.findByText('Keine KI-Nutzung protokolliert.')
    expect(screen.getByRole('button', { name: 'Text kopieren' })).to.have.property('disabled', true)
  })
})
