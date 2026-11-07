import AuthorizationMiddleware from '../../../../app/src/Features/Authorization/AuthorizationMiddleware.mjs'
import AuthenticationController from '../../../../app/src/Features/Authentication/AuthenticationController.mjs'
import { multerUploadHandler } from '../../../../app/src/infrastructure/Multer.mjs'
import { Problem, problemSenden } from './probleme.mjs'
import { MAX_BYTES } from './QuellenManager.mjs'
import { IST_DEV } from './schalter.mjs'
import * as SpurController from './SpurController.mjs'
import { crossrefFake } from './dev/CrossrefFake.mjs'

const lesen = [
  AuthenticationController.requireLogin(),
  AuthorizationMiddleware.blockRestrictedUserFromProject,
  AuthorizationMiddleware.ensureUserCanReadProject,
]
const schreiben = [
  AuthenticationController.requireLogin(),
  AuthorizationMiddleware.blockRestrictedUserFromProject,
  AuthorizationMiddleware.ensureUserCanWriteProjectContent,
]

const upload = multerUploadHandler({ limits: { fileSize: MAX_BYTES } }).single('datei')

function hochladenMitGrenze(req, res, next) {
  upload(req, res, error => {
    if (error?.code === 'LIMIT_FILE_SIZE') {
      problemSenden(
        res,
        new Problem(413, 'zu_gross', 'Datei ist größer als 50 MB. Bitte verkleinern.')
      )
    } else {
      next(error)
    }
  })
}

const QUELLEN = '/spur/project/:project_id/quellen'

export default {
  apply(webRouter, privateApiRouter, publicApiRouter) {
    webRouter.get(QUELLEN, ...lesen, SpurController.quellenListe)
    webRouter.post(QUELLEN, ...schreiben, hochladenMitGrenze, SpurController.quelleHochladen)
    webRouter.get(`${QUELLEN}/suche`, ...lesen, SpurController.quellenSuche)
    webRouter.get(`${QUELLEN}/:quelle_id/seiten/:seite`, ...lesen, SpurController.quelleSeite)
    webRouter.get(`${QUELLEN}/:quelle_id/seiten/:seite/bild`, ...lesen, SpurController.quelleBild)
    webRouter.get(`${QUELLEN}/:quelle_id/datei`, ...lesen, SpurController.quelleDatei)
    webRouter.patch(`${QUELLEN}/:quelle_id`, ...schreiben, SpurController.quelleAendern)
    webRouter.get('/spur/project/:project_id/pruefbericht', ...lesen, SpurController.pruefbericht)
    if (IST_DEV) publicApiRouter.get('/spur/dev/crossref/works/:doi', crossrefFake)
  },
}
