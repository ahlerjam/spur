import { expect } from 'chai'
import fetchMock from 'fetch-mock'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
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
      zaehlung: { geprueft: 1, markiert: 0, ohne_quelle: 1, ohne_seitenangabe: 1, beleg_ohne_wortlaut: 0, nicht_pruefbar: 1 },
    })
    // Der Prüf-Store ist ein Modul-Singleton: Andere Testdateien können ihn schon gefüllt oder eine
    // verzögerte Prüfung geplant haben. pruefen() bricht den Timer ab und lädt diesen Bericht.
    await pruefen()
  })

  afterEach(function () {
    fetchMock.removeRoutes().clearHistory()
  })

  it('filtert nach Befund mit Zahlen und erklärt einen leeren Filter', async function () {
    render(<PruefberichtPanel />, { wrapper: EditorProviders })
    await screen.findByText('Ein stimmiges Zitat')
    const filter = (name: RegExp) => screen.getByRole('radio', { name })
    for (const name of ['Alle 4', 'Markiert 1', 'Ohne Quelle 1', 'Nicht prüfbar 1']) screen.getByRole('radio', { name })
    fireEvent.click(filter(/^Markiert/))
    expect(screen.queryByText('Ein stimmiges Zitat')).to.not.exist
    expect(screen.getByText('Ein fehlerhaftes Zitat')).to.exist
    fireEvent.click(filter(/^Nicht prüfbar/))
    screen.getByText('Ausfall')
    expect(screen.queryByText('Ein fehlerhaftes Zitat')).to.not.exist
    fireEvent.click(filter(/^Alle/))
    expect(screen.getByText('Ein stimmiges Zitat')).to.exist
  })

  it('gruppiert nach Datei mit Zahl der Stellen und der markierten, einklappbar', async function () {
    fetchMock.removeRoutes()
    fetchMock.get(BERICHT, {
      zeilen: [zeile('gruen', false), { ...zeile('rot', true), pfad: 'kapitel.tex' }, { ...zeile('zwei', true), pfad: 'kapitel.tex', auszug: 'Zweites' }],
      zaehlung: { geprueft: 3, markiert: 2, ohne_quelle: 0, ohne_seitenangabe: 0, beleg_ohne_wortlaut: 0, nicht_pruefbar: 0 },
    })
    await pruefen()
    render(<PruefberichtPanel />, { wrapper: EditorProviders })
    const kapitel = await screen.findByRole('button', { name: /^kapitel\.tex\s*2 Stellen, 2 markiert$/ })
    screen.getByRole('button', { name: /^main\.tex\s*1 Stelle, 0 markiert$/ })
    expect(kapitel.getAttribute('aria-expanded')).to.equal('true')
    fireEvent.click(kapitel)
    expect(kapitel.getAttribute('aria-expanded')).to.equal('false')
    expect(screen.queryByText('Zweites')).to.not.exist
    screen.getByText('Ein stimmiges Zitat')
  })

  it('nennt den Zeitpunkt der Prüfung und lässt den alten Bericht während der Prüfung stehen', async function () {
    render(<PruefberichtPanel />, { wrapper: EditorProviders })
    await screen.findByText(/^Zuletzt geprüft: heute, \d{2}:\d{2}$/)
    let freigeben = () => {}
    fetchMock.removeRoutes()
    fetchMock.get(BERICHT, new Promise(resolve => {
      freigeben = () => resolve({ zeilen: [], zaehlung: { geprueft: 0, markiert: 0, ohne_quelle: 0, ohne_seitenangabe: 0, beleg_ohne_wortlaut: 0, nicht_pruefbar: 0 } })
    }))
    fireEvent.click(screen.getByRole('button', { name: 'Erneut prüfen' }))
    await screen.findByText('Prüfung läuft …')
    screen.getByText('Ein stimmiges Zitat')
    freigeben()
    await waitFor(() => expect(screen.queryByText('Prüfung läuft …')).to.not.exist)
  })

  it('zählt die Zitierstellen nach Status und nennt je nicht geprüfter Stelle den Grund', async function () {
    render(<PruefberichtPanel />, { wrapper: EditorProviders })
    await screen.findByText('4 Stellen, 1 markiert: 1 ohne Quelle, 1 ohne Seitenangabe, 1 nicht prüfbar')
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

  it('nennt markierte Stellen und Belege ohne Wortlaut', async function () {
    fetchMock.removeRoutes()
    fetchMock.get(BERICHT, {
      zeilen: [
        zeile('rot', true),
        { ...zeile('gruen', false), auszug: 'Nur Beleg', wortlaut: null, status: 'beleg_ohne_wortlaut', grund: 'kein_wortlaut' },
      ],
      zaehlung: { geprueft: 6, markiert: 4, ohne_quelle: 2, ohne_seitenangabe: 0, beleg_ohne_wortlaut: 2, nicht_pruefbar: 1 },
    })
    await pruefen()
    render(<PruefberichtPanel />, { wrapper: EditorProviders })
    await screen.findByText('2 Stellen, 1 markiert: 1 mit Befund, 1 Beleg ohne Wortlaut')
    screen.getByText('Beleg ohne Wortlaut')
  })

  it('beginnt mit der Gesamtzahl, nennt dieselbe Zahl markiert wie der Filter und schlüsselt sie auf', async function () {
    const stelle = (id: string, status: string) => ({ ...zeile(id, true), auszug: id, status, grund: status === 'geprueft' ? null : 'x' })
    fetchMock.removeRoutes()
    fetchMock.get(BERICHT, {
      zeilen: [
        ...['a', 'b', 'c'].map(id => stelle(id, 'geprueft')),
        ...['d', 'e'].map(id => stelle(id, 'ohne_quelle')),
        stelle('f', 'nicht_pruefbar'),
        ...['g', 'h', 'i'].map(id => ({ ...zeile(id, false), auszug: id })),
      ],
      zaehlung: { geprueft: 6, markiert: 6, ohne_quelle: 2, ohne_seitenangabe: 0, beleg_ohne_wortlaut: 0, nicht_pruefbar: 1 },
    })
    await pruefen()
    render(<PruefberichtPanel />, { wrapper: EditorProviders })
    await screen.findByText('9 Stellen, 6 markiert: 3 mit Befund, 2 ohne Quelle, 1 nicht prüfbar')
    screen.getByRole('radio', { name: 'Markiert 6' })
    fireEvent.click(screen.getByRole('radio', { name: /^Markiert/ }))
    expect(document.querySelectorAll('.spur-zeile')).to.have.length(6)
  })

  it('lässt Status mit null Stellen in der Zählung weg', async function () {
    fetchMock.removeRoutes()
    fetchMock.get(BERICHT, { zeilen: [zeile('gruen', false)], zaehlung: { geprueft: 1, markiert: 0, ohne_quelle: 0, ohne_seitenangabe: 0, beleg_ohne_wortlaut: 0, nicht_pruefbar: 0 } })
    await pruefen()
    render(<PruefberichtPanel />, { wrapper: EditorProviders })
    await screen.findByText('1 Stelle, keine markiert')
  })
})
