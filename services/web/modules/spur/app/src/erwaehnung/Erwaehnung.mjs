import { setTimeout as warten } from 'node:timers/promises'
import ChatApiHandler from '../../../../../app/src/Features/Chat/ChatApiHandler.mjs'
import DocstoreManager from '../../../../../app/src/Features/Docstore/DocstoreManager.mjs'
import EditorRealTimeController from '../../../../../app/src/Features/Editor/EditorRealTimeController.mjs'
import UserInfoController from '../../../../../app/src/Features/User/UserInfoController.mjs'
import UserInfoManager from '../../../../../app/src/Features/User/UserInfoManager.mjs'
import { db } from '../../../../../app/src/infrastructure/mongodb.mjs'
import * as Inbox from '../Inbox.mjs'
import { WerkzeugFehler } from '../mcp/fehler.mjs'
import * as PruefManager from '../pruefung/PruefManager.mjs'

// „@claude“ als eigenes Wort, nicht in einer Adresse wie mail@claude.de oder in @claudette.
const ERWAEHNT = /(^|[^\w@.])@claude(?![\w-])/i

// Overleaf schickt die Nachricht vor der Kommentar-Op; die Stelle steht erst kurz danach im Dokument.
async function stelleSuchen(projectId, threadId, { versuche, pauseMs }) {
  for (let versuch = 0; versuch < versuche; versuch++) {
    if (versuch) await warten(pauseMs)
    const docs = await PruefManager.dokumente(projectId)
    for (const eintrag of await DocstoreManager.promises.getAllRanges(String(projectId))) {
      const kommentar = eintrag.ranges?.comments?.find(c => c.op.t === threadId)
      const doc = kommentar && docs.find(d => d.docId === String(eintrag._id))
      if (!doc) continue
      const { p, c } = kommentar.op
      return {
        doc_id: doc.docId,
        pfad: doc.pfad,
        stelle: { position: p, laenge: c.length, zeile: doc.text.slice(0, p).split('\n').length, markiert: c },
      }
    }
  }
  return { doc_id: null, pfad: null, stelle: null }
}

// Nur der Claude der schreibenden Person erfährt davon; Nachrichten anderer gehen nur als ID mit.
export async function kommentarGesendet({ projectId, threadId, menschId, text }, { versuche = 20, pauseMs = 500 } = {}) {
  if (!ERWAEHNT.test(text)) return
  const bot = await db.users.findOne({ 'spur.botFuer': menschId }, { projection: { _id: 1 } })
  if (!bot) return
  const ort = await stelleSuchen(projectId, threadId, { versuche, pauseMs })
  const nachrichten = (await ChatApiHandler.promises.getThreads(String(projectId)))[threadId]?.messages ?? []
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
    throw new WerkzeugFehler('kommentar_fehlt', 'Diesen Kommentar gibt es im Projekt nicht.')
  }
  const nachricht = await ChatApiHandler.promises.sendComment(projectId, threadId, botId, text)
  nachricht.user = UserInfoController.formatPersonalInfo(await UserInfoManager.promises.getPersonalInfo(botId))
  EditorRealTimeController.emitToRoom(String(projectId), 'new-comment', threadId, nachricht)
  return { nachricht_id: nachricht.id }
}
