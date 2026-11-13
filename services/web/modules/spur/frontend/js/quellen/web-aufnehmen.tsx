import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import OLButton from '@/shared/components/ol/ol-button'
import LadeKnopf from '../lade-knopf'
import OLFormControl from '@/shared/components/ol/ol-form-control'
import OLFormLabel from '@/shared/components/ol/ol-form-label'
import {
  OLModal,
  OLModalBody,
  OLModalFooter,
  OLModalHeader,
  OLModalTitle,
} from '@/shared/components/ol/ol-modal'
import { jsonAnfrage, projektPfad } from '../api'

const istWebAdresse = (wert: string) => {
  try {
    return ['http:', 'https:'].includes(new URL(wert.trim()).protocol)
  } catch {
    return false
  }
}

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
    // Die Adresse bleibt bei jedem Fehler stehen, damit sie sich korrigieren lässt.
    if (!istWebAdresse(url)) {
      setFehler(t('spur_fehler_adresse_ungueltig'))
      feld.current?.focus()
      return
    }
    setFehler(null)
    setLaedt(true)
    try {
      await jsonAnfrage('POST', projektPfad('/quellen/web'), { url: url.trim() })
      aufgenommen()
    } catch (error) {
      setFehler((error as Error).message)
      setLaedt(false)
      feld.current?.focus()
    }
  }

  return (
    <OLModal themed show onHide={abbrechen}>
      <form
        noValidate
        onSubmit={e => {
          e.preventDefault()
          senden()
        }}
      >
        <OLModalHeader>
          <OLModalTitle>{t('spur_webseite_aufnehmen')}</OLModalTitle>
        </OLModalHeader>
        <OLModalBody>
          <OLFormLabel htmlFor="spur-web-url">{t('spur_webseite_adresse')}</OLFormLabel>
          <OLFormControl
            ref={feld}
            id="spur-web-url"
            type="url"
            placeholder="https://"
            maxLength={2000}
            value={url}
            isInvalid={Boolean(fehler)}
            aria-invalid={Boolean(fehler)}
            aria-describedby={fehler ? 'spur-web-fehler' : undefined}
            onChange={e => setUrl(e.target.value)}
          />
          {fehler && (
            <div id="spur-web-fehler" className="invalid-feedback d-block">
              {fehler}
            </div>
          )}
        </OLModalBody>
        <OLModalFooter>
          <OLButton variant="secondary" onClick={abbrechen}>
            {t('cancel')}
          </OLButton>
          <LadeKnopf
            type="submit"
            variant="primary"
            disabled={!url.trim()}
            isLoading={laedt}
            loadingLabel={t('spur_wird_abgerufen')}
          >
            {t('spur_aufnehmen')}
          </LadeKnopf>
        </OLModalFooter>
      </form>
    </OLModal>
  )
}
