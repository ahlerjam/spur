import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import OLButton from '@/shared/components/ol/ol-button'
import OLSpinner from '@/shared/components/ol/ol-spinner'
import Notification from '@/shared/components/notification'
import { anfrage, projektPfad } from '../api'

type Eintrag = { datum: string; dienst: string; anfrage: string; treffer: number }
type Seite = { eintraege: Eintrag[]; gesamt: number; weiter: boolean }

const datumText = (iso: string) =>
  new Date(iso).toLocaleString('de-DE', { dateStyle: 'medium', timeStyle: 'short' })

export default function Suchprotokoll() {
  const { t } = useTranslation()
  const [eintraege, setEintraege] = useState<Eintrag[] | null>(null)
  const [weiter, setWeiter] = useState(false)
  const [seite, setSeite] = useState(0)
  const [fehler, setFehler] = useState<string | null>(null)

  const laden = useCallback(async (nummer: number) => {
    setFehler(null)
    try {
      const antwort = await anfrage<Seite>(projektPfad(`/recherche/protokoll?seite=${nummer}`))
      setEintraege(alt => (nummer === 0 ? antwort.eintraege : [...(alt ?? []), ...antwort.eintraege]))
      setWeiter(antwort.weiter)
      setSeite(nummer)
    } catch (error) {
      setFehler((error as Error).message)
    }
  }, [])

  useEffect(() => {
    laden(0)
  }, [laden])

  return (
    <>
      <div className="spur-panel-werkzeuge">
        <OLButton
          variant="secondary"
          size="sm"
          href={projektPfad('/recherche/protokoll.csv')}
          download
          disabled={!eintraege?.length}
        >
          {t('spur_protokoll_exportieren')}
        </OLButton>
      </div>
      <div className="spur-panel-inhalt">
        {fehler && <Notification type="error" content={fehler} />}
        {!eintraege && !fehler && (
          <p className="spur-leer" role="status">
            <OLSpinner size="sm" /> {t('spur_protokoll_laden')}
          </p>
        )}
        {eintraege?.length === 0 && <p className="spur-leer">{t('spur_protokoll_leer')}</p>}
        {eintraege && eintraege.length > 0 && (
          <ul className="spur-liste spur-protokoll">
            {eintraege.map((e, i) => (
              <li key={`${e.datum}-${e.dienst}-${i}`} className="spur-zeile">
                <p className="spur-paper-titel">{e.anfrage}</p>
                <p className="spur-zeile-meta">
                  {e.dienst} · {t('spur_treffer_anzahl', { count: e.treffer })} ·{' '}
                  <time dateTime={e.datum}>{datumText(e.datum)}</time>
                </p>
              </li>
            ))}
          </ul>
        )}
        {weiter && (
          <OLButton variant="secondary" size="sm" onClick={() => laden(seite + 1)}>
            {t('spur_weitere_eintraege')}
          </OLButton>
        )}
      </div>
    </>
  )
}
