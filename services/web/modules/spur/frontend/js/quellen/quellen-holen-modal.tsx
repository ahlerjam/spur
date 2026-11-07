import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import OLButton from '@/shared/components/ol/ol-button'
import OLFormGroup from '@/shared/components/ol/ol-form-group'
import OLFormLabel from '@/shared/components/ol/ol-form-label'
import OLFormSelect from '@/shared/components/ol/ol-form-select'
import {
  OLModal,
  OLModalBody,
  OLModalFooter,
  OLModalHeader,
  OLModalTitle,
} from '@/shared/components/ol/ol-modal'
import Notification from '@/shared/components/notification'
import { jsonAnfrage, projektPfad } from '../api'

export type Projekt = { id: string; name: string }

export default function QuellenHolenModal({
  projekte,
  vorauswahl,
  schliessen,
  geholt,
}: {
  projekte: Projekt[]
  vorauswahl?: string
  schliessen: () => void
  geholt: () => void
}) {
  const { t } = useTranslation()
  const [auswahl, setAuswahl] = useState(vorauswahl ?? projekte[0]?.id ?? '')
  const [fehler, setFehler] = useState<string | null>(null)
  const [laeuft, setLaeuft] = useState(false)

  useEffect(() => {
    if (!auswahl && projekte[0]) setAuswahl(projekte[0].id)
  }, [auswahl, projekte])

  const holen = async () => {
    setLaeuft(true)
    setFehler(null)
    try {
      await jsonAnfrage('POST', projektPfad('/quellen/holen'), { projekt: auswahl })
      geholt()
    } catch (error) {
      setFehler((error as Error).message)
      setLaeuft(false)
    }
  }

  return (
    <OLModal show onHide={schliessen}>
      <OLModalHeader>
        <OLModalTitle>{t('spur_aus_projekt_holen')}</OLModalTitle>
      </OLModalHeader>
      <OLModalBody>
        {fehler && <Notification type="error" content={fehler} />}
        {projekte.length === 0 ? (
          <p>{t('spur_keine_anderen_projekte')}</p>
        ) : (
          <OLFormGroup controlId="spur-projekt-wahl">
            <OLFormLabel>{t('spur_projekt')}</OLFormLabel>
            <OLFormSelect
              value={auswahl}
              onChange={e => setAuswahl(e.target.value)}
            >
              {projekte.map(p => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </OLFormSelect>
          </OLFormGroup>
        )}
      </OLModalBody>
      <OLModalFooter>
        <OLButton variant="secondary" onClick={schliessen}>
          {t('cancel')}
        </OLButton>
        <OLButton
          variant="primary"
          disabled={!auswahl}
          isLoading={laeuft}
          onClick={holen}
        >
          {t('spur_holen')}
        </OLButton>
      </OLModalFooter>
    </OLModal>
  )
}
