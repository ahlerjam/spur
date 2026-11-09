import * as Inbox from '../Inbox.mjs'
import { Problem } from '../probleme.mjs'
import { workflows } from '../sammlungen.mjs'
import { jetzt } from '../schalter.mjs'
import { STANDARD } from './standardtexte.mjs'

export const NAMEN = Object.keys(STANDARD)
const MAX_TEXT = 20000

function pruefen(name) {
  if (!NAMEN.includes(name)) throw new Problem(404, 'workflow_fehlt', 'spur_fehler_workflow_fehlt')
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

// Werte der Eingaben als Zeilen unter dem Text; der Text selbst bleibt so, wie Admins ihn pflegen.
function eingabenZeilen(name, { fokus, thema, anzahl = '20' }) {
  if (!STANDARD[name].eingaben) return fokus ? [`Fokus: ${fokus}`] : []
  if (!thema?.trim()) throw new Problem(422, 'thema', 'spur_fehler_thema_fehlt')
  const wert = String(anzahl).trim()
  if (!/^(max|[1-9]\d{0,4})$/.test(wert)) throw new Problem(422, 'anzahl', 'spur_fehler_anzahl')
  return [
    `Thema: ${thema.trim()}`,
    wert === 'max' ? 'Anzahl: max. Es gibt keine Obergrenze; arbeite in Etappen.' : `Anzahl: ${wert}`,
  ]
}

export async function promptText(name, argumente = {}) {
  pruefen(name)
  const zeilen = eingabenZeilen(name, argumente)
  const inhalt = await text(name)
  return zeilen.length ? `${inhalt}\n\n${zeilen.join('\n')}` : inhalt
}

export async function setzen(name, neu, adminId) {
  pruefen(name)
  if (typeof neu !== 'string' || !neu.trim() || neu.length > MAX_TEXT) {
    throw new Problem(422, 'workflow_text', 'spur_fehler_workflow_text', { max: MAX_TEXT })
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
export async function starten({ projectId, botId, name, argumente }) {
  return await Inbox.auftragAnlegen({
    projectId,
    botId,
    text: await promptText(name, argumente),
    anzeige: `Workflow: ${STANDARD[name].titel}`,
    daten: { workflow: name },
  })
}
