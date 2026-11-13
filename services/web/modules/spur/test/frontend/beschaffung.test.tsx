import { expect } from 'chai'
import fetchMock from 'fetch-mock'
import { fireEvent, render, screen } from '@testing-library/react'
import Beschaffung from '@modules/spur/frontend/js/recherche/beschaffung'
import { EditorProviders } from '../../../../test/frontend/helpers/editor-providers'
import { deutschAktivieren } from './helpers/deutsch'

const LISTE = /\/beschaffung\?seite=/
const OFFEN = {
  id: 'b1',
  doi: '10.5555/spur.2024.001',
  titel: 'Sleep and Memory',
  autoren: ['Alice Smith'],
  jahr: 2024,
  status: 'offen',
  link: 'https://bibliothek.example/?doi=10.5555/spur.2024.001',
}
const liste = (eintraege: object[], offen = 0, beschafft = 0) => ({
  eintraege,
  offen,
  beschafft,
  weiter: false,
  vorlage: 'https://bibliothek.example/?doi={doi}',
})

function zeigen() {
  render(<Beschaffung />, { wrapper: EditorProviders })
}

describe('Beschaffungsliste', function () {
  deutschAktivieren()

  beforeEach(function () {
    fetchMock.removeRoutes().clearHistory()
  })

  afterEach(function () {
    fetchMock.removeRoutes().clearHistory()
  })

  it('zeigt eine leere Liste', async function () {
    fetchMock.get(LISTE, liste([]))
    zeigen()
    await screen.findByText('Die Beschaffungsliste ist leer.', { exact: false })
  })

  it('zeigt offene und beschaffte Einträge mit Bibliothekslink', async function () {
    fetchMock.get(LISTE, liste([OFFEN, { ...OFFEN, id: 'b2', titel: 'Zweites', status: 'beschafft' }], 1, 1))
    zeigen()
    await screen.findByText('Offen: 1 · Beschafft: 1')
    screen.getByText('Offen')
    screen.getByText('Beschafft')
    const links = screen.getAllByRole('link', { name: 'In der Bibliothek holen' })
    expect(links).to.have.length(1)
    expect(links[0].getAttribute('href')).to.equal(OFFEN.link)
    expect(screen.getByLabelText('Link zur Bibliothek')).to.have.property('value', 'https://bibliothek.example/?doi={doi}')
    fireEvent.click(screen.getByRole('button', { name: 'Liste exportieren' }))
    expect(screen.getByRole('menuitem', { name: 'Als .ris exportieren' }).getAttribute('href')).to.match(/\/beschaffung\/export\/ris$/)
  })

  it('fragt nach dem Eintrag, wenn das hochgeladene PDF keine DOI trägt', async function () {
    fetchMock.get(LISTE, liste([OFFEN], 1))
    fetchMock.post(/\/beschaffung\/hochladen$/, { status: 201, body: { quelle: { id: 'q1', dateiname: 'scan.pdf' }, zugeordnet: null } })
    fetchMock.post(/\/beschaffung\/b1\/zuordnen$/, { ...OFFEN, status: 'beschafft' })
    zeigen()
    const feld = await screen.findByLabelText('Beschafftes PDF wählen')
    fireEvent.change(feld, { target: { files: [new File(['%PDF-'], 'scan.pdf', { type: 'application/pdf' })] } })
    await screen.findByText('In „scan.pdf“ steht keine bekannte DOI. Zu welchem Eintrag gehört das PDF?')
    fireEvent.change(screen.getByLabelText('Eintrag'), { target: { value: 'b1' } })
    fireEvent.click(screen.getByRole('button', { name: 'Zuordnen' }))
    await screen.findByText('„scan.pdf“ ist zugeordnet: beschafft')
    const body = fetchMock.callHistory.lastCall(/zuordnen$/)?.options.body
    expect(JSON.parse(String(body))).to.deep.equal({ quelle_id: 'q1' })
  })

  it('zeigt die Fehlermeldung einer ungültigen Vorlage', async function () {
    fetchMock.get(LISTE, liste([]))
    fetchMock.put('/spur/beschaffung/vorlage', { status: 400, body: { detail: 'Die Vorlage braucht eine http- oder https-Adresse mit {doi}.' } })
    zeigen()
    fireEvent.change(await screen.findByLabelText('Link zur Bibliothek'), { target: { value: 'ftp://x' } })
    fireEvent.click(screen.getByRole('button', { name: 'Speichern' }))
    await screen.findByText('Die Vorlage braucht eine http- oder https-Adresse mit {doi}.')
  })
})
