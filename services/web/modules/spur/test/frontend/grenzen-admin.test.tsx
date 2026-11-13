import { expect } from 'chai'
import fetchMock from 'fetch-mock'
import { fireEvent, render, screen, within } from '@testing-library/react'
import GrenzenAdmin from '@modules/spur/frontend/js/grenzen/grenzen-admin'
import { deutschAktivieren } from './helpers/deutsch'

const DATEN = /\/spur\/admin\/grenzen\.json$/
const STANDARD = /\/spur\/admin\/grenzen\/standard$/

const daten = (tex: object = {}) => ({
  standard: { projekte: null, speicherGb: null, texPaketeAus: false, texPaketMb: null, texProjektMb: null, texProStunde: null, ...tex },
  texStandard: { texPaketMb: 100, texProjektMb: 300, texProStunde: 60 },
  nutzer: [],
  projekte: [],
})

describe('Grenzen für TeX-Pakete im Admin-Bereich', function () {
  deutschAktivieren()

  beforeEach(function () {
    fetchMock.removeRoutes().clearHistory()
  })

  afterEach(function () {
    fetchMock.removeRoutes().clearHistory()
  })

  it('zeigt die Standardwerte als Platzhalter und sendet die eingetragenen Werte', async function () {
    fetchMock.get(DATEN, daten())
    fetchMock.put(STANDARD, 204)
    render(<GrenzenAdmin />)
    const abschnitt = (await screen.findByRole('heading', { name: 'TeX-Pakete' })).closest('section') as HTMLElement
    const feld = (name: string) => within(abschnitt).getByLabelText(name) as HTMLInputElement
    expect(feld('Größe je Paket (MB)').placeholder).to.equal('100')
    expect(feld('Pakete je Projekt (MB)').placeholder).to.equal('300')
    expect(feld('Installationen je Stunde').placeholder).to.equal('60')
    fireEvent.change(feld('Größe je Paket (MB)'), { target: { value: '10' } })
    fireEvent.change(feld('Installationen je Stunde'), { target: { value: '2' } })
    fireEvent.click(within(abschnitt).getByRole('button', { name: 'Speichern' }))
    await screen.findByText('Gespeichert')
    const body = JSON.parse(String(fetchMock.callHistory.lastCall(STANDARD)?.options.body))
    expect(body).to.include({ texPaketMb: '10', texProjektMb: '', texProStunde: '2' })
  })

  it('zeigt gespeicherte Werte im Feld und Fehler am Feld', async function () {
    fetchMock.get(DATEN, daten({ texPaketMb: 10 }))
    fetchMock.put(STANDARD, { status: 422, body: { fehler: { texProStunde: 'Bitte eine ganze Zahl ab 1 eingeben.' } } })
    render(<GrenzenAdmin />)
    const feld = (await screen.findByLabelText('Größe je Paket (MB)')) as HTMLInputElement
    expect(feld.value).to.equal('10')
    fireEvent.change(screen.getByLabelText('Installationen je Stunde'), { target: { value: '0' } })
    fireEvent.click(screen.getByRole('button', { name: 'Speichern' }))
    await screen.findByText('Bitte eine ganze Zahl ab 1 eingeben.')
    expect(screen.getByLabelText('Installationen je Stunde').getAttribute('aria-invalid')).to.equal('true')
  })

  describe('Projekttabelle', function () {
    const projekt = (i: number, teil: object = {}) => ({
      id: `p${i}`,
      name: `Projekt ${String(i).padStart(3, '0')}`,
      eigentuemer: i % 2 ? 'ungerade@example.org' : 'gerade@example.org',
      bytes: 0,
      grenze: null,
      ...teil,
    })
    const zeigen = async (projekte: object[]) => {
      fetchMock.get(DATEN, { ...daten(), projekte })
      render(<GrenzenAdmin />)
      return (await screen.findByRole('heading', { name: 'Projekte' })).closest('section') as HTMLElement
    }

    it('zeigt höchstens 50 Zeilen, blättert und sucht nach Projekt und Eigentümer', async function () {
      const abschnitt = await zeigen(Array.from({ length: 120 }, (_, i) => projekt(i + 1)))
      expect(abschnitt.querySelectorAll('tbody tr')).to.have.length(50)
      within(abschnitt).getByText('Seite 1 von 3')
      fireEvent.click(within(abschnitt).getByRole('button', { name: 'Nächste Seite' }))
      within(abschnitt).getByText('Projekt 051')
      fireEvent.change(within(abschnitt).getByLabelText('Nach Projekt oder Eigentümer suchen'), { target: { value: 'projekt 07' } })
      expect(abschnitt.querySelectorAll('tbody tr')).to.have.length(10)
      expect(within(abschnitt).queryByRole('navigation')).to.equal(null)
      fireEvent.change(within(abschnitt).getByLabelText('Nach Projekt oder Eigentümer suchen'), { target: { value: 'ungerade@' } })
      expect(abschnitt.querySelectorAll('tbody tr')).to.have.length(50)
      within(abschnitt).getByText('Seite 1 von 2')
      fireEvent.change(within(abschnitt).getByLabelText('Nach Projekt oder Eigentümer suchen'), { target: { value: 'gibtsnicht' } })
      within(abschnitt).getByText('Keine Projekte gefunden')
    })

    it('zeigt den Speicher in KB, MB oder GB mit deutscher Zahl und nie „0 GB“ für Projekte mit Dateien', async function () {
      const abschnitt = await zeigen([
        projekt(1, { bytes: 0 }),
        projekt(2, { bytes: 512 * 1024 }),
        projekt(3, { bytes: Math.round(3.4 * 1024 ** 2) }),
        projekt(4, { bytes: Math.round(1.2 * 1024 ** 3) }),
        projekt(5, { bytes: 300 }),
      ])
      const zelle = (name: string) => (abschnitt.querySelector(`tr[data-projekt="${name}"] .spur-grenzen-zahl`) as HTMLElement).textContent
      expect(zelle('Projekt 001')).to.equal('0 KB')
      expect(zelle('Projekt 002')).to.equal('512 KB')
      expect(zelle('Projekt 003')).to.equal('3,4 MB')
      expect(zelle('Projekt 004')).to.equal('1,2 GB')
      expect(zelle('Projekt 005')).to.equal('0,29 KB')
    })
  })
})
