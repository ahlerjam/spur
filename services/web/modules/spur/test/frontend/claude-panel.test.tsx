import { expect } from 'chai'
import fetchMock from 'fetch-mock'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import ClaudePanel from '@modules/spur/frontend/js/claude/claude-panel'
import { EditorProviders } from '../../../../test/frontend/helpers/editor-providers'
import { deutschAktivieren } from './helpers/deutsch'

const STATUS = /\/spur\/project\/[^/]+\/claude$/
const AUFTRAG = /\/spur\/project\/[^/]+\/claude\/auftrag$/
const WORKFLOWS = /\/spur\/project\/[^/]+\/workflows$/
const STARTEN = /\/workflows\/methodenteil\/starten$/
const LISTE = {
  workflows: [
    { name: 'literaturueberblick', titel: 'Literaturüberblick', beschreibung: 'L' },
    { name: 'methodenteil', titel: 'Methodenteil', beschreibung: 'M' },
    { name: 'folien', titel: 'Folien aus Paper', beschreibung: 'F' },
  ],
}

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
    fetchMock.get(WORKFLOWS, LISTE)
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

  it('listet unter „Workflows“ die drei Workflows und startet einen per Klick', async function () {
    fetchMock.get(STATUS, status({}))
    fetchMock.post(STARTEN, { status: 201, body: { id: 'n2' } })
    zeigen()
    fireEvent.click(await screen.findByText('Workflows'))
    const knoepfe = await screen.findAllByRole('button', { name: /Literaturüberblick|Methodenteil|Folien aus Paper/ })
    expect(knoepfe.map(k => k.textContent)).to.deep.equal(['Literaturüberblick', 'Methodenteil', 'Folien aus Paper'])
    fireEvent.click(screen.getByRole('button', { name: 'Methodenteil' }))
    await waitFor(() => expect(fetchMock.callHistory.called(STARTEN)).to.equal(true))
  })

  it('zeigt ohne Verbindung keine Workflows', async function () {
    fetchMock.get(STATUS, status({ verbunden: false }))
    zeigen()
    await screen.findByText('Claude nicht verbunden')
    expect(screen.queryByText('Workflows')).to.equal(null)
  })

  it('zeigt die Lauf-Karte dort im Verlauf, wo der Lauf begann', async function () {
    fetchMock.get(
      STATUS,
      status({
        nachrichten: [nachricht(1, 'mensch', 'Fasse Abschnitt 2 zusammen'), nachricht(5, 'claude', 'Fertig.')],
        lauf: {
          id: 'l1',
          status: 'fertig',
          gestartet: new Date(2026, 10, 8, 10, 3).toISOString(),
          dateien: 1,
          aenderungen: 1,
          rot: [],
          zahlen: [],
          zusammenfassung: null,
        },
      })
    )
    zeigen()
    const log = await screen.findByRole('log', { name: 'Unterhaltung mit Claude' })
    const klassen = within(log)
      .getAllByRole('listitem')
      .filter(li => li.parentElement === log)
      .map(li => li.className)
    expect(klassen).to.deep.equal([
      'spur-chat-nachricht spur-nachricht-mensch',
      'spur-chat-lauf',
      'spur-chat-nachricht spur-nachricht-claude',
    ])
  })
})
