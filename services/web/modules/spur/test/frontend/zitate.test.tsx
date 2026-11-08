import { expect } from 'chai'
import fetchMock from 'fetch-mock'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { SocketIOMock } from '@/ide/connection/SocketIoShim'
import type { Socket } from '@/features/ide-react/connection/types/socket'
import Zitate from '@modules/spur/frontend/js/quellen/zitate'
import type { Quelle, Zitat } from '@modules/spur/frontend/js/quellen/typen'
import { EditorProviders } from '../../../../test/frontend/helpers/editor-providers'
import { deutschAktivieren } from './helpers/deutsch'

const ICH = 'aaaaaaaaaaaaaaaaaaaaaaaa'
const BEN = 'bbbbbbbbbbbbbbbbbbbbbbbb'
const ZITATE = /\/spur\/project\/[^/]+\/quellen\/q1\/zitate$/
const KOMMENTARE = /\/spur\/project\/[^/]+\/quellen\/q1\/zitate\/z2\/kommentare$/
const TEAM = /\/spur\/project\/[^/]+\/team$/

const quelle: Quelle = {
  id: 'q1',
  dateiname: 'smith2024.pdf',
  key: 'smith2024',
  art: 'pdf',
  seitenzahl: 8,
  status: 'text',
  doi: null,
  titel: null,
  fassung: '',
  versatz: 344,
  versatzQuelle: 'pagelabels',
  ocr: null,
}

const zitat = (id: string, von: { id: string; name: string }, text: string): Zitat => ({
  id,
  seite: 3,
  label: '347',
  text,
  von,
  kommentare: [],
  zugewiesen: null,
  bestaetigt: null,
})

const eigenes = zitat('z1', { id: ICH, name: 'Anna Autor' }, 'Eigener Satz.')
const fremdes = zitat('z2', { id: BEN, name: 'Ben Berater' }, 'Fremder Satz.')

function zeigen(permissionsLevel: 'owner' | 'readOnly' = 'owner', socket?: Socket) {
  render(<Zitate quelle={quelle} seite={3} textElement={null} />, {
    wrapper: ({ children }) => (
      <EditorProviders permissionsLevel={permissionsLevel} socket={socket}>
        {children}
      </EditorProviders>
    ),
  })
}

describe('Zitate einer Quelle im Team', function () {
  deutschAktivieren()

  beforeEach(function () {
    window.metaAttributesCache.set('ol-user_id', ICH)
    fetchMock.removeRoutes().clearHistory()
    fetchMock.get(TEAM, {
      ich: ICH,
      mitglieder: [
        { id: ICH, name: 'Anna Autor' },
        { id: BEN, name: 'Ben Berater' },
      ],
    })
  })

  afterEach(function () {
    fetchMock.removeRoutes().clearHistory()
  })

  it('zeigt, wer ein Zitat markiert hat, und filtert auf eigene', async function () {
    fetchMock.get(ZITATE, { zitate: [eigenes, fremdes] })
    zeigen()
    await screen.findByText(/von Ben Berater/)
    screen.getByText(/von Ihnen/)
    fireEvent.click(screen.getByLabelText('Von mir'))
    await waitFor(() => expect(screen.queryByText('„Fremder Satz.“')).to.not.exist)
    screen.getByText('„Eigener Satz.“')
    fireEvent.click(screen.getByLabelText('Alle'))
    await screen.findByText('„Fremder Satz.“')
  })

  it('sagt es, wenn der Filter „Von mir“ nichts übrig lässt', async function () {
    fetchMock.get(ZITATE, { zitate: [fremdes] })
    zeigen()
    await screen.findByText(/von Ben Berater/)
    fireEvent.click(screen.getByLabelText('Von mir'))
    await screen.findByText('Sie haben in dieser Quelle noch keine Zitate markiert.')
  })

  it('kommentiert ein Zitat und weist es zu', async function () {
    fetchMock.get(ZITATE, { zitate: [fremdes] })
    fetchMock.post(KOMMENTARE, { status: 201, body: {} })
    zeigen()
    await screen.findByText(/von Ben Berater/)
    fireEvent.click(screen.getByRole('button', { name: 'Kommentieren' }))
    fireEvent.change(screen.getByLabelText('Kommentar'), { target: { value: 'Bitte prüfen' } })
    await screen.findByRole('option', { name: 'Ben Berater' })
    fireEvent.change(screen.getByLabelText('Zuweisen an'), { target: { value: BEN } })
    fireEvent.click(screen.getByRole('button', { name: 'Kommentar senden' }))
    await waitFor(() => expect(fetchMock.callHistory.called(KOMMENTARE)).to.be.true)
    const anfrage = fetchMock.callHistory.lastCall(KOMMENTARE)
    expect(JSON.parse(anfrage!.options.body as string)).to.deep.equal({ text: 'Bitte prüfen', zuweisen: BEN })
    await waitFor(() => expect(screen.getByRole('button', { name: 'Kommentieren' })).to.equal(document.activeElement))
  })

  it('zeigt Kommentare und Zuweisung', async function () {
    fetchMock.get(ZITATE, {
      zitate: [
        {
          ...fremdes,
          kommentare: [{ id: 'k1', von: { id: BEN, name: 'Ben Berater' }, text: 'Seite prüfen', am: '2026-11-07T10:00:00Z' }],
          zugewiesen: { an: { id: ICH, name: 'Anna Autor' }, von: { id: BEN, name: 'Ben Berater' }, am: '2026-11-07T10:00:00Z' },
        },
      ],
    })
    zeigen()
    await screen.findByText('Zugewiesen an Anna Autor')
    expect(screen.getByText('Ben Berater:').closest('li')).to.have.property('textContent', 'Ben Berater: Seite prüfen')
  })

  it('lädt neu, wenn jemand anderes im Projekt ein Zitat dieser Quelle markiert', async function () {
    const socket = new SocketIOMock()
    let abrufe = 0
    fetchMock.get(ZITATE, () => (++abrufe === 1 ? { zitate: [] } : { zitate: [fremdes] }))
    zeigen('owner', socket as unknown as Socket)
    await screen.findByText('Markieren Sie oben Text und speichern Sie ihn als Zitat.')
    socket.emitToClient('spur:zitate', { quelleId: 'andere' })
    socket.emitToClient('spur:zitate', { quelleId: 'q1' })
    await screen.findByText(/von Ben Berater/)
    expect(abrufe).to.equal(2)
  })

  it('lässt Leser sehen, aber nicht markieren', async function () {
    fetchMock.get(ZITATE, { zitate: [fremdes] })
    zeigen('readOnly')
    await screen.findByText(/von Ben Berater/)
    expect(screen.queryByRole('button', { name: 'Zitat speichern' })).to.not.exist
    expect(screen.getByRole('button', { name: 'Einfügen' })).to.have.property('disabled', true)
  })
})
