import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { EditorSelection } from '@codemirror/state'
import { useEditorViewContext } from '@/features/ide-react/context/editor-view-context'
import OLButton from '@/shared/components/ol/ol-button'
import Notification from '@/shared/components/notification'
import { usePermissionsContext } from '@/features/ide-react/context/permissions-context'
import { anfrage, jsonAnfrage, projektPfad } from '../api'
import { pruefenVerzoegert } from '../pruefung/pruef-store'
import type { Quelle } from './typen'

type Zitat = { id: string; seite: number; label: string | null; text: string }

function useAuswahlIn(container: HTMLElement | null) {
  const [auswahl, setAuswahl] = useState('')
  useEffect(() => {
    const pruefen = () => {
      const sel = document.getSelection()
      const imText =
        container && sel?.anchorNode && container.contains(sel.anchorNode)
      setAuswahl(imText ? sel.toString().trim() : '')
    }
    document.addEventListener('selectionchange', pruefen)
    return () => document.removeEventListener('selectionchange', pruefen)
  }, [container])
  return auswahl
}

export default function Zitate({
  quelle,
  seite,
  textElement,
}: {
  quelle: Quelle
  seite: number
  textElement: HTMLElement | null
}) {
  const { t } = useTranslation()
  const { write: darfSchreiben } = usePermissionsContext()
  const { view } = useEditorViewContext()
  const [zitate, setZitate] = useState<Zitat[]>([])
  const [fehler, setFehler] = useState<string | null>(null)
  const auswahl = useAuswahlIn(textElement)
  const basis = `/quellen/${quelle.id}/zitate`
  const kannEinfuegen = darfSchreiben && Boolean(view)

  const laden = useCallback(async () => {
    const antwort = await anfrage<{ zitate: Zitat[] }>(projektPfad(basis))
    setZitate(antwort.zitate)
  }, [basis])

  useEffect(() => {
    laden().catch(error => setFehler(error.message))
  }, [laden])

  const speichern = async () => {
    setFehler(null)
    try {
      await jsonAnfrage('POST', projektPfad(basis), { seite, text: auswahl })
      document.getSelection()?.removeAllRanges()
      await laden()
    } catch (error) {
      setFehler((error as Error).message)
    }
  }

  const einfuegen = async (zitat: Zitat) => {
    if (!view) return
    setFehler(null)
    try {
      const { latex } = await jsonAnfrage<{ latex: string }>(
        'POST',
        projektPfad(`${basis}/${zitat.id}/einfuegen`)
      )
      const pos = view.state.selection.main.head
      view.dispatch({
        changes: { from: pos, insert: latex },
        selection: EditorSelection.cursor(pos + latex.length),
        userEvent: 'input',
      })
      view.focus()
      pruefenVerzoegert()
    } catch (error) {
      setFehler((error as Error).message)
    }
  }

  return (
    <section className="spur-zitate" aria-labelledby="spur-zitate-titel">
      {darfSchreiben && (
        <OLButton
          variant="primary"
          size="sm"
          disabled={!auswahl}
          onClick={speichern}
        >
          {t('spur_zitat_speichern')}
        </OLButton>
      )}
      <h5 id="spur-zitate-titel" className="spur-zitate-titel">
        {t('spur_gespeicherte_zitate')}
      </h5>
      {fehler && <Notification type="error" content={fehler} />}
      {zitate.length === 0 && <p className="spur-leer">{t('spur_keine_zitate_markiert')}</p>}
      {!kannEinfuegen && zitate.length > 0 && (
        <p className="spur-zeile-meta" id="spur-einfuegen-hinweis">
          {t('spur_keine_schreibrechte')}
        </p>
      )}
      <ul className="spur-liste">
        {zitate.map(zitat => (
          <li className="spur-zeile" key={zitat.id}>
            <p className="spur-zeile-auszug">„{zitat.text}“</p>
            <p className="spur-zeile-meta">
              {t('spur_seite_kurz', { seite: zitat.label ?? zitat.seite })}
            </p>
            <OLButton
              variant="secondary"
              size="sm"
              disabled={!kannEinfuegen}
              aria-describedby={kannEinfuegen ? undefined : 'spur-einfuegen-hinweis'}
              onClick={() => einfuegen(zitat)}
            >
              {t('spur_einfuegen')}
            </OLButton>
          </li>
        ))}
      </ul>
    </section>
  )
}
