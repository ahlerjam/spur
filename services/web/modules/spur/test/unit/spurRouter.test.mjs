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
    },
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
  vi.doMock('../../app/src/SpurController.mjs', () =>
    new Proxy({}, { get: (ziel, name) => (name === 'then' || typeof name === 'symbol' ? undefined : (ziel[name] ??= Object.assign(() => {}, { handler: name }))) })
  )
  vi.doMock('../../app/src/dev/PaperFake.mjs', () => ({ paperFake: Object.assign(() => {}, { handler: 'paperFake' }) }))
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
    ['get', '/spur/project/:project_id/pruefbericht', 'lesen', 'pruefbericht'],
    ['get', '/spur/project/:project_id/claude', 'lesen', 'claudeStatus'],
    ['post', '/spur/project/:project_id/claude/auftrag', 'lesen', 'claudeAuftrag'],
    ['post', Q, 'schreiben', 'quelleHochladen'],
    ['post', `${Q}/holen`, 'schreiben', 'quellenHolen'],
    ['patch', `${Q}/:quelle_id`, 'schreiben', 'quelleAendern'],
    ['delete', `${Q}/:quelle_id`, 'schreiben', 'quelleLoeschen'],
    ['post', `${Q}/:quelle_id/zitate`, 'schreiben', 'zitatMarkieren'],
    ['post', `${Q}/:quelle_id/zitate/:zitat_id/einfuegen`, 'schreiben', 'zitatEinfuegen'],
    ['post', '/spur/project/:project_id/laeufe/:lauf_id/annehmen', 'schreiben', 'laufAnnehmen'],
    ['post', '/spur/project/:project_id/laeufe/:lauf_id/ablehnen', 'pruefen', 'laufAblehnen'],
    ['post', '/spur/project/:project_id/laeufe/:lauf_id/zuruecknehmen', 'schreiben', 'laufZuruecknehmen'],
    ['put', '/spur/project/:project_id/claude/automatik', 'schreiben', 'automatikSetzen'],
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

  it('führt MCP öffentlich, ohne Sitzung: Das Token entscheidet', () => {
    const r = route('all', '/spur/mcp')
    expect(r.oeffentlich).toBe(true)
    expect(prueferVon(r)).toEqual([])
    expect(handlerVon(r)).toBe('mcpAnfrage')
  })

  it('hängt den Paper-Fake nur in der Dev-Umgebung ein', async () => {
    expect(route('use', '/spur/dev/crossref')).toBeUndefined()
    await laden({ dev: true })
    expect(handlerVon(route('use', '/spur/dev/crossref'))).toBe('paperFake')
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
  ]) {
    expect(route(methode, pfad).kette.some(f => f.limiter === 'spur-recherche'), pfad).toBe(true)
  }
})
