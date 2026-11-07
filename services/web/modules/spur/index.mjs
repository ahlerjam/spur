import SpurRouter from './app/src/SpurRouter.mjs'
import * as QuellenManager from './app/src/QuellenManager.mjs'
import * as ClaudeZugang from './app/src/ClaudeZugang.mjs'

const SpurModule = {
  router: SpurRouter,
  hooks: {
    promises: {
      projectExpired: QuellenManager.projektAufraeumen,
      deleteUser: ClaudeZugang.kontoAufraeumen,
      expireDeletedUser: ClaudeZugang.kontoAufraeumen,
      projectDuplicated: ({ originalProjectId, newProjectId }) =>
        QuellenManager.klonMerken(originalProjectId, newProjectId),
    },
  },
}

export default SpurModule
