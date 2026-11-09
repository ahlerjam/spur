import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import OLButton from '@/shared/components/ol/ol-button'
import OLSpinner from '@/shared/components/ol/ol-spinner'
import OLIconButton from '@/shared/components/ol/ol-icon-button'
import Notification from '@/shared/components/notification'
import {
  OLModal,
  OLModalBody,
  OLModalHeader,
  OLModalTitle,
} from '@/shared/components/ol/ol-modal'
import { projektPfad } from '../api'
import { useSeite } from './seite'
import SeitenBlaettern from './seiten-blaettern'
import Seitenbild from './seitenbild'
import Zitate from './zitate'
import { anzeigename, type Quelle } from './typen'

const ZOOM = [75, 100, 125, 150, 200]

export default function QuelleGross({
  quelle,
  startSeite,
  schliessen,
}: {
  quelle: Quelle
  startSeite: number
  schliessen: () => void
}) {
  const { t } = useTranslation()
  const [nummer, setNummer] = useState(startSeite)
  const [stufe, setStufe] = useState(ZOOM.indexOf(100))
  const [textElement, setTextElement] = useState<HTMLElement | null>(null)
  const { seite, fehler } = useSeite(quelle.id, nummer)
  const zoom = ZOOM[stufe]
  const mitBild = quelle.art === 'pdf'

  return (
    <OLModal show onHide={schliessen} className="spur-gross">
      <OLModalHeader closeButton={false}>
        <OLModalTitle as="h2">{anzeigename(quelle)}</OLModalTitle>
        <OLButton variant="secondary" size="sm" onClick={schliessen}>
          {t('close')}
        </OLButton>
      </OLModalHeader>
      <div className="spur-gross-werkzeuge">
        {!quelle.web && (
          <SeitenBlaettern quelle={quelle} nummer={nummer} seite={seite} setNummer={setNummer} />
        )}
        {mitBild && (
          <div className="spur-zoom" role="group" aria-label={t('spur_zoom')}>
            <OLIconButton
              variant="ghost"
              size="sm"
              icon="zoom_out"
              accessibilityLabel={t('spur_verkleinern')}
              disabled={stufe === 0}
              onClick={() => setStufe(stufe - 1)}
            />
            <span className="spur-zoom-wert" aria-live="polite">
              {zoom} %
            </span>
            <OLIconButton
              variant="ghost"
              size="sm"
              icon="zoom_in"
              accessibilityLabel={t('spur_vergroessern')}
              disabled={stufe === ZOOM.length - 1}
              onClick={() => setStufe(stufe + 1)}
            />
          </div>
        )}
      </div>
      <OLModalBody className="spur-gross-inhalt">
        {mitBild && (
          <div className="spur-gross-bild" tabIndex={0} aria-label={t('spur_seitenbild')}>
            {seite && (
              <Seitenbild
                style={{ width: `calc(min(100%, 900px) * ${zoom / 100})` }}
                alt={t('spur_seite_von', { seite: nummer, gesamt: quelle.seitenzahl })}
                src={projektPfad(`/quellen/${quelle.id}/seiten/${nummer}/bild`)}
              />
            )}
          </div>
        )}
        <div className="spur-gross-text">
          {fehler && <Notification type="warning" content={fehler} />}
          {!seite && !fehler && <OLSpinner size="sm" />}
          {seite?.text.trim() ? (
            <>
              <pre className="spur-seitentext" ref={setTextElement}>
                {seite.text}
              </pre>
              <Zitate quelle={quelle} seite={nummer} textElement={textElement} />
            </>
          ) : (
            seite && <p className="spur-leer">{t('spur_kein_text')}</p>
          )}
        </div>
      </OLModalBody>
    </OLModal>
  )
}
