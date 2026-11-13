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
const TEXTEBENE = /\/spur\/project\/[^/]+\/quellen\/q1\/seiten\/\d+\/textebene$/

const quelle: Quelle = {
  id: 'q1',
  dateiname: 'smith2024.pdf',
  key: 'smith2024',
  art: 'pdf',
  seitenzahl: 3,
  status: 'text',
  doi: null,
  titel: null,
  autoren: [],
  jahr: null,
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
    fetchMock.get(TEXTEBENE, { breite: 612, hoehe: 792, zeilen: [] })
    window.localStorage.clear()
  })

  afterEach(function () {
    fetchMock.removeRoutes().clearHistory()
  })

  it('hat Zurück, Blättern und Groß öffnen in der Werkzeugleiste als gleichartige Knöpfe', async function () {
    zeigen()
    await screen.findByRole('button', { name: 'Groß öffnen' })
    const leiste = document.querySelector('.spur-panel-werkzeuge') as HTMLElement
    const knoepfe = ['Zurück', 'Vorherige Seite', 'Nächste Seite', 'Groß öffnen'].map(name =>
      within(leiste).getByRole('button', { name })
    )
    expect(new Set(knoepfe.map(k => k.className)).size).to.equal(1)
  })

  it('öffnet die große Ansicht mit Blättern, Zoom und Tasten und gibt den Fokus zurück', async function () {
    zeigen()
    const oeffnen = await screen.findByRole('button', { name: 'Groß öffnen' })
    oeffnen.focus()
    fireEvent.click(oeffnen)
    const dialog = await screen.findByRole('dialog')
    const im = within(dialog)
    im.getByRole('heading', { name: 'smith2024.pdf' })
    // Nur eine Zitatliste: die der Vorschau ruht, solange die große Ansicht offen ist.
    await im.findByText('Gespeicherte Zitate')
    expect(screen.getAllByText('Gespeicherte Zitate')).to.have.length(1)
    // Der Seitentext steht nicht als zweite Kopie neben dem Bild.
    expect(im.queryByText('Text der Seite 1.')).to.equal(null)
    await im.findByText('Seite 1 von 3')
    expect(im.getByRole('button', { name: 'Vorherige Seite' })).to.have.property('disabled', true)

    fireEvent.click(im.getByRole('button', { name: 'Nächste Seite' }))
    await im.findByText('Seite 2 von 3')
    fireEvent.keyDown(document.body, { key: 'ArrowRight' })
    await im.findByText('Seite 3 von 3')
    fireEvent.keyDown(document.body, { key: 'ArrowLeft' })
    await im.findByText('Seite 2 von 3')

    im.getByText('100 %')
    const groesser = im.getByRole('button', { name: 'Vergrößern' })
    const kleiner = im.getByRole('button', { name: 'Verkleinern' })
    fireEvent.click(groesser)
    im.getByText('125 %')
    fireEvent.keyDown(document.body, { key: '+' })
    im.getByText('150 %')
    fireEvent.keyDown(document.body, { key: '-' })
    im.getByText('125 %')
    for (let i = 0; i < 5; i++) fireEvent.click(groesser)
    im.getByText('300 %')
    expect(groesser).to.have.property('disabled', true)
    fireEvent.click(im.getByRole('button', { name: 'An Breite anpassen' }))
    im.getByText('100 %')
    for (let i = 0; i < 2; i++) fireEvent.click(kleiner)
    im.getByText('50 %')
    expect(kleiner).to.have.property('disabled', true)
    fireEvent.keyDown(document.body, { key: '0' })
    im.getByText('100 %')

    expect(im.getByRole('link', { name: /Original herunterladen/ }).getAttribute('href')).to.match(/\/quellen\/q1\/datei$/)

    fireEvent.keyDown(dialog, { key: 'Escape', code: 'Escape', keyCode: 27 })
    await waitFor(() => expect(screen.queryByRole('dialog')).to.equal(null))
    await waitFor(() => expect(document.activeElement).to.equal(oeffnen))
    // Die Vorschau steht danach auf derselben Seite.
    await screen.findByText('Seite 2 von 3')
  })

  it('merkt sich die eingeklappte Seitenleiste', async function () {
    zeigen()
    fireEvent.click(await screen.findByRole('button', { name: 'Groß öffnen' }))
    let dialog = await screen.findByRole('dialog')
    const knopf = within(dialog).getByRole('button', { name: 'Seitenleiste ausblenden' })
    expect(knopf.getAttribute('aria-expanded')).to.equal('true')
    fireEvent.click(knopf)
    expect(document.getElementById('spur-gross-leiste')!.hidden).to.equal(true)
    fireEvent.click(within(dialog).getByRole('button', { name: 'Schließen' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).to.equal(null))
    fireEvent.click(screen.getByRole('button', { name: 'Groß öffnen' }))
    dialog = await screen.findByRole('dialog')
    within(dialog).getByRole('button', { name: 'Seitenleiste einblenden' })
    expect(document.getElementById('spur-gross-leiste')!.hidden).to.equal(true)
  })

  it('schließt mit „Schließen“', async function () {
    zeigen()
    fireEvent.click(await screen.findByRole('button', { name: 'Groß öffnen' }))
    const dialog = await screen.findByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Schließen' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).to.equal(null))
  })
})
