import { expect } from 'chai'
import fetchMock from 'fetch-mock'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import QuelleVorschau from '@modules/spur/frontend/js/quellen/quelle-vorschau'
import type { Quelle } from '@modules/spur/frontend/js/quellen/typen'
import { EditorProviders } from '../../../../test/frontend/helpers/editor-providers'
import { deutschAktivieren } from './helpers/deutsch'

const SEITE = /\/spur\/project\/[^/]+\/quellen\/q1\/seiten\/(\d+)$/
const ZITATE = /\/spur\/project\/[^/]+\/quellen\/q1\/zitate$/
const NOTIZEN = /\/spur\/project\/[^/]+\/quellen\/q1\/notizen$/
const TEAM = /\/spur\/project\/[^/]+\/team$/

const quelle: Quelle = {
  id: 'q1',
  dateiname: 'smith2024.pdf',
  key: 'smith2024',
  art: 'pdf',
  seitenzahl: 3,
  status: 'text',
  doi: null,
  titel: null,
  fassung: '',
  versatz: null,
  versatzQuelle: null,
  ocr: null,
}

function zeigen() {
  render(<QuelleVorschau quelle={quelle} startSeite={1} schliessen={() => {}} />, {
    wrapper: EditorProviders,
  })
}

describe('Quelle groß öffnen', function () {
  deutschAktivieren()

  beforeEach(function () {
    fetchMock.removeRoutes().clearHistory()
    fetchMock.get(SEITE, ({ url }) => {
      const nr = Number(SEITE.exec(url)![1])
      return { text: `Text der Seite ${nr}.`, label: null, seite: nr, seitenzahl: 3, ocrKonfidenz: null }
    })
    fetchMock.get(ZITATE, { zitate: [] })
    fetchMock.get(NOTIZEN, { notizen: [] })
    fetchMock.get(TEAM, { ich: 'a', mitglieder: [] })
  })

  afterEach(function () {
    fetchMock.removeRoutes().clearHistory()
  })

  it('öffnet die große Ansicht mit Blättern und Zoom und gibt den Fokus zurück', async function () {
    zeigen()
    const oeffnen = await screen.findByRole('button', { name: 'Groß öffnen' })
    oeffnen.focus()
    fireEvent.click(oeffnen)
    const dialog = await screen.findByRole('dialog')
    const im = within(dialog)
    im.getByRole('heading', { name: 'smith2024.pdf' })
    await im.findByText('Seite 1 von 3')
    await im.findByText('Text der Seite 1.')
    expect(im.getByRole('button', { name: 'Vorherige Seite' })).to.have.property('disabled', true)

    fireEvent.click(im.getByRole('button', { name: 'Nächste Seite' }))
    await im.findByText('Text der Seite 2.')
    im.getByText('Seite 2 von 3')
    fireEvent.click(im.getByRole('button', { name: 'Vorherige Seite' }))
    await im.findByText('Text der Seite 1.')

    im.getByText('100 %')
    const groesser = im.getByRole('button', { name: 'Vergrößern' })
    const kleiner = im.getByRole('button', { name: 'Verkleinern' })
    fireEvent.click(groesser)
    im.getByText('125 %')
    fireEvent.click(groesser)
    im.getByText('150 %')
    fireEvent.click(kleiner)
    im.getByText('125 %')
    fireEvent.click(groesser)
    fireEvent.click(groesser)
    im.getByText('200 %')
    expect(groesser).to.have.property('disabled', true)
    for (let i = 0; i < 4; i++) fireEvent.click(kleiner)
    im.getByText('75 %')
    expect(kleiner).to.have.property('disabled', true)

    fireEvent.keyDown(dialog, { key: 'Escape', code: 'Escape', keyCode: 27 })
    await waitFor(() => expect(screen.queryByRole('dialog')).to.equal(null))
    await waitFor(() => expect(document.activeElement).to.equal(oeffnen))
  })

  it('schließt mit „Schließen“', async function () {
    zeigen()
    fireEvent.click(await screen.findByRole('button', { name: 'Groß öffnen' }))
    const dialog = await screen.findByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Schließen' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).to.equal(null))
  })
})
