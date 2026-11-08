import { expect } from 'chai'
import { render, screen } from '@testing-library/react'
import LaufKarte, { type Lauf } from '@modules/spur/frontend/js/claude/lauf-karte'
import { deutschAktivieren } from './helpers/deutsch'
import { EditorProviders } from '../../../../test/frontend/helpers/editor-providers'
import type { PermissionsLevel } from '@/features/ide-react/types/permissions'
import type { FC, PropsWithChildren } from 'react'

const lauf: Lauf = {
  id: 'lauf-1',
  status: 'fertig',
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
      automatik={false}
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
    expect(screen.queryByRole('button')).to.not.exist
  })

  it('warnt bei Zahlen ohne Beleg', function () {
    render(
      <LaufKarte
        lauf={{ ...lauf, zahlen: [{ zahl: '412', pfad: 'main.tex' }] }}
        aenderungen={aenderungen}
        automatik={false}
        neuLaden={async () => {}}
      />,
      { wrapper: mitRolle('owner') }
    )
    expect(screen.getByText('Zahl ohne Beleg')).to.exist
    expect(screen.getByText('„412“ in main.tex: Bitte als Makro aus ergebnisse.tex einsetzen.')).to.exist
  })

  it('zeigt ohne Zahlen keine Warnung', function () {
    zeigen('owner')
    expect(screen.queryByText('Zahl ohne Beleg')).to.not.exist
  })
})
