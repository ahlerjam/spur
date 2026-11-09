import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import RailPanelHeader from '@/features/ide-react/components/rail/rail-panel-header'
import OLButton from '@/shared/components/ol/ol-button'
import OLIconButton from '@/shared/components/ol/ol-icon-button'
import OLFormControl from '@/shared/components/ol/ol-form-control'
import OLFormLabel from '@/shared/components/ol/ol-form-label'
import OLSpinner from '@/shared/components/ol/ol-spinner'
import Notification from '@/shared/components/notification'
import { usePermissionsContext } from '@/features/ide-react/context/permissions-context'
import { jsonAnfrage, projektPfad } from '../api'
import QuelleGross from './quelle-gross'
import QuelleLoeschenModal from './quelle-loeschen-modal'
import { useSeite } from './seite'
import SeitenBlaettern from './seiten-blaettern'
import SeitenzahlBestaetigen from './seitenzahl-bestaetigen'
import Seitenbild from './seitenbild'
import Zitate from './zitate'
import { anzeigename, datumLang, OCR_SICHER_AB, type Quelle } from './typen'

export default function QuelleVorschau({
  quelle,
  startSeite,
  schliessen,
}: {
  quelle: Quelle
  startSeite: number
  schliessen: () => void
}) {
  const { t, i18n } = useTranslation()
  const { write: darfSchreiben } = usePermissionsContext()
  const [nummer, setNummer] = useState(startSeite)
  const { seite, fehler: seitenFehler } = useSeite(quelle.id, nummer)
  const [fehler, setFehler] = useState<string | null>(null)
  const [fassung, setFassung] = useState(quelle.fassung)
  const [gespeichert, setGespeichert] = useState(false)
  const [loeschDialog, setLoeschDialog] = useState(false)
  const [textElement, setTextElement] = useState<HTMLElement | null>(null)
  const [gross, setGross] = useState(false)
  const basis = `/quellen/${quelle.id}`

  const fassungSpeichern = async () => {
    setFehler(null)
    try {
      await jsonAnfrage('PATCH', projektPfad(basis), { fassung })
      setGespeichert(true)
    } catch (error) {
      setFehler((error as Error).message)
    }
  }

  return (
    <div className="spur-panel">
      <RailPanelHeader title={anzeigename(quelle)} />
      <div className="spur-panel-werkzeuge">
        <OLIconButton
          variant="secondary"
          size="sm"
          icon="arrow_back"
          accessibilityLabel={t('spur_zurueck')}
          onClick={schliessen}
        />
        {quelle.web ? (
          <span className="spur-seitenzahl">
            {t('spur_abgerufen_am', { datum: datumLang(quelle.web.abgerufenAm, i18n.language) })}
          </span>
        ) : (
          <SeitenBlaettern quelle={quelle} nummer={nummer} seite={seite} setNummer={setNummer} />
        )}
      </div>
      <div className="spur-panel-inhalt">
        {seitenFehler && <Notification type="warning" content={seitenFehler} />}
        {fehler && <Notification type="error" content={fehler} />}
        {!seite && !seitenFehler && <OLSpinner size="sm" />}
        {seite && (
          <OLButton
            className="spur-gross-oeffnen"
            variant="secondary"
            size="sm"
            leadingIcon="open_in_full"
            onClick={() => setGross(true)}
          >
            {t('spur_gross_oeffnen')}
          </OLButton>
        )}
        {seite && quelle.art === 'pdf' && (
          <Seitenbild
            alt={t('spur_seite_von', { seite: nummer, gesamt: quelle.seitenzahl })}
            src={projektPfad(`${basis}/seiten/${nummer}/bild`)}
          />
        )}
        {seite?.label && quelle.art === 'vtt' && (
          <p className="spur-zeile-meta">{seite.label}</p>
        )}
        {quelle.web && (
          <p className="spur-zeile-auszug">
            {t('spur_schnappschuss_von', { url: quelle.web.url })}
          </p>
        )}
        {seite && quelle.status === 'ocr' && (
          <p className="spur-ocr-hinweis">
            {seite.ocrKonfidenz != null && seite.ocrKonfidenz < OCR_SICHER_AB
              ? t('spur_ocr_seite_unsicher', { konfidenz: seite.ocrKonfidenz })
              : t('spur_ocr_seite')}
          </p>
        )}
        {seite?.text.trim() ? (
          <pre className="spur-seitentext" ref={setTextElement}>
            {seite.text}
          </pre>
        ) : (
          seite && <p className="spur-leer">{t('spur_kein_text')}</p>
        )}
        {/* Solange die große Ansicht offen ist, arbeitet nur deren Zitatliste (sonst doppelte IDs und Zustände). */}
        {seite?.text.trim() && !gross && (
          <Zitate quelle={quelle} seite={nummer} textElement={textElement} />
        )}
        {darfSchreiben && seite && quelle.art === 'pdf' && seite.text.trim() && (
          <SeitenzahlBestaetigen
            key={nummer}
            quelle={quelle}
            pdfSeite={nummer}
            label={seite.label}
          />
        )}
        {darfSchreiben && (
          <form
            className="spur-fassung"
            onSubmit={e => {
              e.preventDefault()
              fassungSpeichern()
            }}
          >
            <OLFormLabel htmlFor="spur-fassung">{t('spur_fassung')}</OLFormLabel>
            <OLFormControl
              id="spur-fassung"
              size="sm"
              value={fassung}
              maxLength={200}
              onChange={e => {
                setFassung(e.target.value)
                setGespeichert(false)
              }}
            />
            <OLButton type="submit" variant="secondary" size="sm">
              {t('save')}
            </OLButton>
            {gespeichert && (
              <span role="status" className="spur-zeile-meta">
                {t('spur_gespeichert')}
              </span>
            )}
          </form>
        )}
        {darfSchreiben && (
          <OLButton
            className="spur-loeschen"
            variant="danger-ghost"
            size="sm"
            onClick={() => setLoeschDialog(true)}
          >
            {t('spur_quelle_loeschen')}
          </OLButton>
        )}
      </div>
      {gross && (
        <QuelleGross quelle={quelle} startSeite={nummer} schliessen={() => setGross(false)} />
      )}
      {loeschDialog && (
        <QuelleLoeschenModal
          quelle={quelle}
          schliessen={() => setLoeschDialog(false)}
          geloescht={schliessen}
        />
      )}
    </div>
  )
}
