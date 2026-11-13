import { expect } from 'chai'
import fetchMock from 'fetch-mock'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import LaufKarte, { type Lauf } from '@modules/spur/frontend/js/claude/lauf-karte'
import { deutschAktivieren } from './helpers/deutsch'
import { EditorProviders } from '../../../../test/frontend/helpers/editor-providers'
import type { PermissionsLevel } from '@/features/ide-react/types/permissions'
import type { FC, PropsWithChildren } from 'react'

const lauf: Lauf = {
  id: 'lauf-1',
  status: 'fertig',
  gestartet: '2026-11-08T10:00:00Z',
  dateien: 1,
  aenderungen: 1,
  rot: [],
  zahlen: [],
  zusammenfassung: 'Einleitung überarbeitet',
}

const aenderungen = [
  {
    id: 'a1',
    docId: 'd1',
    pfad: 'main.tex',
    zeile: 3,
    art: 'einfuegung' as const,
    text: 'Neuer Satz.',
  },
]

const mitRolle =
  (permissionsLevel: PermissionsLevel): FC<PropsWithChildren> =>
  ({ children }) => (
    // Ohne Track Changes gäbe Overleaf der Review-Rolle kein trackedWrite; spur setzt es voraus.
    <EditorProviders
      permissionsLevel={permissionsLevel}
      projectFeatures={{ trackChanges: true }}
    >
      {children}
    </EditorProviders>
  )

function zeigen(rolle: PermissionsLevel) {
  render(
    <LaufKarte
      lauf={lauf}
      aenderungen={aenderungen}
      neuLaden={async () => {}}
    />,
    { wrapper: mitRolle(rolle) }
  )
}

describe('Lauf-Karte', function () {
  deutschAktivieren()

  it('zeigt Owner „Alle annehmen“ und „Lauf ablehnen“', function () {
    zeigen('owner')
    expect(screen.getByRole('button', { name: 'Alle annehmen' })).to.exist
    expect(screen.getByRole('button', { name: 'Lauf ablehnen' })).to.exist
  })

  it('zeigt der Review-Rolle kein „Annehmen“, aber „Lauf ablehnen“', function () {
    zeigen('review')
    expect(screen.queryByRole('button', { name: 'Annehmen' })).to.not.exist
    expect(screen.queryByRole('button', { name: 'Alle annehmen' })).to.not
      .exist
    expect(screen.getByRole('button', { name: 'Lauf ablehnen' })).to.exist
  })

  it('zeigt Lesenden keine Schaltflächen zum Entscheiden', function () {
    zeigen('readOnly')
    expect(screen.getAllByRole('button').map(b => b.getAttribute('aria-expanded'))).to.deep.equal(['true'])
  })

  it('warnt bei Zahlen ohne Beleg', function () {
    render(
      <LaufKarte
        lauf={{ ...lauf, zahlen: [{ zahl: '412', pfad: 'main.tex' }] }}
        aenderungen={aenderungen}
          neuLaden={async () => {}}
      />,
      { wrapper: mitRolle('owner') }
    )
    expect(screen.getByText('Zahl ohne Beleg: 412')).to.exist
  })

  it('zeigt ohne Zahlen keine Warnung', function () {
    zeigen('owner')
    expect(screen.queryByText(/^Zahl ohne Beleg/)).to.not.exist
  })

  it('listet angelegte Dateien und bietet „Lauf rückgängig“ auch vor dem Annehmen', function () {
    render(
      <LaufKarte
        lauf={{ ...lauf, aenderungen: 0, angelegt: [{ art: 'ordner', pfad: 'tex-pakete/foo' }, { art: 'datei', pfad: 'latexmkrc' }] }}
        aenderungen={[]}
          neuLaden={async () => {}}
      />,
      { wrapper: mitRolle('owner') }
    )
    expect(screen.getByText('tex-pakete/foo')).to.exist
    expect(screen.getByText('latexmkrc')).to.exist
    expect(screen.getByRole('button', { name: 'Lauf rückgängig' })).to.exist
  })

  it('zeigt Lesenden „Lauf rückgängig“ nicht', function () {
    render(
      <LaufKarte
        lauf={{ ...lauf, angelegt: [{ art: 'datei', pfad: 'latexmkrc' }] }}
        aenderungen={[]}
          neuLaden={async () => {}}
      />,
      { wrapper: mitRolle('readOnly') }
    )
    expect(screen.queryByRole('button', { name: 'Lauf rückgängig' })).to.not.exist
  })

  it('stellt rote Zitate unter „Bitte prüfen“ an den Anfang und nennt automatisch Angenommenes', function () {
    render(
      <LaufKarte
        lauf={{
          ...lauf,
          status: 'offen',
          rotAenderungen: ['rot'],
          automatisch: [{ pfad: 'main.tex', zeile: 2, art: 'einfuegung', text: 'Von 240 Befragten antworteten 90.' }],
        }}
        aenderungen={[...aenderungen, { ...aenderungen[0], id: 'rot', text: '\\footfullcite{smith2024}' }]}
        neuLaden={async () => {}}
      />,
      { wrapper: mitRolle('owner') }
    )
    const texte = [...document.querySelectorAll('.spur-lauf-aenderung .spur-nachricht-text')].map(e => e.textContent)
    expect(texte).to.deep.equal(['\\footfullcite{smith2024}', 'Neuer Satz.', 'Von 240 Befragten antworteten 90.'])
    expect(screen.getByText('Bitte prüfen')).to.exist
    expect(screen.getByText('Automatisch angenommen')).to.exist
    expect(screen.getByRole('button', { name: 'Lauf rückgängig' })).to.exist
  })

  it('zeigt eingeklappt Status und Zahl offener Änderungen und klappt auf', function () {
    render(<LaufKarte lauf={lauf} aenderungen={aenderungen} neuLaden={async () => {}} aufgeklappt={false} />, {
      wrapper: mitRolle('owner'),
    })
    const kopf = screen.getByRole('button', { name: /^Lauf/ })
    expect(kopf.textContent).to.contain('Fertig')
    expect(kopf.textContent).to.contain('1 offen')
    expect(screen.queryByRole('button', { name: 'Alle annehmen' })).to.not.exist
    fireEvent.click(kopf)
    expect(screen.getByRole('button', { name: 'Alle annehmen' })).to.exist
  })

  describe('mit rotem Zitat', function () {
    const rotLauf: Lauf = { ...lauf, rotAenderungen: ['a2'] }
    const beide = [...aenderungen, { ...aenderungen[0], id: 'a2', text: '\\parencite{unbekannt}' }]
    let anfragen: unknown[]

    beforeEach(function () {
      anfragen = []
      fetchMock.removeRoutes().clearHistory()
      fetchMock.post(/\/laeufe\/lauf-1\/annehmen$/, (call: { options: { body?: unknown } }) => {
        anfragen.push(JSON.parse(String(call.options.body ?? 'null')))
        return {}
      })
    })
    afterEach(function () {
      fetchMock.removeRoutes().clearHistory()
    })

    const zeigenRot = (daten = beide) =>
      render(<LaufKarte lauf={rotLauf} aenderungen={daten} neuLaden={async () => {}} />, { wrapper: mitRolle('owner') })

    it('fragt vor „Alle annehmen“ nach; „Nur die anderen“ hat den Fokus und lässt das rote Zitat offen', async function () {
      zeigenRot()
      const alle = screen.getByRole('button', { name: 'Alle annehmen' })
      alle.focus()
      fireEvent.click(alle)
      const dialog = await screen.findByRole('dialog')
      within(dialog).getByText('1 rotes Zitat mit annehmen?')
      const nurAndere = within(dialog).getByRole('button', { name: 'Nur die anderen' })
      await waitFor(() => expect(document.activeElement).to.equal(nurAndere))
      fireEvent.click(nurAndere)
      await waitFor(() => expect(anfragen).to.deep.equal([{ change_ids: ['a1'] }]))
    })

    it('nimmt mit „Alle annehmen“ im Dialog auch das rote Zitat an', async function () {
      zeigenRot()
      fireEvent.click(screen.getByRole('button', { name: 'Alle annehmen' }))
      fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Alle annehmen' }))
      await waitFor(() => expect(anfragen).to.deep.equal([null]))
    })

    it('schließt mit Esc, ohne etwas anzunehmen, und gibt den Fokus zurück', async function () {
      zeigenRot()
      const alle = screen.getByRole('button', { name: 'Alle annehmen' })
      alle.focus()
      fireEvent.click(alle)
      await screen.findByRole('dialog')
      fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape', code: 'Escape', keyCode: 27 })
      await waitFor(() => expect(screen.queryByRole('dialog')).to.equal(null))
      await waitFor(() => expect(document.activeElement).to.equal(alle))
      expect(anfragen).to.deep.equal([])
    })

    it('lässt den Dialog nach einem Fehler offen', async function () {
      fetchMock.removeRoutes().post(/\/laeufe\/lauf-1\/annehmen$/, { status: 500, body: { fehler: 'kaputt' } })
      zeigenRot()
      fireEvent.click(screen.getByRole('button', { name: 'Alle annehmen' }))
      fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Nur die anderen' }))
      await waitFor(() => expect(fetchMock.callHistory.calls().length).to.be.greaterThan(0))
      await new Promise(resolve => setTimeout(resolve, 100))
      expect(screen.queryByRole('dialog')).to.exist
    })

    it('nimmt ohne rote Zitate ohne Dialog an', async function () {
      render(<LaufKarte lauf={lauf} aenderungen={aenderungen} neuLaden={async () => {}} />, { wrapper: mitRolle('owner') })
      fireEvent.click(screen.getByRole('button', { name: 'Alle annehmen' }))
      await waitFor(() => expect(anfragen).to.deep.equal([{ change_ids: ['a1'] }]))
      expect(screen.queryByRole('dialog')).to.equal(null)
    })
  })
})
