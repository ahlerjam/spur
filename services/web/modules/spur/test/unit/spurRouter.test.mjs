import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Antwort, anfrage } from './hilfen/express.mjs'

let routen
let hochladen
let multerFehler
let marken
const MAX = 50 * 1024 * 1024

// Jede Prüfung ist eine eigene Funktion, damit sich die Kette einer Route an ihr erkennen lässt.
function markenBauen() {
  const marke = name => Object.assign(() => {}, { marke: name })
  return {
    angemeldet: marke('angemeldet'),
    admin: marke('admin'),
    eingeschraenkt: marke('eingeschraenkt'),
    lesen: marke('lesen'),
    pruefen: marke('pruefen'),
    schreiben: marke('schreiben'),
  }
}

async function laden({ dev = false } = {}) {
  marken = markenBauen()
  multerFehler = null
  vi.resetModules()
  vi.doMock('../../../../app/src/Features/Authorization/AuthorizationMiddleware.mjs', () => ({
    default: {
      blockRestrictedUserFromProject: marken.eingeschraenkt,
      ensureUserCanReadProject: marken.lesen,
      ensureUserCanWriteOrReviewProjectContent: marken.pruefen,
      ensureUserCanWriteProjectContent: marken.schreiben,
      ensureUserIsSiteAdmin: marken.admin,
    },
  }))
  vi.doMock('../../../../app/src/Features/Authorization/AuthorizationManager.mjs', () => ({
    default: { promises: { isUserSiteAdmin: async userId => userId === 'admin-id' } },
  }))
  vi.doMock('../../../../app/src/Features/Authentication/SessionManager.mjs', () => ({
    default: { getLoggedInUserId: session => session.userId },
  }))
  vi.doMock('../../../../app/src/Features/Authentication/AuthenticationController.mjs', () => ({
    default: { requireLogin: () => marken.angemeldet },
  }))
  vi.doMock('../../../../app/src/infrastructure/Multer.mjs', () => ({
    multerUploadHandler: optionen => {
      marken.multerOptionen = optionen
      return { single: feld => (marken.multerFeld = feld, (req, res, weiter) => weiter(multerFehler)) }
    },
  }))
  vi.doMock('../../app/src/QuellenManager.mjs', () => ({ MAX_BYTES: MAX }))
  vi.doMock('../../../../app/src/Features/Security/RateLimiterMiddleware.mjs', () => ({
    default: { rateLimit: limiter => Object.assign(() => {}, { limiter: limiter.name }) },
  }))
  vi.doMock('../../../../app/src/infrastructure/RateLimiter.mjs', () => ({ RateLimiter: class { constructor(name) { this.name = name } } }))
  vi.doMock('../../app/src/schalter.mjs', () => ({ IST_DEV: dev }))
  // Controller als Handler mit Namen; ihre echten Abhängigkeiten (Overleafs Modelle) braucht der Routentest nicht.
  const handlerAttrappe = () =>
    new Proxy({}, { get: (ziel, name) => (name === 'then' || typeof name === 'symbol' ? undefined : (ziel[name] ??= Object.assign(() => {}, { handler: name }))) })
  vi.doMock('../../app/src/SpurController.mjs', handlerAttrappe)
  vi.doMock('../../app/src/vorschlaege/VorschlaegeController.mjs', handlerAttrappe)
  vi.doMock('../../app/src/grenzen/GrenzenController.mjs', handlerAttrappe)
  vi.doMock('../../app/src/hochladen/UploadLinkController.mjs', handlerAttrappe)
  vi.doMock('../../app/src/dev/PaperFake.mjs', () => ({ paperFake: Object.assign(() => {}, { handler: 'paperFake' }) }))
  vi.doMock('../../app/src/dev/MailFake.mjs', () => ({
    mailFakeSteuern: Object.assign(() => {}, { handler: 'mailFakeSteuern' }),
    mailFakeLesen: Object.assign(() => {}, { handler: 'mailFakeLesen' }),
  }))
  vi.doMock('../../app/src/dev/DevSchalter.mjs', () => ({
    testseite: Object.assign(() => {}, { handler: 'testseite' }),
    zeitSetzen: Object.assign(() => {}, { handler: 'zeitSetzen' }),
    e2eVorbereiten: Object.assign(() => {}, { handler: 'e2eVorbereiten' }),
    quelleVergroessern: Object.assign(() => {}, { handler: 'quelleVergroessern' }),
    proxySperre: name => Object.assign(() => {}, { handler: `proxySperre:${name}` }),
    speicherFehler: name => Object.assign(() => {}, { handler: `speicherFehler:${name}` }),
    pdfUmleiten: Object.assign(() => {}, { handler: 'pdfUmleiten' }),
  }))
  vi.doMock('../../app/src/mcp/McpEndpunkt.mjs', () => ({ mcpAnfrage: Object.assign(() => {}, { handler: 'mcpAnfrage' }) }))
  const Router = (await import('../../app/src/SpurRouter.mjs')).default
  routen = []
  const router = Object.fromEntries(
    ['get', 'post', 'put', 'patch', 'delete', 'all', 'use'].map(methode => [methode, (pfad, ...kette) => routen.push({ methode, pfad, kette })])
  )
  const oeffentlich = { ...router, all: (pfad, ...kette) => routen.push({ methode: 'all', pfad, kette, oeffentlich: true }) }
  Router.apply(router, {}, oeffentlich)
  hochladen = routen.find(r => r.methode === 'post' && r.pfad.endsWith('/quellen')).kette.at(-2)
  marken.beschaffungHochladen = routen.find(r => r.pfad.endsWith('/beschaffung/hochladen'))
}

beforeEach(async () => await laden())

const route = (methode, pfad) => routen.find(r => r.methode === methode && r.pfad === pfad)
const prueferVon = r => r.kette.filter(f => f.marke).map(f => f.marke)
const handlerVon = r => r.kette.at(-1).handler
const Q = '/spur/project/:project_id/quellen'

describe('Rechte der Routen', () => {
  it.each([
    ['get', Q, 'lesen', 'quellenListe'],
    ['get', `${Q}/suche`, 'lesen', 'quellenSuche'],
    ['get', `${Q}/export`, 'lesen', 'quellenExport'],
    ['get', `${Q}/semantik`, 'lesen', 'semantikStand'],
    ['post', `${Q}/semantik/indexieren`, 'schreiben', 'semantikIndexieren'],
    ['get', `${Q}/semantik/suche`, 'lesen', 'semantikSuchen'],
    ['get', `${Q}/:quelle_id/datei`, 'lesen', 'quelleDatei'],
    ['get', `${Q}/:quelle_id/seiten/:seite`, 'lesen', 'quelleSeite'],
    ['get', `${Q}/:quelle_id/seiten/:seite/bild`, 'lesen', 'quelleBild'],
    ['get', `${Q}/:quelle_id/zitate`, 'lesen', 'zitate'],
    ['post', `${Q}/:quelle_id/zitate/:zitat_id/kommentare`, 'lesen', 'zitatKommentieren'],
    ['delete', `${Q}/:quelle_id/zitate/:zitat_id/zuweisung`, 'lesen', 'zuweisungLoesen'],
    ['get', '/spur/project/:project_id/team', 'lesen', 'team'],
    ['post', `${Q}/:quelle_id/zitate/:zitat_id/bestaetigen`, 'pruefen', 'zitatBestaetigen'],
    ['post', `${Q}/:quelle_id/ocr`, 'schreiben', 'ocrStarten'],
    ['get', '/spur/project/:project_id/zitate/zugewiesen', 'lesen', 'zugewiesen'],
    ['get', '/spur/project/:project_id/pruefbericht', 'lesen', 'pruefbericht'],
    ['get', '/spur/project/:project_id/claude', 'lesen', 'claudeStatus'],
    ['post', '/spur/project/:project_id/claude/auftrag', 'lesen', 'claudeAuftrag'],
    ['post', Q, 'schreiben', 'quelleHochladen'],
    ['post', `${Q}/holen`, 'schreiben', 'quellenHolen'],
    ['post', `${Q}/web`, 'schreiben', 'webQuelleAufnehmen'],
    ['patch', `${Q}/:quelle_id`, 'schreiben', 'quelleAendern'],
    ['delete', `${Q}/:quelle_id`, 'schreiben', 'quelleLoeschen'],
    ['post', `${Q}/:quelle_id/zitate`, 'schreiben', 'zitatMarkieren'],
    ['post', `${Q}/:quelle_id/zitate/:zitat_id/einfuegen`, 'schreiben', 'zitatEinfuegen'],
    ['post', '/spur/project/:project_id/laeufe/:lauf_id/annehmen', 'schreiben', 'laufAnnehmen'],
    ['post', '/spur/project/:project_id/laeufe/:lauf_id/ablehnen', 'pruefen', 'laufAblehnen'],
    ['post', '/spur/project/:project_id/laeufe/:lauf_id/zuruecknehmen', 'schreiben', 'laufZuruecknehmen'],
    ['put', '/spur/project/:project_id/claude/automatik', 'schreiben', 'automatikSetzen'],
    ['post', '/spur/project/:project_id/claude/alles-annehmen', 'schreiben', 'allesAnnehmen'],
    ['get', '/spur/project/:project_id/claude/laeufe', 'lesen', 'claudeLaeufe'],
    ['get', '/spur/project/:project_id/recherche', 'lesen', 'rechercheSuchen'],
    ['get', '/spur/project/:project_id/recherche/zitationen', 'lesen', 'rechercheZitationen'],
    ['get', '/spur/project/:project_id/recherche/protokoll', 'lesen', 'suchprotokoll'],
    ['get', '/spur/project/:project_id/recherche/protokoll.csv', 'lesen', 'suchprotokollExport'],
    ['post', '/spur/project/:project_id/recherche/aufnehmen', 'schreiben', 'perDoiAufnehmen'],
    ['get', '/spur/project/:project_id/beschaffung', 'lesen', 'beschaffungsliste'],
    ['get', '/spur/project/:project_id/import/zotero', 'schreiben', 'zoteroSammlungen'],
    ['get', `${Q}/:quelle_id/notizen`, 'lesen', 'notizen'],
    ['put', `${Q}/:quelle_id/notizen`, 'schreiben', 'notizSetzen'],
    ['get', '/spur/project/:project_id/matrix', 'lesen', 'matrix'],
    ['get', '/spur/project/:project_id/offenlegung', 'lesen', 'offenlegung'],
    ['post', '/spur/project/:project_id/offenlegung/tex', 'schreiben', 'offenlegungTex'],
    ['get', '/spur/project/:project_id/matrix.csv', 'lesen', 'matrixExport'],
    ['post', '/spur/project/:project_id/matrix/spalten', 'schreiben', 'matrixSpalte'],
    ['put', '/spur/project/:project_id/matrix/zellen', 'schreiben', 'matrixZelle'],
    ['post', '/spur/project/:project_id/matrix/zellen/bestaetigen', 'schreiben', 'matrixBestaetigen'],
    ['post', '/spur/project/:project_id/matrix/zellen/verwerfen', 'schreiben', 'matrixVerwerfen'],
    ['post', '/spur/project/:project_id/import/zotero', 'schreiben', 'zoteroImportieren'],
    ['post', '/spur/project/:project_id/beschaffung', 'schreiben', 'beschaffungHinzufuegen'],
    ['get', '/spur/project/:project_id/beschaffung/export/:format', 'lesen', 'beschaffungExport'],
    ['post', '/spur/project/:project_id/beschaffung/:eintrag_id/zuordnen', 'schreiben', 'beschaffungZuordnen'],
  ])('%s %s verlangt Anmeldung, Ausschluss von Leselink-Nutzern und %s', (methode, pfad, recht, handler) => {
    const r = route(methode, pfad)
    expect(r, `${methode} ${pfad}`).toBeTruthy()
    expect(prueferVon(r)).toEqual(['angemeldet', 'eingeschraenkt', recht])
    expect(handlerVon(r)).toBe(handler)
  })

  it.each([
    ['get', '/spur/claude/tokens', 'claudeTokens'],
    ['post', '/spur/claude/tokens', 'claudeTokenErzeugen'],
    ['delete', '/spur/claude/tokens/:token_id', 'claudeTokenWiderrufen'],
    ['put', '/spur/beschaffung/vorlage', 'bibliotheksvorlageSetzen'],
  ])('%s %s verlangt nur die Anmeldung', (methode, pfad, handler) => {
    const r = route(methode, pfad)
    expect(prueferVon(r)).toEqual(['angemeldet'])
    expect(handlerVon(r)).toBe(handler)
  })

  it.each([
    ['get', '/spur/admin/grenzen', ['admin'], 'seite'],
    ['get', '/spur/admin/grenzen.json', ['angemeldet'], 'daten'],
    ['put', '/spur/admin/grenzen/standard', ['angemeldet'], 'standardSetzen'],
    ['put', '/spur/admin/grenzen/nutzer/:user_id', ['angemeldet'], 'nutzerSetzen'],
    ['post', '/spur/admin/grenzen/projekt/:project_id/neu-berechnen', ['angemeldet'], 'neuBerechnen'],
    ['get', '/spur/grenzen/projekte', ['angemeldet'], 'meineProjekte'],
    ['get', '/spur/project/:project_id/speicher', ['angemeldet', 'eingeschraenkt', 'lesen'], 'projektSpeicher'],
  ])('Grenzen: %s %s prüft %j', (methode, pfad, pruefer, handler) => {
    const r = route(methode, pfad)
    expect(prueferVon(r)).toEqual(pruefer)
    expect(handlerVon(r)).toBe(handler)
  })

  it('antwortet Nicht-Admins an den Grenzen-Routen mit 403 statt einer Umleitung', async () => {
    for (const [methode, pfad] of [['put', '/spur/admin/grenzen/standard'], ['get', '/spur/admin/grenzen.json']]) {
      const pruefung = route(methode, pfad).kette.at(-2)
      const res = new Antwort()
      const next = vi.fn()
      await pruefung(anfrage({ session: { userId: 'nutzer-id' } }), res, next)
      expect(res.statusCode, pfad).toBe(403)
      expect(next).not.toHaveBeenCalled()
      await pruefung(anfrage({ session: { userId: 'admin-id' } }), new Antwort(), next)
      expect(next).toHaveBeenCalledWith()
    }
  })

  it('nimmt Uploads per Einmal-Link öffentlich an: erst Link prüfen, dann Datei, dann Aufnahme', () => {
    const r = routen.find(x => x.methode === 'post' && x.pfad === '/spur/hochladen/:token')
    expect(r.kette.map(f => f.handler ?? f.name)).toEqual(['linkPruefen', 'hochladenMitGrenze', 'hochladen'])
    expect(handlerVon(routen.find(x => x.methode === 'post' && x.pfad === '/spur/hochladen'))).toBe('ohneToken')
  })

  it('führt MCP öffentlich, ohne Sitzung: Das Token entscheidet', () => {
    const r = route('all', '/spur/mcp')
    expect(r.oeffentlich).toBe(true)
    expect(prueferVon(r)).toEqual([])
    expect(handlerVon(r)).toBe('mcpAnfrage')
  })

  it('registriert die Dev-Routen (Paper-Fake mit TeX-Live-Fake, Testseite, Zeit, E2E-Daten, Mail-Fake) nur in der Dev-Umgebung', async () => {
    const dev = [
      ['use', '/spur/dev/crossref', 'paperFake'],
      ['get', '/spur/dev/web/testseite', 'testseite'],
      ['post', '/spur/dev/zeit', 'zeitSetzen'],
      ['post', '/spur/dev/e2e/vorbereiten', 'e2eVorbereiten'],
      ['post', '/spur/dev/mail', 'mailFakeSteuern'],
      ['get', '/spur/dev/mail', 'mailFakeLesen'],
      ['post', '/spur/dev/quelle-vergroessern', 'quelleVergroessern'],
    ]
    for (const [methode, pfad] of dev) expect(route(methode, pfad)).toBeUndefined()
    await laden({ dev: true })
    for (const [methode, pfad, handler] of dev) expect(handlerVon(route(methode, pfad))).toBe(handler)
    expect(handlerVon(route('get', '/spur/dev/proxy-pdf/output.pdf'))).toBe('proxySperre:SPUR_PROXY_PDF')
    expect(handlerVon(route('post', '/project/:Project_id/compile'))).toBe('pdfUmleiten')
    const quellen = routen.filter(r => r.methode === 'get' && r.pfad === '/spur/project/:project_id/quellen')
    expect(quellen.map(handlerVon)).toEqual(['proxySperre:SPUR_PROXY_API', 'quellenListe'])
    const automatik = routen.filter(r => r.methode === 'put' && r.pfad === '/spur/project/:project_id/claude/automatik')
    expect(automatik.map(handlerVon)).toEqual(['speicherFehler:SPUR_AUTOMATIK_FEHLER', 'automatikSetzen'])
    const claude = routen.filter(r => r.methode === 'get' && r.pfad === '/spur/project/:project_id/claude')
    expect(claude.map(handlerVon)).toEqual(['proxySperre:SPUR_CLAUDE_FEHLER', 'claudeStatus'])
    const zellen = routen.filter(r => r.methode === 'put' && r.pfad === '/spur/project/:project_id/matrix/zellen')
    expect(zellen.map(handlerVon).at(0)).toBe('speicherFehler:SPUR_MATRIX_FEHLER')
    const bericht = routen.filter(r => r.methode === 'get' && r.pfad === '/spur/project/:project_id/pruefbericht')
    expect(bericht.map(handlerVon).at(0)).toBe('proxySperre:SPUR_PRUEFBERICHT_FEHLER')
    const bild = routen.filter(r => r.methode === 'get' && r.pfad === '/spur/project/:project_id/quellen/:quelle_id/seiten/:seite/bild')
    expect(bild.map(handlerVon)).toEqual(['proxySperre:SPUR_SEITENBILD_FEHLER', 'quelleBild'])
  })
})

it('lädt PDFs für die Beschaffungsliste mit Schreibrecht und derselben Größengrenze hoch', () => {
  const r = marken.beschaffungHochladen
  expect(prueferVon(r)).toEqual(['angemeldet', 'eingeschraenkt', 'schreiben'])
  expect(r.kette.at(-2)).toBe(hochladen)
  expect(handlerVon(r)).toBe('beschaffungHochladen')
})

describe('Hochladen mit Fehlerbehandlung', () => {
  const ausfuehren = async fehler => {
    multerFehler = fehler
    const res = new Antwort()
    const next = vi.fn()
    hochladen(anfrage(), res, next)
    await new Promise(r => setImmediate(r))
    return { res, next }
  }

  it('erwartet das Feld „datei“ und begrenzt die Größe auf 50 MB', () => {
    expect(marken.multerFeld).toBe('datei')
    expect(marken.multerOptionen.limits).toEqual({ fileSize: MAX })
  })

  it('reicht eine gute Anfrage weiter', async () => {
    const { next, res } = await ausfuehren(null)
    expect(next).toHaveBeenCalledWith(null)
    expect(res.body).toBeUndefined()
  })

  it('antwortet auf einen Upload ohne Feld „datei“ mit 400 als RFC-9457-Problem', async () => {
    const fehler = Object.assign(new Error('Unexpected field'), { name: 'MulterError', code: 'LIMIT_UNEXPECTED_FILE' })
    const { res, next } = await ausfuehren(fehler)
    expect(res.statusCode).toBe(400)
    expect(res.kopfzeilen['Content-Type']).toBe('application/problem+json')
    expect(res.body).toMatchObject({ type: 'urn:spur:problem:datei_fehlt', title: 'datei_fehlt', status: 400 })
    expect(next).not.toHaveBeenCalled()
  })

  it('antwortet auf kaputtes Multipart mit 400 statt 500', async () => {
    const { res, next } = await ausfuehren(new Error('Multipart: Boundary not found'))
    expect(res.statusCode).toBe(400)
    expect(res.body.type).toBe('urn:spur:problem:datei_fehlt')
    expect(next).not.toHaveBeenCalled()
  })

  it('antwortet auf zu große Dateien mit 413', async () => {
    const { res } = await ausfuehren(Object.assign(new Error('File too large'), { name: 'MulterError', code: 'LIMIT_FILE_SIZE' }))
    expect(res.statusCode).toBe(413)
    expect(res.body).toMatchObject({ type: 'urn:spur:problem:zu_gross', status: 413 })
  })

  it('reicht unerwartete Fehler an Express weiter', async () => {
    const fehler = new Error('Platte voll')
    const { next, res } = await ausfuehren(fehler)
    expect(next).toHaveBeenCalledWith(fehler)
    expect(res.body).toBeUndefined()
  })
})

it('begrenzt Aufrufe der Paper-Dienste je Nutzer', () => {
  for (const [methode, pfad] of [
    ['get', '/spur/project/:project_id/recherche'],
    ['get', '/spur/project/:project_id/recherche/zitationen'],
    ['post', '/spur/project/:project_id/recherche/aufnehmen'],
    ['post', '/spur/project/:project_id/beschaffung'],
    ['get', `${Q}/semantik/suche`],
  ]) {
    expect(route(methode, pfad).kette.some(f => f.limiter === 'spur-recherche'), pfad).toBe(true)
  }
})
