import { expect } from 'chai'
import { render, screen } from '@testing-library/react'
import LaufKarte, { type Lauf } from '@modules/spur/frontend/js/claude/lauf-karte'
import { deutschAktivieren } from './helpers/deutsch'
import { mitRolle } from './helpers/berechtigungen'

const lauf: Lauf = {
  id: 'lauf-1',
  status: 'fertig',
  dateien: 1,
  aenderungen: 1,
  rot: [],
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

function zeigen(rolle: 'owner' | 'review' | 'lesen') {
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
    zeigen('lesen')
    expect(screen.queryByRole('button')).to.not.exist
  })
})
