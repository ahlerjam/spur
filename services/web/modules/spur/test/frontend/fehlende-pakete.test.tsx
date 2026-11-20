import { expect } from 'chai'
import fetchMock from 'fetch-mock'
import { render, screen, waitFor } from '@testing-library/react'
import { FehlendePaketeZeilen } from '@modules/spur/frontend/js/kompilieren/fehlende-pakete'
import { deutschAktivieren } from './helpers/deutsch'

const FEHLEND = /\/spur\/project\/[^/]+\/tex-pakete\/fehlend\?/
const LOG = "(./main.tex\n! LaTeX Error: File `spurdemo.sty' not found.\n\nType X to quit or <RETURN> to proceed,\n! LaTeX Error: File `gibtesnicht.sty' not found."

describe('Fehlende Pakete über dem Log', function () {
  deutschAktivieren()

  beforeEach(function () {
    window.metaAttributesCache.set('ol-project_id', 'p1')
    fetchMock.removeRoutes().clearHistory()
  })

  afterEach(function () {
    fetchMock.removeRoutes().clearHistory()
  })

  it('nennt je fehlender Datei das Paket oder nur die Datei', async function () {
    fetchMock.get(FEHLEND, {
      fehlende_pakete: [
        { datei: 'spurdemo.sty', paket: 'spurdemo', im_image: false },
        { datei: 'gibtesnicht.sty', paket: null, im_image: false },
      ],
    })
    render(<FehlendePaketeZeilen rawLog={LOG} />)
    await screen.findByText('Fehlendes Paket: spurdemo (für spurdemo.sty)')
    screen.getByText('Fehlende Datei: gibtesnicht.sty')
    const url = new URL(String(fetchMock.callHistory.lastCall(FEHLEND)?.url), 'http://x')
    expect(url.pathname).to.equal('/spur/project/p1/tex-pakete/fehlend')
    expect(url.searchParams.getAll('datei')).to.deep.equal(['spurdemo.sty', 'gibtesnicht.sty'])
  })

  it('zeigt nichts und fragt nicht, wenn keine Datei fehlt', async function () {
    const { container } = render(<FehlendePaketeZeilen rawLog="! Undefined control sequence." />)
    expect(container.textContent).to.equal('')
    expect(fetchMock.callHistory.called(FEHLEND)).to.equal(false)
  })

  it('nennt die Dateien auch, wenn der Server nicht antwortet', async function () {
    fetchMock.get(FEHLEND, 500)
    render(<FehlendePaketeZeilen rawLog={LOG} />)
    await waitFor(() => expect(fetchMock.callHistory.called(FEHLEND)).to.equal(true))
    screen.getByText('Fehlende Datei: spurdemo.sty')
    screen.getByText('Fehlende Datei: gibtesnicht.sty')
  })

  it('verschwindet nach einem Log ohne fehlende Datei', async function () {
    fetchMock.get(FEHLEND, { fehlende_pakete: [{ datei: 'spurdemo.sty', paket: 'spurdemo', im_image: false }] })
    const { rerender, container } = render(<FehlendePaketeZeilen rawLog="! LaTeX Error: File `spurdemo.sty' not found." />)
    await screen.findByText('Fehlendes Paket: spurdemo (für spurdemo.sty)')
    rerender(<FehlendePaketeZeilen rawLog="Output written on output.pdf (1 page)." />)
    await waitFor(() => expect(container.textContent).to.equal(''))
  })
})
