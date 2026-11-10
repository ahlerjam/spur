import { useId, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Notification from '@/shared/components/notification'
import OLButton from '@/shared/components/ol/ol-button'

// Einladungslink für Admins (Nutzerliste und Registrierseite). Ohne Mail-Einrichtung gibt der Admin den Link
// selbst weiter; ohne `perMail` (nur ein neuer Link) entfällt der Hinweis. Ohne Clipboard-API (http außerhalb
// von localhost) kopiert der Knopf über die Auswahl im Feld.
export default function EinladungsLink({ url, perMail }: { url: string; perMail?: boolean }) {
  const { t } = useTranslation()
  const id = useId()
  const feld = useRef<HTMLInputElement>(null)
  const [kopiert, setKopiert] = useState(false)

  const kopieren = async () => {
    try {
      await navigator.clipboard.writeText(url)
    } catch {
      feld.current?.select()
      document.execCommand('copy')
    }
    setKopiert(true)
  }

  return (
    <div className="mb-3">
      {perMail !== undefined && (
        <Notification
          className="mb-3"
          type={perMail ? 'success' : 'warning'}
          content={perMail ? t('spur_einladung_per_mail') : t('spur_einladung_selbst_weitergeben')}
        />
      )}
      <label className="form-label" htmlFor={id}>
        {t('spur_einladungslink')}
      </label>
      <div className="d-flex gap-2">
        <input
          id={id}
          ref={feld}
          className="form-control"
          readOnly
          value={url}
          onFocus={e => e.currentTarget.select()}
        />
        <OLButton variant="secondary" onClick={kopieren}>
          {kopiert ? t('copied') : t('copy')}
        </OLButton>
      </div>
      <p className="form-text">{t('spur_einladungslink_gueltig')}</p>
    </div>
  )
}
