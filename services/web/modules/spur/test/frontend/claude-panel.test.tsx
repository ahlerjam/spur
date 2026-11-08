import { expect } from 'chai'
import fetchMock from 'fetch-mock'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import ClaudePanel from '@modules/spur/frontend/js/claude/claude-panel'
import { EditorProviders } from '../../../../test/frontend/helpers/editor-providers'
import { deutschAktivieren } from './helpers/deutsch'

const STATUS = /\/spur\/project\/[^/]+\/claude$/
const AUFTRAG = /\/spur\/project\/[^/]+\/claude\/auftrag$/

const nachricht = (id: number, von: 'mensch' | 'claude', text: string) => ({
  id: `n${id}`,
  von,
  text,
  am: new Date(2026, 10, 8, 10, id).toISOString(),
})

const status = (teil: object) => ({
  verbunden: true,
  nachrichten: [],
  automatik: false,
  lauf: null,
  aenderungen: [],
  ...teil,
})

function zeigen() {
  render(<ClaudePanel />, { wrapper: EditorProviders })
}

describe('Claude-Panel', function () {
  deutschAktivieren()

  beforeEach(function () {
    fetchMock.removeRoutes().clearHistory()
  })

  afterEach(function () {
    fetchMock.removeRoutes().clearHistory()
  })

  it('zeigt ohne Verbindung den Startbefehl und kein Eingabefeld', async function () {
    fetchMock.get(STATUS, status({ verbunden: false }))
    zeigen()
    await screen.findByText('Claude nicht verbunden')
    screen.getByText(/claude --allowedTools/)
    expect(screen.queryByLabelText('Auftrag an Claude')).to.equal(null)
    expect(screen.queryByRole('button', { name: 'Senden' })).to.equal(null)
  })

  it('zeigt den Verlauf von alt nach neu als Log für Screenreader', async function () {
    fetchMock.get(
      STATUS,
      status({
        nachrichten: [
          nachricht(1, 'mensch', 'Fasse Abschnitt 2 zusammen'),
          nachricht(2, 'claude', 'Abschnitt 2 handelt von Schlaf.'),
        ],
      })
    )
    zeigen()
    const log = await screen.findByRole('log', { name: 'Unterhaltung mit Claude' })
    const zeilen = within(log).getAllByRole('listitem').map(li => li.textContent)
    expect(zeilen[0]).to.contain('Fasse Abschnitt 2 zusammen')
    expect(zeilen[1]).to.contain('Abschnitt 2 handelt von Schlaf.')
    expect(screen.queryByText('Claude arbeitet …')).to.equal(null)
  })

  it('zeigt „Claude arbeitet …“, solange die letzte Nachricht von der Person ist', async function () {
    fetchMock.get(STATUS, status({ nachrichten: [nachricht(1, 'mensch', 'Fasse Abschnitt 2 zusammen')] }))
    zeigen()
    await screen.findByText('Claude arbeitet …')
  })

  it('sendet mit Strg+Enter und leert das Feld', async function () {
    fetchMock.get(STATUS, status({}))
    fetchMock.post(AUFTRAG, { status: 201, body: { id: 'n1' } })
    zeigen()
    const feld = await screen.findByLabelText('Auftrag an Claude')
    fireEvent.change(feld, { target: { value: 'Fasse Abschnitt 2 zusammen' } })
    fireEvent.keyDown(feld, { key: 'Enter', ctrlKey: true })
    await waitFor(() => expect(fetchMock.callHistory.called(AUFTRAG)).to.equal(true))
    const body = JSON.parse(String(fetchMock.callHistory.lastCall(AUFTRAG)?.options.body))
    expect(body).to.deep.equal({ text: 'Fasse Abschnitt 2 zusammen' })
    await waitFor(() => expect((feld as HTMLTextAreaElement).value).to.equal(''))
  })
})
