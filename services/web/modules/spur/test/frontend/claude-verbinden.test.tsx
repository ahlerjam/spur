import { expect } from 'chai'
import fetchMock from 'fetch-mock'
import { fireEvent, render, screen } from '@testing-library/react'
import ClaudeVerbinden from '@modules/spur/frontend/js/claude/claude-verbinden'
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
    await screen.findByText(/Dieses Token erscheint nur einmal/)
    await screen.findByText(/Token gültig bis/)
    expect(container.textContent).to.contain(TOKEN)

    unmount()
    const neu = render(<ClaudeVerbinden />)
    await screen.findByText(/Token gültig bis/)
    expect(neu.container.textContent).to.not.contain(TOKEN)
    expect(screen.queryByText(/Dieses Token erscheint nur einmal/)).to.not.exist
  })
})
