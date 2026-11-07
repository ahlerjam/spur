import SpurRouter from './app/src/SpurRouter.mjs'
import * as QuellenManager from './app/src/QuellenManager.mjs'

const SpurModule = {
  router: SpurRouter,
  hooks: {
    promises: {
      projectExpired: QuellenManager.projektAufraeumen,
      projectDuplicated: ({ originalProjectId, newProjectId }) =>
        QuellenManager.klonMerken(originalProjectId, newProjectId),
    },
  },
}

export default SpurModule
