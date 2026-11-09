import logger from '@overleaf/logger'
// Schützt den Web-Prozess vor abgebrochenen Downloads statischer Dateien (siehe Datei).
import './app/src/sendSchutz.mjs'
import SpurRouter from './app/src/SpurRouter.mjs'
import * as QuellenManager from './app/src/QuellenManager.mjs'
import * as ClaudeZugang from './app/src/ClaudeZugang.mjs'
import { mcpJson } from './app/src/mcp/McpEndpunkt.mjs'
import { beobachten } from './app/src/Beobachter.mjs'

const SpurModule = {
  router: SpurRouter,
  appMiddleware(app) {
    app.use('/spur/mcp', mcpJson)
    app.use(beobachten)
  },
  hooks: {
    promises: {
      projectExpired: QuellenManager.projektAufraeumen,
      deleteUser: ClaudeZugang.kontoAufraeumen,
      expireDeletedUser: ClaudeZugang.kontoAufraeumen,
      // Der Hinweis im Klon ist ein Nebeneffekt: Er darf das Duplizieren nicht scheitern lassen.
      projectDuplicated: ({ originalProjectId, newProjectId }) =>
        QuellenManager.klonMerken(originalProjectId, newProjectId).catch(error =>
          logger.warn({ err: error, originalProjectId, newProjectId }, 'spur: Klon nicht vermerkt')
        ),
    },
  },
}

export default SpurModule
