import { setTimeout as warten } from 'node:timers/promises'
import logger from '@overleaf/logger'
import ChatApiHandler from '../../../../../app/src/Features/Chat/ChatApiHandler.mjs'
import DocstoreManager from '../../../../../app/src/Features/Docstore/DocstoreManager.mjs'
import EditorRealTimeController from '../../../../../app/src/Features/Editor/EditorRealTimeController.mjs'
import UserInfoController from '../../../../../app/src/Features/User/UserInfoController.mjs'
import UserInfoManager from '../../../../../app/src/Features/User/UserInfoManager.mjs'
import { RateLimiter } from '../../../../../app/src/infrastructure/RateLimiter.mjs'
import { botVon } from '../anfrage.mjs'
import * as Inbox from '../Inbox.mjs'
import { WerkzeugFehler } from '../mcp/fehler.mjs'
import * as PruefManager from '../pruefung/PruefManager.mjs'

// „@claude“ als eigenes Wort, nicht in einer Adresse wie mail@claude.de oder in @claudette.
const ERWAEHNT = /(^|[^\w@.])@claude(?![\w-])/i

// Overleaf schickt die Nachricht vor der Kommentar-Op; die Stelle steht erst kurz danach im Dokument.
async function kommentarSuchen(projectId, threadId, { versuche, pauseMs }) {
  for (let versuch = 0; versuch < versuche; versuch++) {
    if (versuch) await warten(pauseMs)
    for (const eintrag of await DocstoreManager.promises.getAllRanges(String(projectId))) {
      const kommentar = eintrag.ranges?.comments?.find(c => c.op.t === threadId)
      if (kommentar) return { docId: String(eintrag._id), op: kommentar.op }
    }
  }
  return null
}

async function stelleSuchen(projectId, threadId, optionen) {
  const gefunden = await kommentarSuchen(projectId, threadId, optionen)
  const doc = gefunden && (await PruefManager.dokumente(projectId)).find(d => d.docId === gefunden.docId)
  if (!doc) return { doc_id: null, pfad: null, stelle: null }
  const { p, c } = gefunden.op
  return {
    doc_id: doc.docId,
    pfad: doc.pfad,
    stelle: { position: p, laenge: c.length, zeile: doc.text.slice(0, p).split('\n').length, markiert: c },
  }
}

// Jede Erwähnung durchsucht bis zu 10 s die Ranges des Projekts; mehr als ein paar je Minute schreibt kein Mensch.
const begrenzer = new RateLimiter('spur-erwaehnung', { points: 20, duration: 60 })

// Nur der Claude der schreibenden Person erfährt davon; Nachrichten anderer gehen nur als ID mit.
export async function kommentarGesendet({ projectId, threadId, menschId, text }, { versuche = 20, pauseMs = 500 } = {}) {
  if (!ERWAEHNT.test(text)) return
  const bot = await botVon(menschId)
  if (!bot) return
  try {
    await begrenzer.consume(String(menschId), 1, { method: 'userId' })
  } catch (error) {
    // Abgewiesen wird mit einem RateLimiterRes; ein echter Error ist ein Ausfall, kein Limit.
    if (error instanceof Error) throw error
    logger.warn({ menschId, threadId }, 'spur: zu viele @claude-Erwähnungen, übergangen')
    return
  }
  const [ort, threads] = await Promise.all([
    stelleSuchen(projectId, threadId, { versuche, pauseMs }),
    ChatApiHandler.promises.getThreads(String(projectId)),
  ])
  const nachrichten = threads[threadId]?.messages ?? []
  const eigene = nachrichten.findLast(n => n.user_id === String(menschId) && n.content === text)
  await Inbox.ereignisAnlegen({
    projectId,
    botId: bot._id,
    typ: 'comment_mention',
    daten: {
      kommentar_id: threadId,
      nachricht_id: eigene?.id ?? null,
      text,
      ...ort,
      andere_nachrichten: nachrichten.filter(n => n !== eigene).map(n => n.id),
    },
  })
}

export async function imThreadAntworten({ projectId, threadId, botId, text }) {
  const threads = await ChatApiHandler.promises.getThreads(String(projectId))
  if (!threads[threadId]) {
    throw new WerkzeugFehler('kommentar_fehlt', 'spur_fehler_kommentar_fehlt')
  }
  const nachricht = await ChatApiHandler.promises.sendComment(projectId, threadId, botId, text)
  nachricht.user = UserInfoController.formatPersonalInfo(await UserInfoManager.promises.getPersonalInfo(botId))
  EditorRealTimeController.emitToRoom(String(projectId), 'new-comment', threadId, nachricht)
  return { nachricht_id: nachricht.id }
}
