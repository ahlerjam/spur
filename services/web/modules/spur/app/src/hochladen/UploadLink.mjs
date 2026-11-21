// Einmal-Links, über die Claude Code Dateien vom Rechner der Nutzer direkt an spur schickt (nicht über MCP): PDFs als
// Quellen (art „quelle“, 50 Plätze) oder Bilder als Projektdateien (art „datei“, 20 Plätze). Gespeichert wird nur der
// Hash des Tokens; jeder Upload verbraucht atomar einen Platz.
import { createHash, randomBytes } from 'node:crypto'
import Settings from '@overleaf/settings'
import { Problem } from '../probleme.mjs'
import { uploadLinks as links } from '../sammlungen.mjs'
import { jetzt } from '../schalter.mjs'

export const GUELTIG_MINUTEN = 15
export const MAX_DATEIEN = 50
export const MAX_PROJEKTDATEIEN = 20
const MAX = { quelle: MAX_DATEIEN, datei: MAX_PROJEKTDATEIEN }

const hash = token => createHash('sha256').update(token).digest('hex')

// Links von vor P15 tragen weder Art noch Höchstzahl: Sie sind für Quellen.
const maxVon = link => link.max ?? MAX_DATEIEN
export async function erzeugen({ projectId, menschId, botId, art = 'quelle' }) {
  const token = randomBytes(32).toString('hex')
  const ablauf = new Date(jetzt().getTime() + GUELTIG_MINUTEN * 60 * 1000)
  await (await links()).insertOne({ hash: hash(token), projectId, menschId, botId, art, max: MAX[art], ablauf, genutzt: 0 })
  return {
    link: `${Settings.siteUrl}/spur/hochladen/${token}`,
    gueltig_minuten: GUELTIG_MINUTEN,
    max_dateien: MAX[art],
    gueltig_bis: ablauf.toISOString(),
  }
}

export function ungueltig() {
  return new Problem(401, 'token', 'spur_fehler_link_ungueltig')
}

function grund(link) {
  return link.ablauf <= jetzt()
    ? new Problem(410, 'link_abgelaufen', 'spur_fehler_link_abgelaufen')
    : new Problem(410, 'link_verbraucht', 'spur_fehler_link_verbraucht', { max: maxVon(link) })
}

// Prüft ohne zu verbrauchen, damit ein ungültiger Link gar nicht erst eine Datei annimmt.
export async function pruefen(token) {
  if (typeof token !== 'string' || !/^[0-9a-f]{64}$/.test(token)) throw ungueltig()
  const link = await (await links()).findOne({ hash: hash(token) })
  if (!link) throw ungueltig()
  if (link.ablauf <= jetzt() || link.genutzt >= maxVon(link)) throw grund(link)
  return { ...link, art: link.art ?? 'quelle' }
}

export async function verbrauchen(token) {
  if (typeof token !== 'string' || !/^[0-9a-f]{64}$/.test(token)) throw ungueltig()
  const verbraucht = await (await links()).findOneAndUpdate(
    {
      hash: hash(token),
      ablauf: { $gt: jetzt() },
      $expr: { $lt: ['$genutzt', { $ifNull: ['$max', MAX_DATEIEN] }] },
    },
    { $inc: { genutzt: 1 } },
    { returnDocument: 'after' }
  )
  if (verbraucht) return { ...verbraucht, art: verbraucht.art ?? 'quelle' }
  await pruefen(token)
  throw new Error('Upload-Link weder gültig noch ungültig')
}
