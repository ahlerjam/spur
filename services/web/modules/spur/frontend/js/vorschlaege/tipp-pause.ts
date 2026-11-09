import { ViewPlugin } from '@codemirror/view'
import { debugConsole } from '@/utils/debugging'
import { jsonAnfrage, projektPfad } from '../api'

const PAUSE_MS = 60 * 1000

// Nach einer Minute ohne eigene Eingabe bittet spur Claude, nach beleglosen Argumenten zu suchen.
// Schalter und Tageslimit prüft der Server; Änderungen anderer Personen zählen nicht.
export const extension = (options: Record<string, any>) => {
  const docId: string | undefined = options.currentDoc?.currentDocument?.doc_id
  if (!docId) return []
  return ViewPlugin.define(() => {
    let timer: number | undefined
    return {
      update(update) {
        const getippt = update.transactions.some(tr => tr.isUserEvent('input') || tr.isUserEvent('delete'))
        if (!update.docChanged || !getippt) return
        window.clearTimeout(timer)
        timer = window.setTimeout(() => {
          jsonAnfrage('POST', projektPfad('/vorschlaege/tipp-pause'), { doc_id: docId }).catch(error =>
            debugConsole.warn('spur: Tipp-Pause nicht gemeldet', error)
          )
        }, PAUSE_MS)
      },
      destroy() {
        window.clearTimeout(timer)
      },
    }
  })
}
