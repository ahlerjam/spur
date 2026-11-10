// Einmal-Links, über die Claude Code PDFs vom Rechner der Nutzer direkt an spur schickt (nicht über MCP).
// Gespeichert wird nur der Hash des Tokens; jeder Upload verbraucht atomar einen von 50 Plätzen.
import { createHash, randomBytes } from 'node:crypto'
import Settings from '@overleaf/settings'
import { Problem } from '../probleme.mjs'
import { uploadLinks as links } from '../sammlungen.mjs'
import { jetzt } from '../schalter.mjs'

export const GUELTIG_MINUTEN = 15
export const MAX_DATEIEN = 50

const hash = token => createHash('sha256').update(token).digest('hex')

export async function erzeugen({ projectId, menschId, botId }) {
  const token = randomBytes(32).toString('hex')
  const ablauf = new Date(jetzt().getTime() + GUELTIG_MINUTEN * 60 * 1000)
  await (await links()).insertOne({ hash: hash(token), projectId, menschId, botId, ablauf, genutzt: 0 })
  return {
    link: `${Settings.siteUrl}/spur/hochladen/${token}`,
    gueltig_minuten: GUELTIG_MINUTEN,
    max_dateien: MAX_DATEIEN,
    gueltig_bis: ablauf.toISOString(),
  }
}

function ungueltig() {
  return new Problem(401, 'token', 'spur_fehler_link_ungueltig')
}

function grund(link) {
  return link.ablauf <= jetzt()
    ? new Problem(410, 'link_abgelaufen', 'spur_fehler_link_abgelaufen')
    : new Problem(410, 'link_verbraucht', 'spur_fehler_link_verbraucht', { max: MAX_DATEIEN })
}

// Prüft ohne zu verbrauchen, damit ein ungültiger Link gar nicht erst eine Datei annimmt.
export async function pruefen(token) {
  if (typeof token !== 'string' || !/^[0-9a-f]{64}$/.test(token)) throw ungueltig()
  const link = await (await links()).findOne({ hash: hash(token) })
  if (!link) throw ungueltig()
  if (link.ablauf <= jetzt() || link.genutzt >= MAX_DATEIEN) throw grund(link)
  return link
}

export async function verbrauchen(token) {
  const link = await pruefen(token)
  const verbraucht = await (await links()).findOneAndUpdate(
    { _id: link._id, genutzt: { $lt: MAX_DATEIEN }, ablauf: { $gt: jetzt() } },
    { $inc: { genutzt: 1 } },
    { returnDocument: 'after' }
  )
  if (!verbraucht) throw grund(await (await links()).findOne({ _id: link._id }))
  return verbraucht
}
