import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import OLButton from '@/shared/components/ol/ol-button'
import OLFormControl from '@/shared/components/ol/ol-form-control'
import Notification from '@/shared/components/notification'
import { usePermissionsContext } from '@/features/ide-react/context/permissions-context'
import { anfrage, jsonAnfrage, projektPfad } from '../api'
import QuellenSuche from './quellen-suche'
import type { Treffer } from './typen'

type Stand =
  | { an: false }
  | { an: true; gesamt: number; indexiert: number; laeuft: boolean; fehlgeschlagen: boolean }
type SemantikTreffer = { quelleId: string; dateiname: string; seite: number; label: string | null; auszug: string }

const TAKT_MS = 500

// Sinngemäße Suche über die Quellen. Ohne Schalter des Betreibers zeigt sie nichts.
export default function Semantik({ quellenAnzahl, oeffnen }: { quellenAnzahl: number; oeffnen: (t: Treffer) => void }) {
  const { t } = useTranslation()
  const { write: darfSchreiben } = usePermissionsContext()
  const [stand, setStand] = useState<Stand | null>(null)
  const [frage, setFrage] = useState('')
  const [treffer, setTreffer] = useState<Treffer[] | null>(null)
  const [fehler, setFehler] = useState<string | null>(null)

  useEffect(() => {
    let aktiv = true
    let takt: number | undefined
    let angestossen = false
    const pruefen = async () => {
      try {
        const neu = await anfrage<Stand>(projektPfad('/quellen/semantik'))
        if (!aktiv) return
        setStand(neu)
        if (!neu.an || neu.indexiert >= neu.gesamt) return
        // Einmal je Öffnen anstoßen; ein gescheiterter Lauf wird nicht in Schleife neu gestartet.
        if (!neu.laeuft && !angestossen && darfSchreiben) {
          angestossen = true
          await jsonAnfrage('POST', projektPfad('/quellen/semantik/indexieren'))
        } else if (!neu.laeuft) {
          if (neu.fehlgeschlagen) setFehler(t('spur_indexieren_fehlgeschlagen'))
          return
        }
        takt = window.setTimeout(pruefen, TAKT_MS)
      } catch (error) {
        if (aktiv) setFehler((error as Error).message)
      }
    }
    pruefen()
    return () => {
      aktiv = false
      window.clearTimeout(takt)
    }
  }, [quellenAnzahl, darfSchreiben, t])

  if (!stand?.an) return fehler ? <Notification type="error" content={fehler} /> : null

  const suchen = async () => {
    setFehler(null)
    try {
      const antwort = await anfrage<{ treffer: SemantikTreffer[] }>(
        projektPfad(`/quellen/semantik/suche?q=${encodeURIComponent(frage)}`)
      )
      setTreffer(antwort.treffer.map(s => ({ ...s, art: 'pdf' as const, imDateinamen: false })))
    } catch (error) {
      setFehler((error as Error).message)
    }
  }

  return (
    <section className="spur-semantik" aria-labelledby="spur-semantik-titel">
      <h5 id="spur-semantik-titel" className="spur-zitationen-titel">
        {t('spur_sinngemaess_suchen')}
      </h5>
      <p className="spur-zeile-meta" role="status">
        {stand.indexiert < stand.gesamt
          ? t('spur_indexiert', { fertig: stand.indexiert, gesamt: stand.gesamt })
          : t('spur_semantik_bereit', { gesamt: stand.gesamt })}
      </p>
      <form
        className="spur-recherche-suche"
        onSubmit={e => {
          e.preventDefault()
          if (frage.trim()) suchen()
        }}
      >
        <OLFormControl
          type="search"
          size="sm"
          aria-label={t('spur_sinngemaess_suchen')}
          placeholder={t('spur_sinngemaess_beispiel')}
          value={frage}
          onChange={e => setFrage(e.target.value)}
        />
        <OLButton type="submit" variant="secondary" size="sm" disabled={!frage.trim()}>
          {t('spur_suchen')}
        </OLButton>
      </form>
      {fehler && <Notification type="error" content={fehler} />}
      {treffer && (
        <>
          <p className="spur-zeile-meta">{t('spur_kein_pruefbeleg')}</p>
          <QuellenSuche treffer={treffer} oeffnen={oeffnen} />
        </>
      )}
    </section>
  )
}
