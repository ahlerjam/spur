import { expect } from 'chai'
import fetchMock from 'fetch-mock'
import { render, screen, waitFor } from '@testing-library/react'
import { ReviewPanelChangeUser } from '@/features/review-panel/components/review-panel-change-user'
import { EditorProviders } from '../../../../test/frontend/helpers/editor-providers'
import { Change } from '../../../../types/change'
import { UserId } from '../../../../types/user'

// Kern-Patch aus P1: Ein Autor, der erst nach dem Laden Änderungen schreibt (der Claude-Bot), wird
// nachgeladen statt bis zum Neuladen als „Deleted user“ zu erscheinen.
const BOT = '6a1b2c3d4e5f60718293a4b5' as UserId
const GELOESCHT = '6a1b2c3d4e5f60718293a4b6' as UserId

const aenderung = (userId: UserId): Change => ({
  id: `change-${userId}`,
  metadata: { user_id: userId, ts: new Date() },
  op: { p: 0, i: 'Text' },
})

describe('Review-Panel: Autor einer Änderung', function () {
  let abrufe: number

  beforeEach(function () {
    abrufe = 0
    fetchMock.removeRoutes().clearHistory()
    // Der Bot ist erst beim zweiten Abruf bekannt, so wie nach seiner ersten Änderung.
    fetchMock.get('express:/project/:projectId/changes/users', () => {
      abrufe++
      return abrufe === 1
        ? []
        : [{ id: BOT, first_name: 'Claude', last_name: 'Bot', email: 'claude@spur.invalid' }]
    })
  })

  afterEach(function () {
    fetchMock.removeRoutes().clearHistory()
  })

  it('lädt einen unbekannten Autor nach und zeigt seinen Namen', async function () {
    render(<ReviewPanelChangeUser change={aenderung(BOT)} />, { wrapper: EditorProviders })
    await screen.findByText('Claude Bot')
    expect(abrufe).to.equal(2)
  })

  it('fragt eine wirklich unbekannte ID nur einmal nach', async function () {
    render(<ReviewPanelChangeUser change={aenderung(GELOESCHT)} />, { wrapper: EditorProviders })
    await waitFor(() => expect(abrufe).to.equal(2))
    await new Promise(resolve => setTimeout(resolve, 50))
    expect(abrufe).to.equal(2)
    // Die Test-Umgebung lädt nicht alle Übersetzungen; dann steht der Schlüssel selbst da.
    expect(screen.getByText(/^(Deleted user|deleted_user)$/)).to.exist
  })
})
