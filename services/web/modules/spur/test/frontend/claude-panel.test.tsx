import { expect } from 'chai'
import fetchMock from 'fetch-mock'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import ClaudePanel from '@modules/spur/frontend/js/claude/claude-panel'
import { START } from './helpers/start'
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
    { name: 'quellen_sammeln', titel: 'Quellen sammeln', beschreibung: 'Q', eingaben: ['thema', 'anzahl'] },
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
    screen.getByText(
      'Starte Claude Code im Terminal mit diesem Befehl. Claude wartet danach von selbst auf Aufträge aus diesem Panel:'
    )
    screen.getByText(START)
    expect(screen.queryByLabelText('Auftrag an Claude')).to.equal(null)
    expect(screen.queryByRole('button', { name: 'Senden' })).to.equal(null)
  })

  it('zeigt eine neue Verbindung binnen 5 s, auch kurz nach einer Abfrage', async function () {
    let verbunden = false
    fetchMock.get(STATUS, () => status({ verbunden }))
    zeigen()
    await screen.findByText('Claude nicht verbunden')
    verbunden = true
    await screen.findByText('Claude verbunden', {}, { timeout: 3000 })
  })

  it('zeigt den Startbefehl im Befehlskasten und kopiert genau ihn', async function () {
    const geschrieben: string[] = []
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: async (text: string) => geschrieben.push(text) },
      configurable: true,
    })
    fetchMock.get(STATUS, status({ verbunden: false }))
    zeigen()
    const kasten = (await screen.findByText(/claude --allowedTools/)).closest('.spur-befehl-kasten')!
    expect(kasten).to.exist
    fireEvent.click(within(kasten as HTMLElement).getByRole('button', { name: 'Kopieren' }))
    await screen.findByRole('button', { name: 'Kopiert' })
    expect(geschrieben).to.deep.equal([START])
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

  it('sagt, wenn der Verlauf ältere Nachrichten nicht zeigt', async function () {
    const nachrichten = [nachricht(1, 'claude', 'Antwort'), nachricht(2, 'mensch', 'Frage'), nachricht(3, 'mensch', 'Neueste Frage')]
    fetchMock.get(STATUS, status({ nachrichten, aeltere: true }))
    zeigen()
    await screen.findByText('Neueste Frage')
    screen.getByText('Ältere Nachrichten sind ausgeblendet; angezeigt werden die letzten 3.')
  })

  it('zeigt keinen Hinweis, wenn der Verlauf vollständig ist', async function () {
    fetchMock.get(STATUS, status({ nachrichten: [nachricht(1, 'mensch', 'Erste Frage')], aeltere: false }))
    zeigen()
    await screen.findByText('Erste Frage')
    expect(screen.queryByText(/Ältere Nachrichten/)).to.equal(null)
  })

  it('nennt in der Hilfe unter „Workflows“ die vier Befehle des Plugins', async function () {
    fetchMock.get(STATUS, status({}))
    zeigen()
    fireEvent.click(await screen.findByText('Workflows'))
    await screen.findByRole('button', { name: 'Folien aus Paper' })
    const hilfe = screen.getByRole('list', { name: 'Befehle in Claude Code' })
    expect(within(hilfe).getAllByRole('listitem').map(z => z.textContent)).to.deep.equal([
      '/plugin:spur:spur:literaturueberblick',
      '/plugin:spur:spur:methodenteil',
      '/plugin:spur:spur:folien',
      '/plugin:spur:spur:quellen_sammeln',
    ])
  })

  it('Quellen sammeln fragt Thema und Anzahl ab und meldet Fehler am Feld', async function () {
    fetchMock.get(STATUS, status({}))
    fetchMock.post(/\/workflows\/quellen_sammeln\/starten$/, { status: 201, body: { id: 'n1' } })
    zeigen()
    fireEvent.click(await screen.findByText('Workflows'))
    fireEvent.click(await screen.findByRole('button', { name: 'Quellen sammeln' }))
    const thema = screen.getByLabelText('Thema')
    const anzahl = screen.getByLabelText('Anzahl') as HTMLInputElement
    expect(anzahl.value).to.equal('20')
    const starten = screen.getByRole('button', { name: 'Sammeln starten' })

    fireEvent.click(starten)
    await screen.findByText('Gib ein Thema an.')
    expect(thema.getAttribute('aria-invalid')).to.equal('true')
    expect(document.getElementById(thema.getAttribute('aria-describedby')!)!.textContent).to.contain('Gib ein Thema an.')

    fireEvent.change(thema, { target: { value: 'Schlaf und Gedächtnis' } })
    for (const falsch of ['abc', '0']) {
      fireEvent.change(anzahl, { target: { value: falsch } })
      fireEvent.click(starten)
      await screen.findByText('Gib eine Zahl ab 1 oder „max“ an.')
      expect(anzahl.getAttribute('aria-invalid')).to.equal('true')
      expect(document.getElementById(anzahl.getAttribute('aria-describedby')!)!.textContent).to.contain(
        'Gib eine Zahl ab 1 oder „max“ an.'
      )
    }
    expect(fetchMock.callHistory.calls(/starten$/)).to.have.length(0)

    fireEvent.change(anzahl, { target: { value: '30' } })
    fireEvent.click(starten)
    await waitFor(() => expect(fetchMock.callHistory.calls(/starten$/)).to.have.length(1))
    const [aufruf] = fetchMock.callHistory.calls(/starten$/)
    expect(JSON.parse(aufruf.options.body as string)).to.deep.equal({ thema: 'Schlaf und Gedächtnis', anzahl: '30' })
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
