import Settings from '@overleaf/settings'
import AuthorizationMiddleware from '../../../../app/src/Features/Authorization/AuthorizationMiddleware.mjs'
import AuthenticationController from '../../../../app/src/Features/Authentication/AuthenticationController.mjs'
import { multerUploadHandler } from '../../../../app/src/infrastructure/Multer.mjs'
import { Problem, problemSenden } from './probleme.mjs'
import { MAX_BYTES } from './QuellenManager.mjs'
import { IST_DEV } from './schalter.mjs'
import * as SpurController from './SpurController.mjs'
import { paperFake } from './dev/PaperFake.mjs'
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
    webRouter.get(`${QUELLEN}/semantik`, ...lesen, SpurController.semantikStand)
    webRouter.post(`${QUELLEN}/semantik/indexieren`, ...lesen, SpurController.semantikIndexieren)
    webRouter.get(`${QUELLEN}/semantik/suche`, ...lesen, SpurController.semantikSuchen)
    webRouter.get(`${QUELLEN}/export`, ...lesen, SpurController.quellenExport)
    webRouter.get(`${QUELLEN}/andere`, ...lesen, SpurController.andereProjekte)
    webRouter.post(`${QUELLEN}/holen`, ...schreiben, SpurController.quellenHolen)
    webRouter.delete(`${QUELLEN}/:quelle_id`, ...schreiben, SpurController.quelleLoeschen)
    webRouter.get(`${QUELLEN}/:quelle_id/zitate`, ...lesen, SpurController.zitate)
    webRouter.get(`${QUELLEN}/:quelle_id/notizen`, ...lesen, SpurController.notizen)
    webRouter.put(`${QUELLEN}/:quelle_id/notizen`, ...schreiben, SpurController.notizSetzen)
    webRouter.post(`${QUELLEN}/:quelle_id/zitate`, ...schreiben, SpurController.zitatMarkieren)
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
    const RECHERCHE = '/spur/project/:project_id/recherche'
    webRouter.get(RECHERCHE, ...lesen, SpurController.rechercheSuchen)
    webRouter.get(`${RECHERCHE}/zitationen`, ...lesen, SpurController.rechercheZitationen)
    webRouter.get(`${RECHERCHE}/protokoll`, ...lesen, SpurController.suchprotokoll)
    webRouter.get(`${RECHERCHE}/protokoll.csv`, ...lesen, SpurController.suchprotokollExport)
    webRouter.post(`${RECHERCHE}/aufnehmen`, ...schreiben, SpurController.perDoiAufnehmen)
    const BESCHAFFUNG = '/spur/project/:project_id/beschaffung'
    webRouter.get(BESCHAFFUNG, ...lesen, SpurController.beschaffungsliste)
    webRouter.post(BESCHAFFUNG, ...schreiben, SpurController.beschaffungHinzufuegen)
    webRouter.get(`${BESCHAFFUNG}/export/:format`, ...lesen, SpurController.beschaffungExport)
    webRouter.post(`${BESCHAFFUNG}/hochladen`, ...schreiben, hochladenMitGrenze, SpurController.beschaffungHochladen)
    webRouter.post(`${BESCHAFFUNG}/:eintrag_id/zuordnen`, ...schreiben, SpurController.beschaffungZuordnen)
    const MATRIX = '/spur/project/:project_id/matrix'
    webRouter.get(MATRIX, ...lesen, SpurController.matrix)
    webRouter.get(`${MATRIX}.csv`, ...lesen, SpurController.matrixExport)
    webRouter.post(`${MATRIX}/spalten`, ...schreiben, SpurController.matrixSpalte)
    webRouter.put(`${MATRIX}/zellen`, ...schreiben, SpurController.matrixZelle)
    webRouter.post(`${MATRIX}/zellen/bestaetigen`, ...schreiben, SpurController.matrixBestaetigen)
    webRouter.post(`${MATRIX}/zellen/verwerfen`, ...schreiben, SpurController.matrixVerwerfen)
    webRouter.get('/spur/project/:project_id/offenlegung', ...lesen, SpurController.offenlegung)
    webRouter.post('/spur/project/:project_id/offenlegung/tex', ...schreiben, SpurController.offenlegungTex)
    webRouter.get('/spur/project/:project_id/import/zotero', ...schreiben, SpurController.zoteroSammlungen)
    webRouter.post('/spur/project/:project_id/import/zotero', ...schreiben, SpurController.zoteroImportieren)
    webRouter.put('/spur/beschaffung/vorlage', angemeldet, SpurController.bibliotheksvorlageSetzen)
    webRouter.get('/spur/claude/tokens', angemeldet, SpurController.claudeTokens)
    webRouter.post('/spur/claude/tokens', angemeldet, SpurController.claudeTokenErzeugen)
    webRouter.delete('/spur/claude/tokens/:token_id', angemeldet, SpurController.claudeTokenWiderrufen)
    publicApiRouter.all('/spur/mcp', mcpAnfrage)
    if (IST_DEV) publicApiRouter.use('/spur/dev/crossref', paperFake)
  },
}
