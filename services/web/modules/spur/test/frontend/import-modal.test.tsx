import { expect } from 'chai'
import fetchMock from 'fetch-mock'
import sinon from 'sinon'
import { fireEvent, render, screen, within } from '@testing-library/react'
import ImportModal from '@modules/spur/frontend/js/quellen/import-modal'
import { EditorProviders } from '../../../../test/frontend/helpers/editor-providers'
import { deutschAktivieren } from './helpers/deutsch'

const ZOTERO = /\/import\/zotero$/
const QUELLEN = /\/spur\/project\/[^/]+\/quellen$/
const pdf = (name: string) => new File(['%PDF-'], name, { type: 'application/pdf' })

function zeigen(importiert = sinon.stub()) {
  render(<ImportModal schliessen={() => {}} importiert={importiert} />, { wrapper: EditorProviders })
  return importiert
}

describe('Import-Dialog', function () {
  deutschAktivieren()

  beforeEach(function () {
    fetchMock.removeRoutes().clearHistory()
  })

  afterEach(function () {
    fetchMock.removeRoutes().clearHistory()
  })

  it('importiert eine Zotero-Sammlung und nennt neue und vorhandene Keys', async function () {
    fetchMock.get(ZOTERO, { sammlungen: [{ key: 'ABCD2345', name: 'Schlaf' }] })
    fetchMock.post(ZOTERO, { neu: ['diekelmann_memory_2010'], vorhanden: ['keller_spindles_2014'] })
    const importiert = zeigen()
    fireEvent.click(await screen.findByRole('button', { name: 'Aus Zotero importieren' }))
    await screen.findByText('Neu in der .bib: 1 · Schon vorhanden: 1')
    screen.getByText('diekelmann_memory_2010')
    const body = fetchMock.callHistory.lastCall(ZOTERO)?.options.body
    expect(JSON.parse(String(body))).to.deep.equal({ sammlung: 'ABCD2345' })
    expect(importiert.calledOnce).to.equal(true)
  })

  it('zeigt, wenn Zotero nicht verbunden ist', async function () {
    fetchMock.get(ZOTERO, { status: 409, body: { detail: 'Zotero ist nicht verbunden.' } })
    zeigen()
    await screen.findByText('Zotero ist nicht verbunden.')
  })

  it('lädt mehrere PDFs nacheinander und benennt Fehlschläge einzeln', async function () {
    fetchMock.get(ZOTERO, { sammlungen: [] })
    let aufruf = 0
    fetchMock.post(QUELLEN, () =>
      [
        { status: 201, body: {} },
        { status: 409, body: { detail: 'schon da' } },
        { status: 415, body: { detail: 'Dieser Dateityp wird nicht unterstützt.' } },
      ][aufruf++]
    )
    const importiert = zeigen()
    fireEvent.change(screen.getByLabelText('PDFs wählen (mehrere möglich)'), {
      target: { files: [pdf('a.pdf'), pdf('b.pdf'), pdf('c.txt')] },
    })
    await screen.findByText('Dieser Dateityp wird nicht unterstützt.')
    const zeilen = screen.getAllByRole('listitem')
    expect(within(zeilen[0]).getByText('aufgenommen')).to.exist
    expect(within(zeilen[1]).getByText('schon vorhanden')).to.exist
    expect(zeilen[2].className).to.contain('spur-import-fehler')
    expect(importiert.calledOnce).to.equal(true)
  })
})
