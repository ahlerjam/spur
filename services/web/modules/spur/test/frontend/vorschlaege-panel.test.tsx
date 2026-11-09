import { expect } from 'chai'
import fetchMock from 'fetch-mock'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import VorschlaegePanel from '@modules/spur/frontend/js/vorschlaege/vorschlaege-panel'
import { EditorProviders } from '../../../../test/frontend/helpers/editor-providers'
import type { PermissionsLevel } from '@/features/ide-react/types/permissions'
import { deutschAktivieren } from './helpers/deutsch'

const STATUS = /\/spur\/project\/[^/]+\/vorschlaege$/
const EIGENE = /\/vorschlaege\/eigene$/
const UEBERNEHMEN = /\/vorschlaege\/v1\/uebernehmen$/
const VERWERFEN = /\/vorschlaege\/v1\/verwerfen$/

const leer = { compile_fehler: null, belegloses_argument: null }
const stand = (teil: object = {}) => ({
  eigene: leer,
  projekt: leer,
  wirksam: { compile_fehler: 'aus', belegloses_argument: 'aus' },
  limit: 50,
  heute: 0,
  limitErreicht: false,
  ...teil,
})
const VORSCHLAG = {
  id: 'v1',
  art: 'belegloses_argument',
  titel: 'Beleg fehlt',
  text: 'Für die Verdopplung fehlt eine Quelle.',
  pfad: 'main.tex',
  am: '2026-11-08T10:00:00Z',
}

function zeigen(permissionsLevel: PermissionsLevel = 'owner') {
  render(<VorschlaegePanel />, {
    wrapper: ({ children }) => <EditorProviders permissionsLevel={permissionsLevel}>{children}</EditorProviders>,
  })
}

describe('Vorschläge-Panel', function () {
  deutschAktivieren()

  beforeEach(function () {
    fetchMock.removeRoutes().clearHistory()
  })

  afterEach(function () {
    fetchMock.removeRoutes().clearHistory()
  })

  it('zeigt beide Schalter auf Aus und den Hinweis, dass Vorschläge aus sind', async function () {
    fetchMock.get(STATUS, { stand: stand(), vorschlaege: [] })
    zeigen()
    const compile = (await screen.findByLabelText('Compile-Fehler')) as HTMLSelectElement
    const argument = screen.getByLabelText('Belegloses Argument') as HTMLSelectElement
    expect(compile.selectedOptions[0].textContent).to.equal('Projekt: Aus')
    expect(argument.selectedOptions[0].textContent).to.equal('Projekt: Aus')
    screen.getByText('Vorschläge sind aus. Stell oben einen Auslöser auf „Vorschlag“.')
  })

  it('speichert die eigene Einstellung', async function () {
    fetchMock.get(STATUS, { stand: stand(), vorschlaege: [] })
    fetchMock.put(EIGENE, 204)
    zeigen()
    fireEvent.change(await screen.findByLabelText('Compile-Fehler'), { target: { value: 'vorschlag' } })
    await waitFor(() => expect(fetchMock.callHistory.called(EIGENE)).to.equal(true))
    const body = JSON.parse(String(fetchMock.callHistory.lastCall(EIGENE)?.options.body))
    expect(body).to.deep.equal({ art: 'compile_fehler', wert: 'vorschlag' })
  })

  it('zeigt den Projekt-Standard nur Schreibenden', async function () {
    fetchMock.get(STATUS, { stand: stand(), vorschlaege: [] })
    zeigen('readOnly')
    await screen.findByLabelText('Compile-Fehler')
    expect(screen.queryByText('Projekt-Standard für alle Mitglieder')).to.equal(null)
  })

  it('zeigt „Tageslimit erreicht“', async function () {
    fetchMock.get(STATUS, { stand: stand({ limit: 2, heute: 2, limitErreicht: true }), vorschlaege: [] })
    zeigen()
    await screen.findByText('Tageslimit erreicht')
  })

  it('zeigt Vorschläge als Karten und übernimmt einen', async function () {
    let offen = [VORSCHLAG]
    fetchMock.get(STATUS, () => ({
      stand: stand({ wirksam: { compile_fehler: 'aus', belegloses_argument: 'vorschlag' } }),
      vorschlaege: offen,
    }))
    fetchMock.post(UEBERNEHMEN, () => {
      offen = []
      return 204
    })
    zeigen()
    await screen.findByRole('heading', { name: 'Beleg fehlt' })
    screen.getByText('Für die Verdopplung fehlt eine Quelle.')
    fireEvent.click(screen.getByRole('button', { name: 'Übernehmen' }))
    await screen.findByText('Claude hat den Auftrag. Den Lauf siehst du im Claude-Panel.')
    await waitFor(() => expect(screen.queryByRole('heading', { name: 'Beleg fehlt' })).to.equal(null))
    expect(document.activeElement?.textContent).to.equal('Offene Vorschläge (0)')
  })

  it('verwirft einen Vorschlag', async function () {
    let offen = [VORSCHLAG]
    fetchMock.get(STATUS, () => ({ stand: stand(), vorschlaege: offen }))
    fetchMock.post(VERWERFEN, () => {
      offen = []
      return 204
    })
    zeigen()
    fireEvent.click(await screen.findByRole('button', { name: 'Verwerfen' }))
    await waitFor(() => expect(screen.queryByText('Beleg fehlt')).to.equal(null))
    expect(fetchMock.callHistory.called(UEBERNEHMEN)).to.equal(false)
  })
})
