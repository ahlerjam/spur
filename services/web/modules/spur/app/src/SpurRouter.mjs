import Settings from '@overleaf/settings'
import AuthorizationMiddleware from '../../../../app/src/Features/Authorization/AuthorizationMiddleware.mjs'
import AuthenticationController from '../../../../app/src/Features/Authentication/AuthenticationController.mjs'
import { multerUploadHandler } from '../../../../app/src/infrastructure/Multer.mjs'
import { Problem, problemSenden } from './probleme.mjs'
import { MAX_BYTES } from './QuellenManager.mjs'
import { IST_DEV } from './schalter.mjs'
import * as SpurController from './SpurController.mjs'
import { crossrefFake } from './dev/CrossrefFake.mjs'
import { mcpAnfrage } from './mcp/McpEndpunkt.mjs'

const lesen = [
  AuthenticationController.requireLogin(),
  AuthorizationMiddleware.blockRestrictedUserFromProject,
  AuthorizationMiddleware.ensureUserCanReadProject,
]
const pruefen = [
  AuthenticationController.requireLogin(),
  AuthorizationMiddleware.blockRestrictedUserFromProject,
  AuthorizationMiddleware.ensureUserCanWriteOrReviewProjectContent,
]
const schreiben = [
  AuthenticationController.requireLogin(),
  AuthorizationMiddleware.blockRestrictedUserFromProject,
  AuthorizationMiddleware.ensureUserCanWriteProjectContent,
]

const angemeldet = AuthenticationController.requireLogin()

const upload = multerUploadHandler({
  dest: Settings.path.uploadFolder,
  limits: { fileSize: MAX_BYTES },
}).single('datei')

function hochladenMitGrenze(req, res, next) {
  upload(req, res, error => {
    if (error?.code === 'LIMIT_FILE_SIZE') {
      problemSenden(
        res,
        new Problem(413, 'zu_gross', 'Datei ist größer als 50 MB. Bitte verkleinern.')
      )
    } else if (error?.name === 'MulterError' || error?.message?.startsWith('Multipart')) {
      // Falsches Feld, kaputtes Multipart: Fehler des Aufrufers, kein 500.
      problemSenden(
        res,
        new Problem(400, 'datei_fehlt', 'Es kam keine Datei im Feld „datei“ an. Bitte erneut hochladen.')
      )
    } else {
      next(error)
    }
  })
}

const QUELLEN = '/spur/project/:project_id/quellen'

export default {
  apply(webRouter, _privateApiRouter, publicApiRouter) {
    webRouter.get(QUELLEN, ...lesen, SpurController.quellenListe)
    webRouter.post(QUELLEN, ...schreiben, hochladenMitGrenze, SpurController.quelleHochladen)
    webRouter.get(`${QUELLEN}/suche`, ...lesen, SpurController.quellenSuche)
    webRouter.get(`${QUELLEN}/export`, ...lesen, SpurController.quellenExport)
    webRouter.get(`${QUELLEN}/andere`, ...lesen, SpurController.andereProjekte)
    webRouter.post(`${QUELLEN}/holen`, ...schreiben, SpurController.quellenHolen)
    webRouter.delete(`${QUELLEN}/:quelle_id`, ...schreiben, SpurController.quelleLoeschen)
    webRouter.get(`${QUELLEN}/:quelle_id/zitate`, ...lesen, SpurController.zitate)
    webRouter.post(`${QUELLEN}/:quelle_id/zitate`, ...schreiben, SpurController.zitatMarkieren)
    // Kommentieren dürfen wie in Overleaf alle Mitglieder, auch mit Leserecht.
    webRouter.post(
      `${QUELLEN}/:quelle_id/zitate/:zitat_id/kommentare`,
      ...lesen,
      SpurController.zitatKommentieren
    )
    webRouter.delete(
      `${QUELLEN}/:quelle_id/zitate/:zitat_id/zuweisung`,
      ...lesen,
      SpurController.zuweisungLoesen
    )
    webRouter.post(
      `${QUELLEN}/:quelle_id/zitate/:zitat_id/bestaetigen`,
      ...pruefen,
      SpurController.zitatBestaetigen
    )
    webRouter.post(`${QUELLEN}/:quelle_id/ocr`, ...schreiben, SpurController.ocrStarten)
    webRouter.get('/spur/project/:project_id/team', ...lesen, SpurController.team)
    webRouter.get('/spur/project/:project_id/zitate/zugewiesen', ...lesen, SpurController.zugewiesen)
    webRouter.post(
      `${QUELLEN}/:quelle_id/zitate/:zitat_id/einfuegen`,
      ...schreiben,
      SpurController.zitatEinfuegen
    )
    webRouter.get(`${QUELLEN}/:quelle_id/seiten/:seite`, ...lesen, SpurController.quelleSeite)
    webRouter.get(`${QUELLEN}/:quelle_id/seiten/:seite/bild`, ...lesen, SpurController.quelleBild)
    webRouter.get(`${QUELLEN}/:quelle_id/datei`, ...lesen, SpurController.quelleDatei)
    webRouter.patch(`${QUELLEN}/:quelle_id`, ...schreiben, SpurController.quelleAendern)
    webRouter.get('/spur/project/:project_id/pruefbericht', ...lesen, SpurController.pruefbericht)
    webRouter.get('/spur/project/:project_id/claude', ...lesen, SpurController.claudeStatus)
    webRouter.post('/spur/project/:project_id/claude/auftrag', ...lesen, SpurController.claudeAuftrag)
    const LAUF = '/spur/project/:project_id/laeufe/:lauf_id'
    webRouter.post(`${LAUF}/annehmen`, ...schreiben, SpurController.laufAnnehmen)
    webRouter.post(`${LAUF}/ablehnen`, ...pruefen, SpurController.laufAblehnen)
    webRouter.post(`${LAUF}/zuruecknehmen`, ...schreiben, SpurController.laufZuruecknehmen)
    webRouter.put('/spur/project/:project_id/claude/automatik', ...schreiben, SpurController.automatikSetzen)
    webRouter.get('/spur/claude/tokens', angemeldet, SpurController.claudeTokens)
    webRouter.post('/spur/claude/tokens', angemeldet, SpurController.claudeTokenErzeugen)
    webRouter.delete('/spur/claude/tokens/:token_id', angemeldet, SpurController.claudeTokenWiderrufen)
    publicApiRouter.all('/spur/mcp', mcpAnfrage)
    if (IST_DEV) publicApiRouter.get('/spur/dev/crossref/works/:doi', crossrefFake)
  },
}
