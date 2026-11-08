import { expect } from 'chai'
import fetchMock from 'fetch-mock'
import { fireEvent, render, screen, within } from '@testing-library/react'
import MatrixModal from '@modules/spur/frontend/js/literatur/matrix-modal'
import NotizFeld from '@modules/spur/frontend/js/quellen/notiz-feld'
import { EditorProviders } from '../../../../test/frontend/helpers/editor-providers'
import { deutschAktivieren } from './helpers/deutsch'

const MATRIX = /\/matrix\?seite=/
const zeile = (i: number, zelle = { text: '', vorschlag: null as { text: string } | null }) => ({
  quelle: { id: `q${i}`, dateiname: `quelle-${i}.pdf`, key: `q${i}` },
  zellen: { s1: zelle },
})

describe('Literaturmatrix', function () {
  deutschAktivieren()

  beforeEach(function () {
    fetchMock.removeRoutes().clearHistory()
  })

  afterEach(function () {
    fetchMock.removeRoutes().clearHistory()
  })

  it('zeigt Quellen als Zeilen, Spalten und die Zeilenspanne', async function () {
    fetchMock.get(MATRIX, {
      spalten: [{ id: 's1', name: 'Methode' }],
      zeilen: Array.from({ length: 50 }, (_, i) => zeile(i)),
      gesamt: 300,
      seite: 1,
      proSeite: 50,
    })
    render(<MatrixModal schliessen={() => {}} />, { wrapper: EditorProviders })
    await screen.findByText('Zeilen 1–50 von 300')
    screen.getByRole('columnheader', { name: 'Methode' })
    expect(screen.getAllByRole('rowheader')).to.have.length(50)
    fireEvent.click(screen.getByRole('button', { name: 'Nächste Seite' }))
    await new Promise(r => setTimeout(r, 0))
    expect(fetchMock.callHistory.lastCall(MATRIX)?.url).to.match(/seite=2$/)
  })

  it('übernimmt einen Vorschlag erst auf Klick', async function () {
    fetchMock.get(MATRIX, {
      spalten: [{ id: 's1', name: 'Methode' }],
      zeilen: [zeile(1, { text: '', vorschlag: { text: 'Längsschnitt' } })],
      gesamt: 1,
      seite: 1,
      proSeite: 50,
    })
    fetchMock.post(/\/matrix\/zellen\/bestaetigen$/, 204)
    render(<MatrixModal schliessen={() => {}} />, { wrapper: EditorProviders })
    const zelle = (await screen.findByText('Längsschnitt')).closest('td')!
    expect(within(zelle).getByRole('textbox')).to.have.property('value', '')
    fireEvent.click(within(zelle).getByRole('button', { name: 'Übernehmen' }))
    await new Promise(r => setTimeout(r, 0))
    const body = fetchMock.callHistory.lastCall(/bestaetigen$/)?.options.body
    expect(JSON.parse(String(body))).to.deep.equal({ quelle_id: 'q1', spalte_id: 's1' })
  })

  it('zeigt eine leere Matrix ohne Quellen', async function () {
    fetchMock.get(MATRIX, { spalten: [], zeilen: [], gesamt: 0, seite: 1, proSeite: 50 })
    render(<MatrixModal schliessen={() => {}} />, { wrapper: EditorProviders })
    await screen.findByText('Noch keine Quellen: Die Matrix zeigt jede Quelle des Projekts als Zeile.')
  })
})

describe('Notizfeld', function () {
  deutschAktivieren()

  afterEach(function () {
    fetchMock.removeRoutes().clearHistory()
  })

  it('speichert die Notiz zu einem Zitat', async function () {
    fetchMock.put(/\/quellen\/q1\/notizen$/, 204)
    render(<NotizFeld quelleId="q1" zitatId="z1" label="Notiz zum Zitat" gespeichert="" darfSchreiben />, {
      wrapper: EditorProviders,
    })
    fireEvent.change(screen.getByLabelText('Notiz zum Zitat'), { target: { value: 'Kern' } })
    fireEvent.click(screen.getByRole('button', { name: 'Notiz speichern' }))
    await screen.findByText('Gespeichert')
    const body = fetchMock.callHistory.lastCall()?.options.body
    expect(JSON.parse(String(body))).to.deep.equal({ zitat_id: 'z1', text: 'Kern' })
  })
})
