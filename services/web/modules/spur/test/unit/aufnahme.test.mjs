import { Readable } from 'node:stream'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ObjectId } from './hilfen/datenbank.mjs'
import { fehlerVon } from './hilfen/fehler.mjs'
import { Problem } from '../../app/src/probleme.mjs'
import { meldung } from '../../app/src/meldungen.mjs'

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

const ort = (url, art = 'publisher', lizenz = null) => ({ url, art, lizenz, seite: null })
const frei = (...fundorte) => ({ frei: true, fundorte })

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
      unpaywall: { status: vi.fn(async () => frei(ort('https://journals.example/keller.pdf', 'publisher', 'cc-by'))) },
      europepmc: { fundort: vi.fn(async () => null) },
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
  Aufnahme.netz.warten = vi.fn(async () => {})
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
    expect(fehler).toMatchObject({ status: 409, typ: 'quelle_vorhanden', message: meldung('spur_fehler_quelle_vorhanden') })
    expect(holen).not.toHaveBeenCalled()
  })

  it('meldet „DOI nicht gefunden“ für eine unbekannte DOI', async () => {
    m.Crossref.werk.mockResolvedValue({ gefunden: false })
    const fehler = await fehlerVon(aufnehmen('10.9999/gibt.es.nicht'))
    expect(fehler).toMatchObject({ status: 404, typ: 'doi_nicht_gefunden', message: meldung('spur_fehler_doi_nicht_gefunden') })
  })

  it('nennt Crossref, wenn der Dienst nicht antwortet', async () => {
    m.Crossref.werk.mockResolvedValue(null)
    const fehler = await fehlerVon(aufnehmen('10.1371/journal.pone.0099999'))
    expect(fehler).toMatchObject({ status: 502, message: meldung('spur_fehler_crossref_nicht_erreichbar') })
  })

  it('verweist ohne freien Volltext auf die Beschaffungsliste', async () => {
    m.dienste.unpaywall.status.mockResolvedValue({ frei: false, fundorte: [] })
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
    holen.mockResolvedValue(antwort('nur Text'))
    const fehler = await fehlerVon(aufnehmen('10.1371/journal.pone.0099999'))
    expect(fehler).toMatchObject({ status: 502, typ: 'pdf_fehlt' })
    expect(fehler.zusatz.versucht).toEqual([
      { url: 'https://journals.example/keller.pdf', host: 'journals.example', art: 'publisher', ergebnis: 'kein_pdf' },
    ])
    expect(geladen).toEqual([])
  })

  it('lehnt zu große PDFs ab', async () => {
    holen.mockResolvedValue(antwort(Buffer.concat([PDF, Buffer.alloc(2000)])))
    const fehler = await fehlerVon(aufnehmen('10.1371/journal.pone.0099999'))
    expect(fehler).toMatchObject({ status: 413 })
  })

  it('lädt PDFs nur von öffentlichen https-Adressen', async () => {
    for (const pdf of ['http://journals.example/a.pdf', 'https://127.0.0.1/a.pdf', 'https://localhost/a.pdf', 'https://10.0.0.5/x.pdf']) {
      m.dienste.unpaywall.status.mockResolvedValue(frei(ort(pdf)))
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
    m.dienste.unpaywall.status.mockResolvedValue(frei(ort('https://wechsel.example/a.pdf')))
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
      m.dienste.unpaywall.status.mockResolvedValue(frei(ort(pdf)))
      expect(await fehlerVon(aufnehmen('10.1371/journal.pone.0099999'))).toMatchObject({ typ: 'pdf_fehlt' })
    }
    expect(holen).not.toHaveBeenCalled()
  })

  it('lässt im Dev-Stack mit Paper-Fake auch das lokale Netz zu', async () => {
    m.schalter.paperApiBasis = () => 'http://paper-fake:3000'
    m.dienste.unpaywall.status.mockResolvedValue(frei(ort('http://paper-fake:3000/a.pdf')))
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

  it('meldet ein nicht eingerichtetes Unpaywall statt „kein freier Volltext“ und lädt nichts', async () => {
    m.dienste.unpaywall.status.mockRejectedValue(new Problem(503, 'unpaywall_aus', 'spur_fehler_unpaywall_aus'))
    expect(await fehlerVon(aufnehmen('10.1371/journal.pone.0099999'))).toMatchObject({ status: 503, typ: 'unpaywall_aus' })
    expect(holen).not.toHaveBeenCalled()
  })
})

// Echte Fälle: Mikalef & Gupta (2021) und Neumann et al. (2022) sind Open Access, die Verlagsseite lieferte dem
// Server aber HTML statt PDF.
describe('Ausweichwege', () => {
  const DOI = '10.1371/journal.pone.0099999'
  const VERLAG = 'https://publisher.example/artikel.pdf'
  const REPO = 'https://repository.example/handle/1.pdf'
  const EPMC = 'https://europepmc.org/articles/PMC1817752?pdf=render'
  const BOT = '<!DOCTYPE html><html><head><title>Just a moment...</title></head></html>'
  const nach = antworten => holen.mockImplementation(async url => antworten[url.href]())
  const aufrufe = () => holen.mock.calls.map(([url]) => url.href)

  it('nimmt den nächsten Fundort, wenn der erste eine HTML-Seite statt des PDFs liefert', async () => {
    m.dienste.unpaywall.status.mockResolvedValue(frei(ort(REPO, 'repository', 'cc-by'), ort(VERLAG, 'publisher', null)))
    nach({ [REPO]: () => antwort(BOT), [VERLAG]: () => antwort(PDF) })
    await aufnehmen(DOI)
    expect(aufrufe()).toEqual([REPO, VERLAG])
    // Lizenz und Weitergabe richten sich nach dem Fundort, der das PDF geliefert hat.
    expect(geladen[0]).toMatchObject({ lizenz: null, nurProjekt: true, titelStreng: true })
    expect(m.dienste.europepmc.fundort).not.toHaveBeenCalled()
  })

  it('fragt Europe PMC, wenn kein Fundort von Unpaywall das PDF liefert', async () => {
    m.dienste.unpaywall.status.mockResolvedValue(frei(ort(VERLAG)))
    m.dienste.europepmc.fundort.mockResolvedValue({ url: EPMC, art: 'europepmc', lizenz: 'cc by', seite: null })
    nach({ [VERLAG]: () => antwort(BOT), [EPMC]: () => antwort(PDF) })
    await aufnehmen(DOI)
    expect(m.dienste.europepmc.fundort).toHaveBeenCalledWith(DOI)
    expect(aufrufe()).toEqual([VERLAG, EPMC])
    expect(geladen[0]).toMatchObject({ lizenz: 'cc by', nurProjekt: false })
  })

  it('fragt Europe PMC auch, wenn Unpaywall das Paper frei nennt, aber keine PDF-Adresse kennt', async () => {
    m.dienste.unpaywall.status.mockResolvedValue(frei())
    m.dienste.europepmc.fundort.mockResolvedValue({ url: EPMC, art: 'europepmc', lizenz: null, seite: null })
    await aufnehmen(DOI)
    expect(aufrufe()).toEqual([EPMC])
  })

  it('bleibt bei nicht_frei, wenn Unpaywall frei sagt und niemand eine PDF-Adresse kennt', async () => {
    m.dienste.unpaywall.status.mockResolvedValue(frei())
    expect(await fehlerVon(aufnehmen(DOI))).toMatchObject({ status: 409, typ: 'nicht_frei' })
  })

  it('macht ohne Europe PMC mit den Fundorten von Unpaywall weiter', async () => {
    m.dienste.europepmc.fundort.mockRejectedValue(new Error('Europe PMC antwortet nicht'))
    holen.mockResolvedValue(antwort('weg', { status: 404 }))
    expect(await fehlerVon(aufnehmen(DOI))).toMatchObject({ typ: 'pdf_fehlt' })
  })

  it('meldet bot_schutz mit allen Adressen, wenn freie Fundorte HTML oder 403 liefern', async () => {
    m.dienste.unpaywall.status.mockResolvedValue(frei(ort(REPO, 'repository'), ort(VERLAG)))
    nach({ [REPO]: () => antwort('nein', { status: 403 }), [VERLAG]: () => antwort(BOT, { kopf: { 'content-type': 'text/html; charset=utf-8' } }) })
    const fehler = await fehlerVon(aufnehmen(DOI))
    expect(fehler).toMatchObject({ status: 502, typ: 'bot_schutz', message: meldung('spur_fehler_bot_schutz') })
    expect(fehler.zusatz.versucht).toEqual([
      { url: REPO, host: 'repository.example', art: 'repository', ergebnis: '403' },
      { url: VERLAG, host: 'publisher.example', art: 'publisher', ergebnis: 'html' },
    ])
    // Ohne Artikelseite ist die beste Adresse für den Browser die erste abgewiesene PDF-Adresse.
    expect(fehler.zusatz.adresse).toBe(REPO)
    expect(geladen).toEqual([])
  })

  it('nennt bei bot_schutz die Artikelseite des ersten abgewiesenen Fundorts als beste Adresse', async () => {
    m.dienste.unpaywall.status.mockResolvedValue(
      frei({ ...ort(REPO, 'repository'), seite: 'https://repository.example/handle/1' }, { ...ort(VERLAG), seite: 'https://publisher.example/artikel' })
    )
    nach({ [REPO]: () => antwort('weg', { status: 404 }), [VERLAG]: () => antwort(BOT) })
    const fehler = await fehlerVon(aufnehmen(DOI))
    expect(fehler).toMatchObject({ typ: 'bot_schutz', zusatz: { adresse: 'https://publisher.example/artikel' } })
  })

  it.each([401, 403, 429, 503])('zählt Status %i als Bot-Schutz', async status => {
    holen.mockResolvedValue(antwort('nein', { status }))
    expect(await fehlerVon(aufnehmen(DOI))).toMatchObject({ typ: 'bot_schutz' })
  })

  it('bleibt bei pdf_fehlt mit versucht, wenn der einzige Fundort 404 liefert', async () => {
    holen.mockResolvedValue(antwort('weg', { status: 404 }))
    const fehler = await fehlerVon(aufnehmen(DOI))
    expect(fehler).toMatchObject({ status: 502, typ: 'pdf_fehlt' })
    expect(fehler.zusatz.versucht).toEqual([
      { url: 'https://journals.example/keller.pdf', host: 'journals.example', art: 'publisher', ergebnis: '404' },
    ])
    expect(holen).toHaveBeenCalledTimes(1)
  })

  it('wiederholt 503 mit Retry-After und lädt beim dritten Versuch', async () => {
    holen
      .mockResolvedValueOnce(antwort('', { status: 503, kopf: { 'retry-after': '1' } }))
      .mockResolvedValueOnce(antwort('', { status: 503, kopf: { 'retry-after': '1' } }))
      .mockResolvedValueOnce(antwort(PDF))
    await aufnehmen(DOI)
    expect(holen).toHaveBeenCalledTimes(3)
    expect(Aufnahme.netz.warten.mock.calls).toEqual([[1000], [1000]])
    expect(geladen).toHaveLength(1)
  })

  it('wartet ohne Retry-After 1 und 2 Sekunden und gibt nach drei Versuchen auf', async () => {
    holen.mockImplementation(async () => antwort('', { status: 429 }))
    expect(await fehlerVon(aufnehmen(DOI))).toMatchObject({ typ: 'bot_schutz' })
    expect(holen).toHaveBeenCalledTimes(3)
    expect(Aufnahme.netz.warten.mock.calls).toEqual([[1000], [2000]])
  })

  it('begrenzt Retry-After auf 10 Sekunden', async () => {
    holen.mockResolvedValueOnce(antwort('', { status: 503, kopf: { 'retry-after': '3600' } })).mockResolvedValueOnce(antwort(PDF))
    await aufnehmen(DOI)
    expect(Aufnahme.netz.warten.mock.calls).toEqual([[10000]])
  })

  it('wiederholt Netzfehler, aber weder 404 noch gesperrte Adressen', async () => {
    holen.mockRejectedValueOnce(new Error('ECONNRESET')).mockResolvedValueOnce(antwort(PDF))
    await aufnehmen(DOI)
    expect(holen).toHaveBeenCalledTimes(2)
  })

  it('hört nach 60 Sekunden auf zu wiederholen', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    try {
      Aufnahme.netz.warten.mockImplementation(async ms => vi.advanceTimersByTime(ms))
      m.dienste.unpaywall.status.mockResolvedValue(frei(...Array.from({ length: 6 }, (_, i) => ort(`https://r${i}.example/a.pdf`, 'repository'))))
      holen.mockImplementation(async () => antwort('', { status: 503, kopf: { 'retry-after': '10' } }))
      const fehler = await fehlerVon(aufnehmen(DOI))
      expect(fehler).toMatchObject({ typ: 'bot_schutz' })
      const gewartet = Aufnahme.netz.warten.mock.calls.reduce((summe, [ms]) => summe + ms, 0)
      expect(gewartet).toBeLessThanOrEqual(60000)
      expect(fehler.zusatz.versucht).toHaveLength(6)
    } finally {
      vi.useRealTimers()
    }
  })

  it('weist ein PDF mit anderem Titel ab und nimmt den nächsten Fundort', async () => {
    m.dienste.unpaywall.status.mockResolvedValue(frei(ort(REPO, 'repository', 'cc-by'), ort(VERLAG, 'publisher', 'cc-by')))
    m.QuellenManager.aufnehmen
      .mockRejectedValueOnce(new Problem(422, 'falsches_pdf', 'spur_fehler_falsches_pdf'))
      .mockImplementationOnce(async eingabe => ({ _id: new ObjectId(), ...eingabe, titelabgleich: 'passt' }))
    const quelle = await aufnehmen(DOI)
    expect(aufrufe()).toEqual([REPO, VERLAG])
    expect(quelle.titelabgleich).toBe('passt')
  })

  it('meldet pdf_fehlt mit falsches_pdf, wenn der einzige Fundort ein anderes Werk liefert', async () => {
    m.QuellenManager.aufnehmen.mockRejectedValue(new Problem(422, 'falsches_pdf', 'spur_fehler_falsches_pdf'))
    const fehler = await fehlerVon(aufnehmen(DOI))
    expect(fehler).toMatchObject({ status: 502, typ: 'pdf_fehlt' })
    expect(fehler.zusatz.versucht.map(v => v.ergebnis)).toEqual(['falsches_pdf'])
    expect(m.ZitatManager.bibSicherstellen).not.toHaveBeenCalled()
  })
})

// Echter Fall: eine Masterarbeit der Universität Tampere ohne DOI ließ sich nicht aufnehmen.
describe('perUrl', () => {
  const URL_PDF = 'https://trepo.example/bitstream/handle/1/thesis.pdf'
  const TAMPERE = {
    titel: 'Generative AI adoption in a large enterprise',
    autoren: [{ family: 'Virtanen', given: 'Aino' }],
    jahr: 2024,
    art: 'thesis',
    abschluss: "Master's thesis",
    institution: 'Tampere University',
  }
  const perUrl = (pdfUrl = URL_PDF, metadaten = TAMPERE) => Aufnahme.perUrl({ projectId, userId, pdfUrl, metadaten })

  it('lädt das PDF und legt die Quelle mit Key aus Nachname und Jahr, Metadaten und .bib-Eintrag an', async () => {
    const quelle = await perUrl()
    expect(holen.mock.calls[0][0].href).toBe(URL_PDF)
    expect(geladen[0]).toMatchObject({
      projectId,
      userId,
      key: 'virtanen2024',
      dateiname: 'virtanen2024.pdf',
      groesse: PDF.length,
      nurProjekt: true,
      meta: { ...TAMPERE, url: URL_PDF, abgerufenAm: expect.any(Date) },
      pdfUrl: URL_PDF,
      hash: expect.stringMatching(/^[0-9a-f]{64}$/),
    })
    expect(geladen[0]).not.toHaveProperty('doi')
    // Die Person hat die Adresse selbst gewählt: Ein abweichender Titel weist das PDF nicht ab.
    expect(geladen[0].titelStreng).toBeUndefined()
    expect(m.ZitatManager.bibSicherstellen).toHaveBeenCalledWith(projectId, expect.any(Array), expect.objectContaining({ key: 'virtanen2024' }), userId)
    expect(quelle.key).toBe('virtanen2024')
  })

  it('nimmt die url aus den Metadaten für die .bib, wenn sie angegeben ist', async () => {
    await perUrl(URL_PDF, { ...TAMPERE, url: 'https://trepo.example/handle/1' })
    expect(geladen[0].meta.url).toBe('https://trepo.example/handle/1')
    expect(geladen[0].pdfUrl).toBe(URL_PDF)
  })

  it('verlangt einen Titel, bevor etwas geladen wird', async () => {
    const fehler = await fehlerVon(perUrl(URL_PDF, { ...TAMPERE, titel: undefined }))
    expect(fehler).toMatchObject({ status: 422, typ: 'eingabe_ungueltig', zusatz: { feld: 'metadaten.titel' } })
    expect(await fehlerVon(perUrl(URL_PDF, null))).toMatchObject({ typ: 'eingabe_ungueltig' })
    expect(holen).not.toHaveBeenCalled()
  })

  it.each(['http://trepo.example/thesis.pdf', 'https://127.0.0.1/thesis.pdf', 'https://localhost/thesis.pdf', 'https://10.0.0.5/thesis.pdf', 'file:///etc/passwd', 'kein link'])(
    'ruft %s nicht ab und meldet pdf_fehlt',
    async adresse => {
      const fehler = await fehlerVon(perUrl(adresse))
      expect(fehler).toMatchObject({ status: 502, typ: 'pdf_fehlt', message: meldung('spur_fehler_pdf_url_laden') })
      expect(fehler.zusatz.versucht).toMatchObject([{ url: adresse, art: 'pdf_url', ergebnis: 'gesperrt' }])
      expect(holen).not.toHaveBeenCalled()
      expect(geladen).toEqual([])
    }
  )

  it('lässt mit Paper-Fake nur Adressen unter der Basis des Fakes ins lokale Netz', async () => {
    m.schalter.paperApiBasis = () => 'http://127.0.0.1/spur/dev/crossref'
    for (const adresse of ['http://localhost/spur/dev/crossref/thesis/tampere.pdf', 'http://127.0.0.1/spur/dev/e2e/x.pdf', 'http://127.0.0.1/spur/dev/crossref-anders/x.pdf']) {
      expect(await fehlerVon(perUrl(adresse))).toMatchObject({ typ: 'pdf_fehlt' })
    }
    expect(holen).not.toHaveBeenCalled()
    await perUrl('http://127.0.0.1/spur/dev/crossref/thesis/tampere.pdf')
    expect(holen).toHaveBeenCalledTimes(1)
    expect(holen.mock.calls[0][1].gesperrt('127.0.0.1')).toBe(false)
  })

  it('meldet quelle_vorhanden für dieselbe Adresse, ohne sie erneut abzurufen', async () => {
    vorhandene = [{ key: 'virtanen2024', pdfUrl: URL_PDF }]
    expect(await fehlerVon(perUrl())).toMatchObject({ status: 409, typ: 'quelle_vorhanden' })
    expect(holen).not.toHaveBeenCalled()
  })

  it('meldet quelle_vorhanden für dieselbe Datei unter einer anderen Adresse', async () => {
    await perUrl()
    vorhandene = [{ key: 'virtanen2024', pdfUrl: URL_PDF, hash: geladen[0].hash }]
    expect(await fehlerVon(perUrl('https://spiegel.example/thesis.pdf'))).toMatchObject({ status: 409, typ: 'quelle_vorhanden' })
    expect(geladen).toHaveLength(1)
  })

  it('meldet pdf_fehlt mit dem Ergebnis, wenn die Adresse kein PDF liefert, und zu große Dateien mit 413', async () => {
    holen.mockResolvedValueOnce(antwort('<html><body>Landing page</body></html>'))
    const fehler = await fehlerVon(perUrl())
    expect(fehler).toMatchObject({ status: 502, typ: 'pdf_fehlt' })
    expect(fehler.zusatz.versucht).toEqual([{ url: URL_PDF, host: 'trepo.example', art: 'pdf_url', ergebnis: 'html' }])
    holen.mockResolvedValueOnce(antwort(Buffer.concat([PDF, Buffer.alloc(2000)])))
    expect(await fehlerVon(perUrl())).toMatchObject({ status: 413, typ: 'zu_gross' })
  })

  it('hängt bei belegtem Key einen Buchstaben an und räumt auf, wenn die .bib nicht ergänzt werden kann', async () => {
    vorhandene = [{ key: 'virtanen2024' }]
    await perUrl()
    expect(geladen[0].key).toBe('virtanen2024a')
    m.ZitatManager.bibSicherstellen.mockRejectedValueOnce(new Error('Editor weg'))
    await fehlerVon(perUrl('https://trepo.example/zweite.pdf'))
    expect(m.QuellenManager.loeschen).toHaveBeenCalled()
  })
})

