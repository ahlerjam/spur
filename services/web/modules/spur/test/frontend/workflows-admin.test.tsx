import { expect } from 'chai'
import fetchMock from 'fetch-mock'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import WorkflowsAdmin from '@modules/spur/frontend/js/workflows/workflows-admin'
import { deutschAktivieren } from './helpers/deutsch'

const LISTE = /\/spur\/admin\/workflows\.json$/
const FOLIEN = /\/spur\/admin\/workflows\/folien$/

const workflow = (name: string, titel: string, teil: object = {}) => ({
  name,
  titel,
  beschreibung: `${titel} beschreiben`,
  text: `Text ${titel}`,
  angepasst: false,
  ...teil,
})

describe('Workflows im Admin-Bereich', function () {
  deutschAktivieren()

  beforeEach(function () {
    fetchMock.removeRoutes().clearHistory()
  })

  afterEach(function () {
    fetchMock.removeRoutes().clearHistory()
  })

  it('zeigt die vier Workflows mit ihrem Text und speichert eine Änderung', async function () {
    let folien = workflow('folien', 'Folien aus Paper')
    fetchMock.get(LISTE, () => ({
      workflows: [
        workflow('literaturueberblick', 'Literaturüberblick'),
        workflow('methodenteil', 'Methodenteil'),
        folien,
        workflow('quellen_sammeln', 'Quellen sammeln'),
      ],
    }))
    fetchMock.put(FOLIEN, ({ options }) => {
      folien = { ...folien, text: JSON.parse(String(options.body)).text, angepasst: true }
      return 204
    })
    render(<WorkflowsAdmin />)
    const feld = (await screen.findByLabelText('Text für „Folien aus Paper“')) as HTMLTextAreaElement
    expect(feld.value).to.equal('Text Folien aus Paper')
    screen.getByText('/plugin:spur:spur:folien')
    screen.getByLabelText('Text für „Literaturüberblick“')
    screen.getByLabelText('Text für „Methodenteil“')
    fireEvent.change(feld, { target: { value: 'Zehn Folien, nicht mehr.' } })
    fireEvent.click(screen.getAllByRole('button', { name: 'Speichern' })[2])
    await screen.findByText('Gespeichert. Der neue Text gilt ab sofort.')
    await waitFor(() => screen.getByText('Angepasst'))
    screen.getByRole('button', { name: 'Standard wiederherstellen' })
  })

  it('nennt einen Fehler beim Speichern im Klartext', async function () {
    fetchMock.get(LISTE, { workflows: [workflow('folien', 'Folien aus Paper')] })
    fetchMock.put(FOLIEN, {
      status: 422,
      headers: { 'Content-Type': 'application/problem+json' },
      body: { detail: 'Der Text muss 1 bis 20000 Zeichen haben.' },
    })
    render(<WorkflowsAdmin />)
    fireEvent.click(await screen.findByRole('button', { name: 'Speichern' }))
    await screen.findByText('Der Text muss 1 bis 20000 Zeichen haben.')
  })
})
