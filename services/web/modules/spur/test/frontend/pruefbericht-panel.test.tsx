import { expect } from 'chai'
import fetchMock from 'fetch-mock'
import { fireEvent, render, screen } from '@testing-library/react'
import PruefberichtPanel from '@modules/spur/frontend/js/pruefung/pruefbericht-panel'
import { EditorProviders } from '../../../../test/frontend/helpers/editor-providers'
import { pruefen } from '@modules/spur/frontend/js/pruefung/pruef-store'
import { deutschAktivieren } from './helpers/deutsch'

const BERICHT = /\/spur\/project\/[^/]+\/pruefbericht$/

const zeile = (id: string, problem: boolean) => ({
  id,
  docId: `doc-${id}`,
  pfad: 'main.tex',
  zeile: id === 'gruen' ? 4 : 9,
  form: 'zitat',
  key: id === 'gruen' ? 'mueller2020' : 'schmidt2019',
  auszug: id === 'gruen' ? 'Ein stimmiges Zitat' : 'Ein fehlerhaftes Zitat',
  zitatVon: 0,
  zitatBis: 1,
  wortlaut: problem ? 'abweichend' : 'exakt',
  seite: null,
  problem,
  status: 'geprueft',
  grund: null as string | null,
})

describe('Prüfbericht-Panel', function () {
  deutschAktivieren()

  beforeEach(async function () {
    fetchMock.removeRoutes().clearHistory()
    fetchMock.get(BERICHT, {
      zeilen: [
        zeile('gruen', false),
        { ...zeile('rot', true), wortlaut: 'quelle_fehlt', status: 'ohne_quelle', grund: 'keine_quelle' },
        { ...zeile('seite', false), auszug: 'Ohne Seite', status: 'ohne_seitenangabe', grund: 'seitenangabe_fehlt' },
        { ...zeile('ausfall', false), auszug: 'Ausfall', referenz: 'nicht_pruefbar', status: 'nicht_pruefbar', grund: 'crossref_nicht_erreichbar' },
      ],
      zaehlung: { geprueft: 1, ohne_quelle: 1, ohne_seitenangabe: 1, nicht_pruefbar: 1 },
    })
    // Der Prüf-Store ist ein Modul-Singleton: Andere Testdateien können ihn schon gefüllt oder eine
    // verzögerte Prüfung geplant haben. pruefen() bricht den Timer ab und lädt diesen Bericht.
    await pruefen()
  })

  afterEach(function () {
    fetchMock.removeRoutes().clearHistory()
  })

  it('blendet mit „Nur Probleme“ grüne Zeilen aus', async function () {
    render(<PruefberichtPanel />, { wrapper: EditorProviders })
    await screen.findByText('Ein stimmiges Zitat')
    expect(screen.getByText('Ein fehlerhaftes Zitat')).to.exist

    fireEvent.click(screen.getByLabelText('Nur Probleme'))

    expect(screen.queryByText('Ein stimmiges Zitat')).to.not.exist
    expect(screen.getByText('Ein fehlerhaftes Zitat')).to.exist

    fireEvent.click(screen.getByLabelText('Nur Probleme'))
    expect(screen.getByText('Ein stimmiges Zitat')).to.exist
  })

  it('zählt die Zitierstellen nach Status und nennt je nicht geprüfter Stelle den Grund', async function () {
    render(<PruefberichtPanel />, { wrapper: EditorProviders })
    await screen.findByText('Zitierstellen: 1 geprüft, 1 ohne Quelle, 1 ohne Seitenangabe, 1 nicht prüfbar')
    expect(screen.queryByText(/Abschnitte geprüft/)).to.not.exist
    screen.getByText('keine Quelle aufgenommen')
    screen.getByText('Seitenangabe fehlt')
    screen.getByText('nicht prüfbar – Crossref gerade nicht erreichbar')
  })

  it('zeigt Registrierstellen: DataCite grün mit Hinweis, andere neutral, nicht erreichbar als nicht prüfbar', async function () {
    fetchMock.removeRoutes()
    fetchMock.get(BERICHT, {
      zeilen: [
        { ...zeile('gruen', false), auszug: 'arXiv', wortlaut: null, referenz: 'gefunden', registrierstelle: 'datacite', retraction: null },
        { ...zeile('rot', false), auszug: 'mEDRA', wortlaut: null, referenz: 'registriert', registrierstelle: 'medra', registrierstelleName: 'mEDRA' },
        { ...zeile('weg', false), auszug: 'Weg', wortlaut: null, referenz: 'nicht_pruefbar', grund: 'registrierstelle_nicht_erreichbar', status: 'nicht_pruefbar' },
      ],
      zaehlung: { geprueft: 2, ohne_quelle: 0, ohne_seitenangabe: 0, nicht_pruefbar: 1 },
    })
    await pruefen()
    render(<PruefberichtPanel />, { wrapper: EditorProviders })
    const datacite = await screen.findByText('Registriert bei DataCite')
    expect(datacite.closest('.badge')?.className).to.include('bg-success')
    screen.getByText('DataCite liefert keine Rückzugsmeldungen.')
    expect(screen.getByText('Registriert bei mEDRA, Metadaten nicht geprüft').closest('.badge')?.className).to.include('bg-info')
    screen.getByText('nicht prüfbar – die Registrierstelle ist gerade nicht erreichbar')
  })

  it('lässt Status mit null Stellen in der Zählung weg', async function () {
    fetchMock.removeRoutes()
    fetchMock.get(BERICHT, { zeilen: [zeile('gruen', false)], zaehlung: { geprueft: 1, ohne_quelle: 0, ohne_seitenangabe: 0, nicht_pruefbar: 0 } })
    await pruefen()
    render(<PruefberichtPanel />, { wrapper: EditorProviders })
    await screen.findByText('Zitierstellen: 1 geprüft')
  })
})
