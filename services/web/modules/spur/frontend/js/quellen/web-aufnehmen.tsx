import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import OLButton from '@/shared/components/ol/ol-button'
import OLFormControl from '@/shared/components/ol/ol-form-control'
import OLFormLabel from '@/shared/components/ol/ol-form-label'
import Notification from '@/shared/components/notification'
import { jsonAnfrage, projektPfad } from '../api'

export default function WebAufnehmen({
  aufgenommen,
  abbrechen,
}: {
  aufgenommen: () => void
  abbrechen: () => void
}) {
  const { t } = useTranslation()
  const [url, setUrl] = useState('')
  const [fehler, setFehler] = useState<string | null>(null)
  const [laedt, setLaedt] = useState(false)
  const feld = useRef<HTMLInputElement>(null)

  useEffect(() => feld.current?.focus(), [])

  const senden = async () => {
    setFehler(null)
    setLaedt(true)
    try {
      await jsonAnfrage('POST', projektPfad('/quellen/web'), { url })
      aufgenommen()
    } catch (error) {
      // Die Adresse bleibt stehen, damit sie sich korrigieren lässt.
      setFehler((error as Error).message)
      setLaedt(false)
      feld.current?.focus()
    }
  }

  return (
    <form
      className="spur-web-form"
      onSubmit={e => {
        e.preventDefault()
        senden()
      }}
    >
      <OLFormLabel htmlFor="spur-web-url">{t('spur_webseite_adresse')}</OLFormLabel>
      <OLFormControl
        ref={feld}
        id="spur-web-url"
        type="url"
        size="sm"
        placeholder="https://"
        required
        maxLength={2000}
        value={url}
        aria-invalid={Boolean(fehler)}
        aria-describedby={fehler ? 'spur-web-fehler' : undefined}
        onChange={e => setUrl(e.target.value)}
      />
      {fehler && (
        <div id="spur-web-fehler">
          <Notification type="error" content={fehler} />
        </div>
      )}
      <div className="spur-kommentar-knoepfe">
        <OLButton
          type="submit"
          variant="primary"
          size="sm"
          disabled={!url.trim()}
          isLoading={laedt}
          loadingLabel={t('spur_wird_abgerufen')}
        >
          {t('spur_aufnehmen')}
        </OLButton>
        <OLButton variant="secondary" size="sm" onClick={abbrechen}>
          {t('cancel')}
        </OLButton>
      </div>
    </form>
  )
}
