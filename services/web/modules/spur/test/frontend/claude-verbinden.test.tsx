import { expect } from 'chai'
import fetchMock from 'fetch-mock'
import { fireEvent, render, screen } from '@testing-library/react'
import ClaudeVerbinden, {
  startBefehl,
} from '@modules/spur/frontend/js/claude/claude-verbinden'
import getMeta from '@/utils/meta'
import { deutschAktivieren } from './helpers/deutsch'

const TOKEN = 'geheimes-token-123'
const ABLAUF = '2027-03-15T12:00:00.000Z'

describe('Claude verbinden', function () {
  deutschAktivieren()

  let angelegt: boolean

  beforeEach(function () {
    angelegt = false
    fetchMock.removeRoutes().clearHistory()
    fetchMock.get('/spur/claude/tokens', () => ({
      tokens: angelegt
        ? [{ id: 't1', angelegt: ABLAUF, ablauf: ABLAUF, abgelaufen: false }]
        : [],
    }))
    fetchMock.post('/spur/claude/tokens', () => {
      angelegt = true
      return { token: TOKEN }
    })
  })

  afterEach(function () {
    fetchMock.removeRoutes().clearHistory()
  })

  it('zeigt das Token genau einmal und danach nur noch „gültig bis“', async function () {
    const { unmount, container } = render(<ClaudeVerbinden />)
    expect(container.textContent).to.not.contain(TOKEN)

    fireEvent.click(screen.getByRole('button', { name: 'Token erzeugen' }))
    await screen.findByText(/Deinen Schlüssel siehst du nur jetzt/)
    await screen.findByText(/Token gültig bis/)
    expect(container.textContent).to.contain(TOKEN)

    unmount()
    const neu = render(<ClaudeVerbinden />)
    await screen.findByText(/Token gültig bis/)
    expect(neu.container.textContent).to.not.contain(TOKEN)
    expect(screen.queryByText(/Deinen Schlüssel siehst du nur jetzt/)).to.not.exist
  })

  it('zeigt die Anleitung in drei Schritten, je Befehl ein Kasten mit eigenem Kopierknopf', async function () {
    const geschrieben: string[] = []
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: async (text: string) => geschrieben.push(text) },
      configurable: true,
    })
    render(<ClaudeVerbinden />)
    fireEvent.click(screen.getByRole('button', { name: 'Token erzeugen' }))
    await screen.findByText('So verbindest du Claude Code')
    screen.getByText(
      'Deinen Schlüssel siehst du nur jetzt. Kopiere die Befehle, bevor du die Seite verlässt.'
    )
    const schritte = screen.getAllByRole('listitem').filter(li => li.querySelector('pre'))
    expect(schritte).to.have.length(3)
    const titel = ['spur bei Claude Code bekannt machen', 'spur mit deinem Konto verbinden', 'Claude Code starten']
    const texte = [
      'Das brauchst du nur einmal pro Rechner.',
      'Der Befehl enthält deinen persönlichen Schlüssel. Gib ihn nicht weiter.',
      'Starte damit Claude Code im Terminal. Claude darf dann in spur schreiben, ohne bei jedem Schritt nachzufragen. Den Befehl brauchst du bei jedem Start; er steht auch im Claude-Panel deines Projekts.',
    ]
    const befehle = [
      'claude plugin marketplace add ahlerjam/spur',
      `claude plugin install spur@spur --config server_url=${getMeta('ol-ExposedSettings').siteUrl}/spur/mcp --config token=${TOKEN}`,
      startBefehl(),
    ]
    schritte.forEach((schritt, i) => {
      expect(schritt.textContent).to.contain(titel[i])
      expect(schritt.textContent).to.contain(texte[i])
      expect(schritt.querySelector('pre')!.textContent).to.equal(befehle[i])
    })
    const knoepfe = screen.getAllByRole('button', { name: 'Kopieren' })
    expect(knoepfe).to.have.length(3)
    fireEvent.click(knoepfe[1])
    await screen.findByRole('button', { name: 'Kopiert' })
    expect(geschrieben).to.deep.equal([befehle[1]])
    expect(screen.getAllByRole('button', { name: 'Kopieren' })).to.have.length(2)
  })

  it('bleibt ohne Zwischenablage (HTTP ohne TLS) bedienbar', async function () {
    Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true })
    const fehler: unknown[] = []
    const merken = (e: PromiseRejectionEvent | ErrorEvent) => fehler.push(e)
    window.addEventListener('error', merken)
    render(<ClaudeVerbinden />)
    fireEvent.click(screen.getByRole('button', { name: 'Token erzeugen' }))
    await screen.findByText('So verbindest du Claude Code')
    expect(() => fireEvent.click(screen.getAllByRole('button', { name: 'Kopieren' })[0])).not.to.throw()
    window.removeEventListener('error', merken)
    expect(fehler).to.deep.equal([])
    expect(screen.getAllByRole('button', { name: 'Kopieren' })).to.have.length(3)
  })

  it('zeigt nach einem neuen Token wieder „Kopieren“', async function () {
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: async () => {} }, configurable: true })
    let nr = 0
    fetchMock.removeRoutes()
    fetchMock.get('/spur/claude/tokens', { tokens: [] })
    fetchMock.post('/spur/claude/tokens', () => ({ token: `token-${++nr}` }))
    render(<ClaudeVerbinden />)
    fireEvent.click(screen.getByRole('button', { name: 'Token erzeugen' }))
    await screen.findByText(/token=token-1/)
    fireEvent.click(screen.getAllByRole('button', { name: 'Kopieren' })[1])
    await screen.findByRole('button', { name: 'Kopiert' })
    fireEvent.click(screen.getByRole('button', { name: 'Token erzeugen' }))
    await screen.findByText(/token=token-2/)
    expect(screen.queryByRole('button', { name: 'Kopiert' })).to.equal(null)
  })
})

describe('Claude verbinden auf Englisch', function () {
  beforeEach(function () {
    fetchMock.removeRoutes().clearHistory()
    fetchMock.get('/spur/claude/tokens', { tokens: [] })
    fetchMock.post('/spur/claude/tokens', { token: TOKEN })
  })

  afterEach(function () {
    fetchMock.removeRoutes().clearHistory()
  })

  it('zeigt die Anleitung auf Englisch ohne deutschen Rest', async function () {
    const { container } = render(<ClaudeVerbinden />)
    fireEvent.click(screen.getByRole('button', { name: 'Create token' }))
    await screen.findByText('How to connect Claude Code')
    expect(screen.getAllByRole('button', { name: 'Copy' })).to.have.length(3)
    expect(container.textContent).to.not.match(/\b(du|dein|deinen|Schritt|Kopieren|Befehl|verbinden)\b/i)
  })
})
