import { createRequire } from 'node:module'
import logger from '@overleaf/logger'

// Overleaf patcht `send` (.yarn/patches/send-npm-0.19.0.patch) auf Stream.pipeline(datei, res).
// Unter Node 24 wirft pipeline synchron ERR_STREAM_UNABLE_TO_PIPE, wenn der Browser den Download
// schon abgebrochen hat. Der Wurf passiert in einem fs.stat-Callback, ServeStaticWrapper sieht ihn
// nicht, und der Web-Prozess stürzt ab. Betroffen sind alle /js-Bundles: nginx reicht sie an Express
// durch (server-ce/nginx/overleaf.conf.template, `location /`). Ohne Kern-Patch und ohne neues
// Image: Ist die Antwort schon zu, wird nichts mehr gestreamt; ein später Wurf wird abgefangen.
// Übergang: Die eigentliche Korrektur gehört in den Yarn-Patch (res.destroyed prüfen) und braucht
// einen neuen Lauf des Workflows „Dev image“; danach kann diese Datei weg.
const ausExpress = createRequire(createRequire(import.meta.url).resolve('express'))

function sendVon(pfad) {
  try {
    return ausExpress(pfad)
  } catch {
    return null
  }
}

const serveStatic = createRequire(ausExpress.resolve('serve-static'))
const kandidaten = new Set([sendVon('send'), serveStatic('send')].filter(Boolean))

for (const send of kandidaten) {
  // send 0.19 exportiert SendStream nicht überall; der Prototyp eines Objekts ist derselbe.
  const proto = send.SendStream?.prototype ?? Object.getPrototypeOf(send({ headers: {} }, '/'))
  if (!proto) continue
  const stream = proto.stream
  proto.stream = function (pfad, optionen) {
    if (this.res.destroyed || this.res.writableEnded) return
    try {
      return stream.call(this, pfad, optionen)
    } catch (error) {
      if (error.code !== 'ERR_STREAM_UNABLE_TO_PIPE') throw error
      logger.debug({ err: error, pfad }, 'Download abgebrochen, Datei nicht mehr gesendet')
    }
  }
}

if (!kandidaten.size) logger.warn({}, 'spur: send nicht gefunden, abgebrochene Downloads bleiben ungeschützt')
