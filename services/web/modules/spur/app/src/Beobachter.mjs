// Beobachtet Kommentare und Compiles im Editor, ohne Overleafs Controller anzupassen (ADR 0001: wenige Kern-Patches).
import logger from '@overleaf/logger'
import SessionManager from '../../../../app/src/Features/Authentication/SessionManager.mjs'
import { ObjectId } from '../../../../app/src/infrastructure/mongodb.mjs'
import * as Erwaehnung from './erwaehnung/Erwaehnung.mjs'
import * as Kompilieren from './kompilieren/Kompilieren.mjs'
import * as Vorschlaege from './vorschlaege/Vorschlaege.mjs'

const KOMMENTAR = /^\/project\/([0-9a-f]{24})\/thread\/([0-9a-f]{24})\/messages$/
const COMPILE = /^\/project\/([0-9a-f]{24})\/compile$/

// Läuft nach der Antwort; ein Fehler darf den Editor nicht stören.
function nebenbei(arbeit, was) {
  arbeit.catch(error => logger.warn({ err: error }, `spur: ${was} fehlgeschlagen`))
}

// Overleaf CE nennt den Build nur je Ausgabedatei; andere Fassungen liefern buildId oben.
const buildVon = antwort => antwort?.buildId ?? antwort?.outputFiles?.find(f => f.path === 'output.log')?.build

function nachCompile(projectId, menschId, buildId, clsiServerId) {
  return Vorschlaege.ausloesen({
    projectId,
    menschId,
    art: 'compile_fehler',
    daten: async () => {
      const fehler = await Kompilieren.fehlerDesCompiles({ projectId, menschId, buildId, clsiServerId })
      return fehler.length ? { fehler } : null
    },
  })
}

export function beobachten(req, res, next) {
  if (req.method !== 'POST') return next()
  const kommentar = KOMMENTAR.exec(req.path)
  if (kommentar) {
    res.on('finish', () => {
      const menschId = SessionManager.getLoggedInUserId(req.session)
      if (res.statusCode !== 204 || !menschId || typeof req.body?.content !== 'string') return
      nebenbei(
        Erwaehnung.kommentarGesendet({
          projectId: new ObjectId(kommentar[1]),
          threadId: kommentar[2],
          menschId: new ObjectId(String(menschId)),
          text: req.body.content,
        }),
        '@claude im Kommentar'
      )
    })
  }
  const compile = COMPILE.exec(req.path)
  // Nur Compiles per Knopf; Auto-Compiles liefen bei jeder Pause und fräßen das Tageslimit.
  if (compile && !req.query?.auto_compile) {
    const senden = res.json.bind(res)
    res.json = body => {
      const menschId = SessionManager.getLoggedInUserId(req.session)
      const buildId = buildVon(body)
      if (menschId && buildId) {
        nebenbei(
          nachCompile(new ObjectId(compile[1]), new ObjectId(String(menschId)), buildId, body.clsiServerId),
          'Vorschlag nach Compile'
        )
      }
      return senden(body)
    }
  }
  next()
}
