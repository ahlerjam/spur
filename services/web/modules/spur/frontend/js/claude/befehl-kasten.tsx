import { useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import OLButton from '@/shared/components/ol/ol-button'

export default function BefehlKasten({ befehl, kopiert: gemeldet }: { befehl: string; kopiert?: () => void }) {
  const { t } = useTranslation()
  const [kopiert, setKopiert] = useState(false)
  const id = useId()
  return (
    <div className="spur-befehl-kasten">
      <pre className="spur-befehl" id={id}>
        {befehl}
      </pre>
      <OLButton
        variant="secondary"
        size="sm"
        aria-describedby={id}
        onClick={() =>
          // Ohne Zwischenablage (HTTP ohne TLS) oder gesperrt: Der Knopf bleibt auf „Kopieren“, der Befehl steht
          // markierbar im Kasten.
          navigator.clipboard?.writeText(befehl).then(
            () => {
              setKopiert(true)
              gemeldet?.()
            },
            () => {}
          )
        }
      >
        {kopiert ? t('copied') : t('copy')}
      </OLButton>
    </div>
  )
}
