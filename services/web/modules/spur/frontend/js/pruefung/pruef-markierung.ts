import { StateEffect, StateField } from '@codemirror/state'
import {
  Decoration,
  DecorationSet,
  EditorView,
  ViewPlugin,
} from '@codemirror/view'
import {
  pruefenVerzoegert,
  pruefenWennNoetig,
  pruefStore,
  Zeile,
} from './pruef-store'

const setzen = StateEffect.define<DecorationSet>()

const markierungen = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(wert, tr) {
    let neu = wert.map(tr.changes)
    for (const effekt of tr.effects) {
      if (effekt.is(setzen)) neu = effekt.value
    }
    return neu
  },
  provide: feld => EditorView.decorations.from(feld),
})

function istRot(z: Zeile) {
  return (
    ['abweichend', 'quelle_fehlt'].includes(z.wortlaut ?? '') ||
    z.retraction === 'zurueckgezogen' ||
    z.referenz === 'nicht_gefunden'
  )
}

function dekorationen(view: EditorView, docId: string) {
  const laenge = view.state.doc.length
  const zeilen = pruefStore.zustand().bericht?.zeilen ?? []
  return Decoration.set(
    zeilen
      .filter(z => z.docId === docId && z.problem && z.zitatBis <= laenge)
      .filter(z => z.zitatVon < z.zitatBis)
      .map(z =>
        Decoration.mark({
          class: istRot(z) ? 'spur-marke-rot' : 'spur-marke-gelb',
        }).range(z.zitatVon, z.zitatBis)
      ),
    true
  )
}

export const extension = (options: Record<string, any>) => {
  const docId: string | undefined = options.currentDoc?.currentDocument?.doc_id
  if (!docId) return []
  return [
    markierungen,
    ViewPlugin.define(view => {
      let aktiv = true
      // Der Store meldet sich auch aus dem Aufbau des Plugins, also mitten in einem Editor-Update.
      const anwenden = () =>
        queueMicrotask(() => {
          if (aktiv) {
            view.dispatch({ effects: setzen.of(dekorationen(view, docId)) })
          }
        })
      const abmelden = pruefStore.abonnieren(anwenden)
      pruefenWennNoetig()
      anwenden()
      return {
        update(update) {
          if (update.docChanged) pruefenVerzoegert()
        },
        destroy() {
          aktiv = false
          abmelden()
        },
      }
    }),
  ]
}
