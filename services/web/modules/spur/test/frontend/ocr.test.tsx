import { expect } from 'chai'
import fetchMock from 'fetch-mock'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { SocketIOMock } from '@/ide/connection/SocketIoShim'
import type { Socket } from '@/features/ide-react/connection/types/socket'
import QuellenPanel from '@modules/spur/frontend/js/quellen/quellen-panel'
import Zitate from '@modules/spur/frontend/js/quellen/zitate'
import type { Quelle, Zitat } from '@modules/spur/frontend/js/quellen/typen'
import { EditorProviders } from '../../../../test/frontend/helpers/editor-providers'
import { deutschAktivieren } from './helpers/deutsch'

const QUELLEN = /\/spur\/project\/[^/]+\/quellen$/
const ANDERE = /\/spur\/project\/[^/]+\/quellen\/andere$/
const ZUGEWIESEN = /\/spur\/project\/[^/]+\/zitate\/zugewiesen$/
const OCR = /\/spur\/project\/[^/]+\/quellen\/s1\/ocr$/
const ZITATE = /\/spur\/project\/[^/]+\/quellen\/s1\/zitate$/
const BESTAETIGEN = /\/spur\/project\/[^/]+\/quellen\/s1\/zitate\/z1\/bestaetigen$/

const scan = (extra: Partial<Quelle> = {}): Quelle => ({
  id: 's1',
  dateiname: 'scan.pdf',
  key: 'scan',
  art: 'pdf',
  seitenzahl: 2,
  status: 'kein_text',
  doi: null,
  titel: null,
  fassung: '',
  versatz: null,
  versatzQuelle: null,
  ocr: null,
  ...extra,
})

const zitat: Zitat = {
  id: 'z1',
  seite: 1,
  label: null,
  text: 'Short naps restore attention in night shift workers.',
  von: { id: 'a', name: 'Anna Autor' },
  kommentare: [],
  zugewiesen: null,
  bestaetigt: null,
}

function mitProvidern(socket?: Socket) {
  return ({ children }: { children: React.ReactNode }) => (
    <EditorProviders socket={socket}>{children}</EditorProviders>
  )
}

describe('Texterkennung (OCR)', function () {
  deutschAktivieren()

  beforeEach(function () {
    fetchMock.removeRoutes().clearHistory()
    fetchMock.get(ANDERE, { projekte: [], klonVon: null })
    fetchMock.get(ZUGEWIESEN, { zitate: [] })
  })

  afterEach(function () {
    fetchMock.removeRoutes().clearHistory()
  })

  it('startet die Texterkennung für einen Scan und zeigt den Fortschritt, den der Server meldet', async function () {
    const socket = new SocketIOMock()
    const staende = [
      scan(),
      scan({ ocr: { status: 'laeuft', fertig: 0, gesamt: 2, konfidenz: null } }),
      scan({ ocr: { status: 'laeuft', fertig: 1, gesamt: 2, konfidenz: null } }),
      scan({ status: 'ocr', ocr: { status: 'fertig', fertig: 2, gesamt: 2, konfidenz: 93 } }),
    ]
    let abruf = 0
    fetchMock.get(QUELLEN, () => ({ quellen: [staende[Math.min(abruf++, 3)]], gesamt: 1 }))
    fetchMock.post(OCR, { status: 202, body: staende[1] })
    render(<QuellenPanel />, { wrapper: mitProvidern(socket as unknown as Socket) })
    await screen.findByText(/Kein Text, nicht prüfbar/)
    fireEvent.click(screen.getByRole('button', { name: 'Text erkennen' }))
    await screen.findByText('Text wird erkannt: Seite 0 von 2')
    expect(fetchMock.callHistory.called(OCR)).to.be.true
    expect(screen.queryByRole('button', { name: 'Text erkennen' })).to.not.exist
    socket.emitToClient('spur:quellen', { quelleId: 's1' })
    await screen.findByText('Text wird erkannt: Seite 1 von 2')
    socket.emitToClient('spur:quellen', { quelleId: 's1' })
    await screen.findByText(/OCR, Sichtprüfung nötig/)
  })

  it('nennt eine unsichere Erkennung in Text und bietet nach einem Fehler einen neuen Versuch an', async function () {
    fetchMock.get(QUELLEN, {
      quellen: [
        { ...scan({ status: 'ocr', ocr: { status: 'fertig', fertig: 2, gesamt: 2, konfidenz: 41 } }), id: 's2', dateiname: 'unscharf.pdf' },
        scan({ ocr: { status: 'fehler', fertig: 1, gesamt: 2, konfidenz: null } }),
      ],
      gesamt: 2,
    })
    render(<QuellenPanel />, { wrapper: mitProvidern() })
    await screen.findByText(/OCR unsicher, Sichtprüfung nötig/)
    screen.getByText(/Texterkennung fehlgeschlagen\. Bitte erneut versuchen\./)
    expect(screen.getAllByRole('button', { name: 'Text erkennen' })).to.have.length(1)
  })

  it('zeigt Zitate aus OCR-Text als nicht bestätigt, bis ein Mensch die Stelle bestätigt', async function () {
    let bestaetigt = false
    fetchMock.get(ZITATE, () => ({
      zitate: [bestaetigt ? { ...zitat, bestaetigt: { von: { id: 'a', name: 'Anna Autor' }, am: '2026-11-07T10:00:00Z' } } : zitat],
    }))
    fetchMock.post(BESTAETIGEN, () => {
      bestaetigt = true
      return { status: 200, body: {} }
    })
    render(<Zitate quelle={scan({ status: 'ocr' })} seite={1} textElement={null} />, {
      wrapper: mitProvidern(),
    })
    await screen.findByText('Wortlaut: OCR, nicht bestätigt')
    fireEvent.click(screen.getByRole('button', { name: 'Stelle bestätigt' }))
    const status = await screen.findByText('Wortlaut: von Mensch bestätigt')
    expect(screen.queryByRole('button', { name: 'Stelle bestätigt' })).to.not.exist
    await waitFor(() => expect(document.activeElement).to.equal(status))
  })

  it('zeigt bei Quellen mit echtem Text keinen OCR-Status', async function () {
    fetchMock.get(ZITATE, { zitate: [zitat] })
    render(<Zitate quelle={scan({ status: 'text' })} seite={1} textElement={null} />, {
      wrapper: mitProvidern(),
    })
    await screen.findByText(/von Anna Autor/)
    expect(screen.queryByText('Wortlaut: OCR, nicht bestätigt')).to.not.exist
  })
})
