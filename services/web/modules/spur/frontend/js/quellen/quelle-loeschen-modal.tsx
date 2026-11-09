import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import OLButton from '@/shared/components/ol/ol-button'
import {
  OLModal,
  OLModalBody,
  OLModalFooter,
  OLModalHeader,
  OLModalTitle,
} from '@/shared/components/ol/ol-modal'
import Notification from '@/shared/components/notification'
import { jsonAnfrage, projektPfad } from '../api'
import { pruefen, pruefStore } from '../pruefung/pruef-store'
import type { Quelle } from './typen'

export default function QuelleLoeschenModal({
  quelle,
  schliessen,
  geloescht,
}: {
  quelle: Quelle
  schliessen: () => void
  geloescht: () => void
}) {
  const { t } = useTranslation()
  const [zitate, setZitate] = useState<number | null>(null)
  const [fehler, setFehler] = useState<string | null>(null)
  const [laeuft, setLaeuft] = useState(false)

  useEffect(() => {
    pruefen().then(() => {
      const zeilen = pruefStore.zustand().bericht?.zeilen ?? []
      setZitate(zeilen.filter(z => z.key === quelle.key).length)
    })
  }, [quelle.key])

  const loeschen = async () => {
    setLaeuft(true)
    setFehler(null)
    try {
      await jsonAnfrage('DELETE', projektPfad(`/quellen/${quelle.id}`))
      await pruefen()
      geloescht()
    } catch (error) {
      setFehler((error as Error).message)
      setLaeuft(false)
    }
  }

  return (
    <OLModal show onHide={schliessen}>
      <OLModalHeader>
        <OLModalTitle>{t('spur_quelle_loeschen')}</OLModalTitle>
      </OLModalHeader>
      <OLModalBody>
        {fehler && <Notification type="error" content={fehler} />}
        <p>{t('spur_quelle_loeschen_frage', { name: quelle.dateiname })}</p>
        {zitate !== null && (
          <p>{t('spur_zitate_betroffen', { count: zitate })}</p>
        )}
      </OLModalBody>
      <OLModalFooter>
        <OLButton variant="secondary" onClick={schliessen}>
          {t('cancel')}
        </OLButton>
        <OLButton variant="danger" isLoading={laeuft} onClick={loeschen}>
          {t('spur_endgueltig_loeschen')}
        </OLButton>
      </OLModalFooter>
    </OLModal>
  )
}
