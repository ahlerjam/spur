import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { EditorSelection } from '@codemirror/state'
import { useEditorViewContext } from '@/features/ide-react/context/editor-view-context'
import OLButton from '@/shared/components/ol/ol-button'
import OLSpinner from '@/shared/components/ol/ol-spinner'
import Notification from '@/shared/components/notification'
import OLToggleButton from '@/shared/components/ol/ol-toggle-button'
import OLToggleButtonGroup from '@/shared/components/ol/ol-toggle-button-group'
import { usePermissionsContext } from '@/features/ide-react/context/permissions-context'
import { useConnectionContext } from '@/features/ide-react/context/connection-context'
import useSocketListener from '@/features/ide-react/hooks/use-socket-listener'
import getMeta from '@/utils/meta'
import { anfrage, jsonAnfrage, projektPfad } from '../api'
import { pruefenVerzoegert } from '../pruefung/pruef-store'
import NotizFeld, { notizSchluessel, type Notizen } from './notiz-feld'
import ZitatKommentare from './zitat-kommentare'
import type { Quelle, Zitat } from './typen'

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
  ueberschrift: Ueberschrift = 'h5',
}: {
  quelle: Quelle
  seite: number
  textElement: HTMLElement | null
  // Im Panel folgt die Liste auf den Panel-Titel (h4), in der großen Ansicht auf deren Abschnitte (h2).
  ueberschrift?: 'h3' | 'h5'
}) {
  const { t } = useTranslation()
  const {
    write: darfSchreiben,
    comment: darfKommentieren,
    trackedWrite: darfPruefen,
  } = usePermissionsContext()
  const { view } = useEditorViewContext()
  const { socket } = useConnectionContext()
  // null, solange die Zitate laden: sonst stünde kurz „Markieren Sie …“ da.
  const [zitate, setZitate] = useState<Zitat[] | null>(null)
  const [nurEigene, setNurEigene] = useState(false)
  const [fehler, setFehler] = useState<string | null>(null)
  const [notizen, setNotizen] = useState<Notizen>({})
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

  useEffect(() => {
    anfrage<{ notizen: { zitatId: string | null; text: string }[] }>(projektPfad(`/quellen/${quelle.id}/notizen`))
      .then(antwort =>
        setNotizen(Object.fromEntries(antwort.notizen.map(n => [notizSchluessel(n.zitatId), n.text])))
      )
      .catch(error => setFehler(error.message))
  }, [quelle.id])

  const live = useCallback(
    ({ quelleId }: { quelleId: string }) => {
      if (quelleId === quelle.id) laden().catch(error => setFehler(error.message))
    },
    [laden, quelle.id]
  )
  useSocketListener(socket, 'spur:zitate', live)

  const bestaetigen = async (zitat: Zitat) => {
    setFehler(null)
    try {
      await jsonAnfrage('POST', projektPfad(`${basis}/${zitat.id}/bestaetigen`))
      await laden()
      // Der Knopf verschwindet: Fokus auf den neuen Status statt auf BODY.
      document.getElementById(`spur-wortlaut-${zitat.id}`)?.focus()
      pruefenVerzoegert()
    } catch (error) {
      setFehler((error as Error).message)
    }
  }

  const ich = getMeta('ol-user_id')
  const alle = zitate ?? []
  const sichtbar = nurEigene ? alle.filter(z => z.von.id === ich) : alle
  const geladen = zitate !== null

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
      // Direkt hinter einem Wort fehlte sonst das Leerzeichen vor \enquote.
      const davor = pos > 0 ? view.state.sliceDoc(pos - 1, pos) : ''
      const einfuegung = davor && !/\s/.test(davor) ? ` ${latex}` : latex
      view.dispatch({
        changes: { from: pos, insert: einfuegung },
        selection: EditorSelection.cursor(pos + einfuegung.length),
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
      <NotizFeld
        quelleId={quelle.id}
        label={t('spur_notiz_quelle')}
        gespeichert={notizen[notizSchluessel()] ?? ''}
        darfSchreiben={darfSchreiben}
      />
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
      <Ueberschrift id="spur-zitate-titel" className="spur-zitate-titel">
        {t('spur_gespeicherte_zitate')}
      </Ueberschrift>
      {fehler && <Notification type="error" content={fehler} />}
      {!geladen && !fehler && <OLSpinner size="sm" />}
      {alle.length > 0 && (
        <OLToggleButtonGroup
          type="radio"
          name="spur-zitate-filter"
          size="sm"
          value={nurEigene ? 'mir' : 'alle'}
          onChange={(wert: string) => setNurEigene(wert === 'mir')}
          aria-label={t('spur_zitate_filtern')}
        >
          <OLToggleButton id="spur-filter-alle" variant="secondary" value="alle">
            {t('spur_alle')}
          </OLToggleButton>
          <OLToggleButton id="spur-filter-mir" variant="secondary" value="mir">
            {t('spur_von_mir')}
          </OLToggleButton>
        </OLToggleButtonGroup>
      )}
      {geladen && alle.length === 0 && <p className="spur-leer">{t('spur_keine_zitate_markiert')}</p>}
      {alle.length > 0 && sichtbar.length === 0 && (
        <p className="spur-leer">{t('spur_keine_eigenen_zitate')}</p>
      )}
      {!darfSchreiben && alle.length > 0 && (
        <p className="spur-zeile-meta" id="spur-einfuegen-hinweis">
          {t('spur_keine_schreibrechte')}
        </p>
      )}
      <ul className="spur-liste">
        {sichtbar.map(zitat => (
          <li className="spur-zeile" key={zitat.id}>
            <p className="spur-zeile-auszug">„{zitat.text}“</p>
            <p className="spur-zeile-meta">
              {/* Ein Schnappschuss hat keine Seiten. */}
              {quelle.art !== 'web' &&
                `${t('spur_seite_kurz', { seite: zitat.label ?? zitat.seite })} · `}
              {zitat.von.id === ich ? t('spur_von_ihnen') : t('spur_von', { name: zitat.von.name })}
            </p>
            {quelle.status === 'ocr' && (
              <p
                className="spur-zeile-meta"
                id={`spur-wortlaut-${zitat.id}`}
                tabIndex={-1}
              >
                {zitat.bestaetigt ? t('spur_wortlaut_bestaetigt') : t('spur_wortlaut_ocr')}
              </p>
            )}
            {quelle.status === 'ocr' && !zitat.bestaetigt && darfPruefen && (
              <OLButton variant="secondary" size="sm" onClick={() => bestaetigen(zitat)}>
                {t('spur_stelle_bestaetigt')}
              </OLButton>
            )}
            <ZitatKommentare
              zitat={zitat}
              basis={basis}
              darfKommentieren={darfKommentieren}
              geaendert={() => laden().catch(error => setFehler(error.message))}
            />
            <OLButton
              variant="secondary"
              size="sm"
              disabled={!kannEinfuegen}
              aria-describedby={darfSchreiben ? undefined : 'spur-einfuegen-hinweis'}
              onClick={() => einfuegen(zitat)}
            >
              {t('spur_einfuegen')}
            </OLButton>
            <NotizFeld
              quelleId={quelle.id}
              zitatId={zitat.id}
              label={t('spur_notiz_zitat')}
              gespeichert={notizen[notizSchluessel(zitat.id)] ?? ''}
              darfSchreiben={darfSchreiben}
            />
          </li>
        ))}
      </ul>
    </section>
  )
}
