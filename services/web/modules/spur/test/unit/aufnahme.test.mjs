import { Readable } from 'node:stream'
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

// Eine Antwort wie die IncomingMessage der geschützten Anfrage.
const antwort = (inhalt, { status = 200, kopf = {} } = {}) =>
  Object.assign(Readable.from(inhalt === null ? [] : [Buffer.from(inhalt)]), { statusCode: status, headers: kopf })
let holen
let echt

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
  Aufnahme = await import('../../app/src/recherche/Aufnahme.mjs')
  echt = (await import('../../app/src/netz.mjs')).geschuetztHolen
  // Nur Namen, die intern auflösen sollen, laufen durch die echte Anfrage (und scheitern dort vor dem Verbindungsaufbau).
  holen = vi.fn(async (url, optionen) => (url.hostname === 'intern.example' ? echt(url, optionen) : antwort(PDF)))
  Aufnahme.netz.holen = holen
  Aufnahme.netz.lookup = (host, optionen, fertig) =>
    fertig(null, [{ address: host === 'intern.example' ? '10.0.0.7' : '93.184.216.34', family: 4 }])
})

const aufnehmen = doi => Aufnahme.perDoi({ projectId, userId, doi })

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('perDoi', () => {
  it('lädt das freie PDF und legt Quelle und .bib-Eintrag mit den DOI-Metadaten an', async () => {
    const ergebnis = await aufnehmen('10.1371/JOURNAL.pone.0099999')
    expect(holen.mock.calls[0][0].href).toBe('https://journals.example/keller.pdf')
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
    expect(holen).not.toHaveBeenCalled()
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
    expect(holen.mock.calls[0][0].href).toBe('https://arxiv.org/pdf/2401.01234v1')
    expect(geladen[0]).toMatchObject({ key: 'smith2024', nurProjekt: true, doi: '10.48550/arxiv.2401.01234' })
  })

  it('hängt bei belegtem Key einen Buchstaben an', async () => {
    vorhandene = [{ doi: '10.1/anders', key: 'keller2014' }]
    m.PruefManager.dokumente.mockResolvedValue([{ pfad: 'references.bib', text: '@article{keller2014a,\n}' }])
    await aufnehmen('10.1371/journal.pone.0099999')
    expect(geladen[0].key).toBe('keller2014b')
  })

  it('lehnt eine Antwort ab, die kein PDF ist', async () => {
    holen.mockResolvedValue(antwort('<html>'))
    const fehler = await fehlerVon(aufnehmen('10.1371/journal.pone.0099999'))
    expect(fehler).toMatchObject({ status: 502, typ: 'pdf_fehlt' })
    expect(geladen).toEqual([])
  })

  it('lehnt zu große PDFs ab', async () => {
    holen.mockResolvedValue(antwort(Buffer.concat([PDF, Buffer.alloc(2000)])))
    const fehler = await fehlerVon(aufnehmen('10.1371/journal.pone.0099999'))
    expect(fehler).toMatchObject({ status: 413 })
  })

  it('lädt PDFs nur von öffentlichen https-Adressen', async () => {
    for (const pdf of ['http://journals.example/a.pdf', 'https://127.0.0.1/a.pdf', 'https://localhost/a.pdf', 'https://10.0.0.5/x.pdf']) {
      m.dienste.unpaywall.status.mockResolvedValue({ frei: true, pdf, lizenz: null })
      expect(await fehlerVon(aufnehmen('10.1371/journal.pone.0099999'))).toMatchObject({ typ: 'pdf_fehlt' })
    }
    expect(holen).not.toHaveBeenCalled()
  })

  it('folgt keinem Redirect auf eine interne Adresse und keinem Namen, der intern auflöst', async () => {
    // Erste Station öffentlich, Ziel der Umleitung löst intern auf und geht durch die echte Anfrage.
    let grund
    holen
      .mockResolvedValueOnce(antwort(null, { status: 302, kopf: { location: 'https://intern.example/geheim.pdf' } }))
      .mockImplementationOnce((url, optionen) => echt(url, optionen).catch(error => { grund = error; throw error }))
    expect(await fehlerVon(aufnehmen('10.1371/journal.pone.0099999'))).toMatchObject({ typ: 'pdf_fehlt' })
    expect(holen).toHaveBeenCalledTimes(2)
    expect(grund).toMatchObject({ typ: 'adresse_gesperrt' })
  })

  it('lehnt einen Namen ab, der beim Verbindungsaufbau intern auflöst (DNS-Rebinding)', async () => {
    // Erste Auflösung öffentlich, die beim Verbinden intern: Nur die zweite darf entscheiden.
    const antworten = ['93.184.216.34', '10.0.0.7']
    let aufrufe = 0
    Aufnahme.netz.lookup = (host, optionen, fertig) => {
      fertig(null, [{ address: antworten[Math.min(aufrufe++, 1)], family: 4 }])
    }
    // So hätte eine Prüfung vor der Anfrage den Namen gesehen.
    Aufnahme.netz.lookup('wechsel.example', {}, () => {})
    let grund
    holen.mockImplementation((url, optionen) => echt(url, optionen).catch(error => { grund = error; throw error }))
    m.dienste.unpaywall.status.mockResolvedValue({ frei: true, pdf: 'https://wechsel.example/a.pdf', lizenz: null })
    expect(await fehlerVon(aufnehmen('10.1371/journal.pone.0099999'))).toMatchObject({ status: 502, typ: 'pdf_fehlt' })
    expect(aufrufe).toBe(2)
    expect(grund).toMatchObject({ typ: 'adresse_gesperrt' })
    expect(geladen).toEqual([])
  })

  it.each(['64:ff9b::7f00:1', '2002:7f00:1::1', '2001:0:4136:e378:8000:63bf:3fff:fdd2', '2001:db8::1', 'ff02::1', '::ffff:7f00:1'])(
    'lehnt einen Namen ab, der auf %s auflöst',
    async adresse => {
      Aufnahme.netz.lookup = (host, optionen, fertig) => fertig(null, [{ address: adresse, family: 6 }])
      // Der Grund zählt: Ein gescheiterter Verbindungsversuch ergäbe ebenfalls pdf_fehlt.
      let grund
      holen.mockImplementation((url, optionen) => echt(url, optionen).catch(error => { grund = error; throw error }))
      expect(await fehlerVon(aufnehmen('10.1371/journal.pone.0099999'))).toMatchObject({ typ: 'pdf_fehlt' })
      expect(grund).toMatchObject({ typ: 'adresse_gesperrt' })
    }
  )

  it('lehnt IP-Literale in übersetzten IPv6-Formen ab', async () => {
    for (const pdf of ['https://[64:ff9b::7f00:1]/a.pdf', 'https://[2002:7f00:1::1]/a.pdf']) {
      m.dienste.unpaywall.status.mockResolvedValue({ frei: true, pdf, lizenz: null })
      expect(await fehlerVon(aufnehmen('10.1371/journal.pone.0099999'))).toMatchObject({ typ: 'pdf_fehlt' })
    }
    expect(holen).not.toHaveBeenCalled()
  })

  it('lässt im Dev-Stack mit Paper-Fake auch das lokale Netz zu', async () => {
    m.schalter.paperApiBasis = () => 'http://paper-fake:3000'
    m.dienste.unpaywall.status.mockResolvedValue({ frei: true, pdf: 'http://paper-fake:3000/a.pdf', lizenz: null })
    await aufnehmen('10.1371/journal.pone.0099999')
    expect(holen.mock.calls[0][0].href).toBe('http://paper-fake:3000/a.pdf')
    expect(holen.mock.calls[0][1].gesperrt('10.0.0.5')).toBe(false)
  })

  it('folgt einem Redirect auf eine öffentliche Adresse und meldet Fehlerstatus als nicht ladbar', async () => {
    holen
      .mockResolvedValueOnce(antwort(null, { status: 301, kopf: { location: '/neu.pdf' } }))
      .mockResolvedValueOnce(antwort(PDF))
    await aufnehmen('10.1371/journal.pone.0099999')
    expect(holen.mock.calls[1][0].href).toBe('https://journals.example/neu.pdf')
    holen.mockResolvedValue(antwort('weg', { status: 404 }))
    m.QuellenManager.alle.mockResolvedValue([])
    vorhandene = []
    expect(await fehlerVon(aufnehmen('10.1371/journal.pone.0099999'))).toMatchObject({ typ: 'pdf_fehlt' })
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
