import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import OLButton from '@/shared/components/ol/ol-button'
import OLSpinner from '@/shared/components/ol/ol-spinner'
import Notification from '@/shared/components/notification'
import { anfrage, projektPfad } from '../api'
import PaperEintrag from './paper-treffer'
import type { DienstFehler, PaperTreffer } from './typen'

type Richtung = 'zitiert_von' | 'zitiert'
type Antwort = { treffer: PaperTreffer[]; fehler: DienstFehler[]; hinweis: string | null }

function ZitationsListe({ doi, richtung }: { doi: string; richtung: Richtung }) {
  const { t } = useTranslation()
  const [antwort, setAntwort] = useState<Antwort | null>(null)
  const [fehler, setFehler] = useState<string | null>(null)

  useEffect(() => {
    const parameter = new URLSearchParams({ doi, richtung })
    anfrage<Antwort>(projektPfad(`/recherche/zitationen?${parameter}`))
      .then(setAntwort)
      .catch(error => setFehler(error.message))
  }, [doi, richtung])

  const titel = t(richtung === 'zitiert_von' ? 'spur_zitiert_von' : 'spur_zitiert')
  return (
    <section className="spur-zitationen" aria-label={titel}>
      <p className="spur-zitationen-titel">{titel}</p>
      {fehler && <Notification type="error" content={fehler} />}
      {!antwort && !fehler && (
        <p className="spur-leer" role="status">
          <OLSpinner size="sm" /> {t('spur_zitationen_laden')}
        </p>
      )}
      {antwort?.fehler.map(f => <Notification key={f.dienst} type="warning" content={f.text} />)}
      {antwort?.hinweis && <Notification type="warning" content={antwort.hinweis} />}
      {antwort && antwort.treffer.length === 0 && !antwort.hinweis && (
        <p className="spur-leer">{t('spur_keine_zitationen')}</p>
      )}
      {antwort && antwort.treffer.length > 0 && (
        <ul className="spur-liste">
          {antwort.treffer.map(z => (
            <PaperEintrag key={z.doi ?? z.titel} treffer={z} />
          ))}
        </ul>
      )}
    </section>
  )
}

export default function Zitationen({ doi }: { doi: string }) {
  const { t } = useTranslation()
  const [offen, setOffen] = useState<Richtung[]>([])
  const umschalten = (richtung: Richtung) =>
    setOffen(alt => (alt.includes(richtung) ? alt.filter(r => r !== richtung) : [...alt, richtung]))

  return (
    <>
      {(['zitiert_von', 'zitiert'] as const).map(richtung => (
        <OLButton
          key={richtung}
          variant="secondary"
          size="sm"
          aria-expanded={offen.includes(richtung)}
          onClick={() => umschalten(richtung)}
        >
          {t(richtung === 'zitiert_von' ? 'spur_zitiert_von' : 'spur_zitiert')}
        </OLButton>
      ))}
      {offen.map(richtung => (
        <ZitationsListe key={richtung} doi={doi} richtung={richtung} />
      ))}
    </>
  )
}
