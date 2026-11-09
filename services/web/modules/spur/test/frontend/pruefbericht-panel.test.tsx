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
})

describe('Prüfbericht-Panel', function () {
  deutschAktivieren()

  beforeEach(async function () {
    fetchMock.removeRoutes().clearHistory()
    fetchMock.get(BERICHT, {
      zeilen: [zeile('gruen', false), zeile('rot', true)],
      statistik: { geprueft: 2, wiederverwendet: 0 },
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
})
