import * as Inbox from '../Inbox.mjs'
import { Problem } from '../probleme.mjs'
import { workflows } from '../sammlungen.mjs'
import { jetzt } from '../schalter.mjs'
import { STANDARD } from './standardtexte.mjs'

export const NAMEN = Object.keys(STANDARD)
const MAX_TEXT = 20000

function pruefen(name) {
  if (!NAMEN.includes(name)) throw new Problem(404, 'workflow_fehlt', 'Diesen Workflow gibt es nicht.')
}

// Ohne Zwischenspeicher: Ein geänderter Text gilt sofort für Panel und prompts/get (eine Quelle).
export async function liste() {
  const angepasst = new Map((await (await workflows()).find({}).toArray()).map(w => [w._id, w.text]))
  return NAMEN.map(name => ({
    ...STANDARD[name],
    name,
    text: angepasst.get(name) ?? STANDARD[name].text,
    angepasst: angepasst.has(name),
  }))
}

export async function text(name) {
  pruefen(name)
  const eintrag = await (await workflows()).findOne({ _id: name })
  return eintrag?.text ?? STANDARD[name].text
}

export async function promptText(name, fokus) {
  const inhalt = await text(name)
  return fokus ? `${inhalt}\n\nFokus: ${fokus}` : inhalt
}

export async function setzen(name, neu, adminId) {
  pruefen(name)
  if (typeof neu !== 'string' || !neu.trim() || neu.length > MAX_TEXT) {
    throw new Problem(422, 'workflow_text', `Der Text muss 1 bis ${MAX_TEXT} Zeichen haben.`)
  }
  await (await workflows()).updateOne(
    { _id: name },
    { $set: { text: neu, geaendertVon: adminId, geaendertAm: jetzt() } },
    { upsert: true }
  )
}

export async function zuruecksetzen(name) {
  pruefen(name)
  await (await workflows()).deleteOne({ _id: name })
}

// Claude kann MCP-Prompts nicht selbst aufrufen; der Auftrag trägt deshalb den vollen Text.
export async function starten({ projectId, botId, name }) {
  return await Inbox.auftragAnlegen({
    projectId,
    botId,
    text: await text(name),
    anzeige: `Workflow: ${STANDARD[name].titel}`,
    daten: { workflow: name },
  })
}
