import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ObjectId } from './hilfen/datenbank.mjs'
import { fehlerVon } from './hilfen/fehler.mjs'

let Aufnahme
let m
let vorhandene
let geladen

const projectId = new ObjectId()
const userId = new ObjectId()
const PDF = Buffer.from('%PDF-1.5\nInhalt')

const KELLER = {
  gefunden: true,
  titel: 'Sleep spindles predict overnight memory consolidation',
  autoren: [{ family: 'Keller', given: 'Maria' }],
  jahr: 2014,
  journal: 'PLOS ONE',
  seiten: null,
  typ: 'journal-article',
  retraction: 'keine_meldung',
}

beforeEach(async () => {
  vorhandene = []
  geladen = []
  m = {
    Crossref: { werk: vi.fn(async () => KELLER) },
    dienste: {
      unpaywall: { status: vi.fn(async () => ({ frei: true, pdf: 'https://journals.example/keller.pdf', lizenz: 'cc-by' })) },
      arxivMetadaten: vi.fn(),
      basis: () => 'https://export.arxiv.org',
    },
    QuellenManager: {
      MAX_BYTES: 1000,
      alle: vi.fn(async () => vorhandene),
      loeschen: vi.fn(async () => {}),
      aufnehmen: vi.fn(async eingabe => {
        geladen.push(eingabe)
        return { _id: new ObjectId(), ...eingabe, dateiname: eingabe.dateiname }
      }),
    },
    ZitatManager: { bibSicherstellen: vi.fn(async (pid, docs, quelle) => quelle.key) },
    PruefManager: { dokumente: vi.fn(async () => [{ pfad: 'references.bib', text: '@article{keller2014b,\n}' }]) },
    schalter: { paperApiBasis: () => undefined, jetzt: () => new Date() },
  }
  vi.stubEnv('UNPAYWALL_EMAIL', 'test@example.org')
  vi.resetModules()
  vi.doMock('../../app/src/Crossref.mjs', () => m.Crossref)
  vi.doMock('../../app/src/recherche/dienste.mjs', () => m.dienste)
  vi.doMock('../../app/src/QuellenManager.mjs', () => m.QuellenManager)
  vi.doMock('../../app/src/ZitatManager.mjs', () => m.ZitatManager)
  vi.doMock('../../app/src/pruefung/PruefManager.mjs', () => m.PruefManager)
  vi.doMock('../../app/src/schalter.mjs', () => m.schalter)
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(PDF, { status: 200, headers: { 'Content-Type': 'application/pdf' } }))
  )
  Aufnahme = await import('../../app/src/recherche/Aufnahme.mjs')
  Aufnahme.namen.lookup = async host => [{ address: host === 'intern.example' ? '10.0.0.7' : '93.184.216.34', family: 4 }]
})

const aufnehmen = doi => Aufnahme.perDoi({ projectId, userId, doi })

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe('perDoi', () => {
  it('lädt das freie PDF und legt Quelle und .bib-Eintrag mit den DOI-Metadaten an', async () => {
    const ergebnis = await aufnehmen('10.1371/JOURNAL.pone.0099999')
    expect(fetch).toHaveBeenCalledWith('https://journals.example/keller.pdf', expect.anything())
    expect(geladen[0]).toMatchObject({
      projectId,
      userId,
      dateiname: 'keller2014.pdf',
      key: 'keller2014',
      doi: '10.1371/journal.pone.0099999',
      meta: KELLER,
      nurProjekt: false,
      groesse: PDF.length,
    })
    expect(m.ZitatManager.bibSicherstellen).toHaveBeenCalledWith(
      projectId,
      expect.any(Array),
      expect.objectContaining({ key: 'keller2014', meta: KELLER }),
      userId
    )
    expect(ergebnis.key).toBe('keller2014')
  })

  it('meldet „Bereits vorhanden“, wenn die DOI schon eine Quelle hat', async () => {
    vorhandene = [{ doi: '10.1371/journal.pone.0099999', key: 'keller2014' }]
    const fehler = await fehlerVon(aufnehmen('10.1371/journal.pone.0099999'))
    expect(fehler).toMatchObject({ status: 409, typ: 'quelle_vorhanden', message: 'Bereits vorhanden' })
    expect(fetch).not.toHaveBeenCalled()
  })

  it('meldet „DOI nicht gefunden“ für eine unbekannte DOI', async () => {
    m.Crossref.werk.mockResolvedValue({ gefunden: false })
    const fehler = await fehlerVon(aufnehmen('10.9999/gibt.es.nicht'))
    expect(fehler).toMatchObject({ status: 404, typ: 'doi_nicht_gefunden', message: 'DOI nicht gefunden' })
  })

  it('nennt Crossref, wenn der Dienst nicht antwortet', async () => {
    m.Crossref.werk.mockResolvedValue(null)
    const fehler = await fehlerVon(aufnehmen('10.1371/journal.pone.0099999'))
    expect(fehler).toMatchObject({ status: 502, message: expect.stringContaining('Crossref nicht erreichbar') })
  })

  it('verweist ohne freien Volltext auf die Beschaffungsliste', async () => {
    m.dienste.unpaywall.status.mockResolvedValue({ frei: false, pdf: null, lizenz: null })
    const fehler = await fehlerVon(aufnehmen('10.1371/journal.pone.0099999'))
    expect(fehler).toMatchObject({ status: 409, typ: 'nicht_frei' })
  })

  it('nimmt arXiv-DOIs mit Metadaten von arXiv auf und hält den Volltext ohne Lizenz im Projekt', async () => {
    m.Crossref.werk.mockResolvedValue({ gefunden: false })
    m.dienste.arxivMetadaten.mockResolvedValue({
      gefunden: true,
      titel: 'Sleep-like replay',
      autoren: [{ family: 'Smith', given: 'Alice' }],
      jahr: 2024,
      journal: 'arXiv',
      pdf: 'https://arxiv.org/pdf/2401.01234v1',
    })
    await aufnehmen('10.48550/arXiv.2401.01234')
    expect(m.dienste.arxivMetadaten).toHaveBeenCalledWith('2401.01234')
    expect(m.dienste.unpaywall.status).not.toHaveBeenCalled()
    expect(fetch).toHaveBeenCalledWith('https://arxiv.org/pdf/2401.01234v1', expect.anything())
    expect(geladen[0]).toMatchObject({ key: 'smith2024', nurProjekt: true, doi: '10.48550/arxiv.2401.01234' })
  })

  it('hängt bei belegtem Key einen Buchstaben an', async () => {
    vorhandene = [{ doi: '10.1/anders', key: 'keller2014' }]
    m.PruefManager.dokumente.mockResolvedValue([{ pfad: 'references.bib', text: '@article{keller2014a,\n}' }])
    await aufnehmen('10.1371/journal.pone.0099999')
    expect(geladen[0].key).toBe('keller2014b')
  })

  it('lehnt eine Antwort ab, die kein PDF ist', async () => {
    fetch.mockResolvedValue(new Response('<html>', { status: 200 }))
    const fehler = await fehlerVon(aufnehmen('10.1371/journal.pone.0099999'))
    expect(fehler).toMatchObject({ status: 502, typ: 'pdf_fehlt' })
    expect(geladen).toEqual([])
  })

  it('lehnt zu große PDFs ab', async () => {
    fetch.mockResolvedValue(new Response(Buffer.concat([PDF, Buffer.alloc(2000)]), { status: 200 }))
    const fehler = await fehlerVon(aufnehmen('10.1371/journal.pone.0099999'))
    expect(fehler).toMatchObject({ status: 413 })
  })

  it('lädt PDFs nur von öffentlichen https-Adressen', async () => {
    for (const pdf of ['http://journals.example/a.pdf', 'https://127.0.0.1/a.pdf', 'https://localhost/a.pdf', 'https://10.0.0.5/x.pdf']) {
      m.dienste.unpaywall.status.mockResolvedValue({ frei: true, pdf, lizenz: null })
      expect(await fehlerVon(aufnehmen('10.1371/journal.pone.0099999'))).toMatchObject({ typ: 'pdf_fehlt' })
    }
    expect(fetch).not.toHaveBeenCalled()
  })

  it('folgt keinem Redirect auf eine interne Adresse und keinem Namen, der intern auflöst', async () => {
    fetch.mockResolvedValue(new Response(null, { status: 302, headers: { Location: 'https://intern.example/geheim.pdf' } }))
    expect(await fehlerVon(aufnehmen('10.1371/journal.pone.0099999'))).toMatchObject({ typ: 'pdf_fehlt' })
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(fetch.mock.calls[0][1]).toMatchObject({ redirect: 'manual' })
  })

  it('räumt die Quelle weg, wenn die .bib nicht ergänzt werden kann', async () => {
    m.ZitatManager.bibSicherstellen.mockRejectedValueOnce(new Error('Editor weg'))
    await fehlerVon(aufnehmen('10.1371/journal.pone.0099999'))
    expect(m.QuellenManager.loeschen).toHaveBeenCalled()
  })

  it('meldet ein nicht eingerichtetes Unpaywall statt „kein freier Volltext“', async () => {
    vi.stubEnv('UNPAYWALL_EMAIL', '')
    expect(await fehlerVon(aufnehmen('10.1371/journal.pone.0099999'))).toMatchObject({ status: 503, typ: 'unpaywall_aus' })
  })
})
