import { EditorState, StateEffect, StateField } from '@codemirror/state'
import {
  Decoration,
  DecorationSet,
  EditorView,
  hoverTooltip,
  showTooltip,
  Tooltip,
  ViewPlugin,
} from '@codemirror/view'
import i18n from 'i18next'
import { befunde } from './befunde'
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
          zeile: z,
        }).range(z.zitatVon, z.zitatBis)
      ),
    true
  )
}

// Der Befund als Text (wie die Abzeichen im Bericht), nicht nur als Farbe.
function tooltipAn(state: EditorState, pos: number): Tooltip | null {
  let tooltip: Tooltip | null = null
  state.field(markierungen).between(pos, pos, (from, to, deko) => {
    const texte = befunde(deko.spec.zeile, i18n.t)
      .filter(b => b.stufe === 'danger' || b.stufe === 'warning')
      .map(b => b.text)
    if (!texte.length) return
    tooltip = {
      pos: from,
      end: to,
      above: true,
      create: () => {
        const dom = document.createElement('div')
        dom.className = 'spur-befund-tooltip'
        dom.setAttribute('role', 'status')
        dom.textContent = texte.join(' · ')
        return { dom }
      },
    }
    return false
  })
  return tooltip
}

// Per Tastatur: Steht der Cursor in einer Markierung, zeigt der Editor den Befund an.
const cursorBefund = StateField.define<Tooltip | null>({
  create: () => null,
  update(wert, tr) {
    if (!tr.docChanged && !tr.selection && !tr.effects.some(e => e.is(setzen))) return wert
    const { main } = tr.state.selection
    return main.empty ? tooltipAn(tr.state, main.head) : null
  },
  provide: feld => showTooltip.from(feld),
})

const mausBefund = hoverTooltip((view, pos) => {
  const tooltip = tooltipAn(view.state, pos)
  const amCursor = view.state.field(cursorBefund)
  // Steht der Cursor schon in derselben Markierung, zeigt dessen Tooltip den Befund.
  return tooltip && amCursor?.pos === tooltip.pos ? null : tooltip
})

export const extension = (options: Record<string, any>) => {
  const docId: string | undefined = options.currentDoc?.currentDocument?.doc_id
  if (!docId) return []
  return [
    markierungen,
    cursorBefund,
    mausBefund,
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
