import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import RailPanelHeader from '@/features/ide-react/components/rail/rail-panel-header'
import OLButton from '@/shared/components/ol/ol-button'
import OLFormControl from '@/shared/components/ol/ol-form-control'
import OLFormLabel from '@/shared/components/ol/ol-form-label'
import OLSpinner from '@/shared/components/ol/ol-spinner'
import Notification from '@/shared/components/notification'
import { usePermissionsContext } from '@/features/ide-react/context/permissions-context'
import { anfrage, jsonAnfrage, projektPfad } from '../api'
import QuelleLoeschenModal from './quelle-loeschen-modal'
import SeitenzahlBestaetigen from './seitenzahl-bestaetigen'
import Zitate from './zitate'
import { datumLang, OCR_SICHER_AB, type Quelle } from './typen'

type Seite = {
  text: string
  label: string | null
  seite: number
  seitenzahl: number
  ocrKonfidenz: number | null
}

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
  const [seite, setSeite] = useState<Seite | null>(null)
  const [fehler, setFehler] = useState<string | null>(null)
  const [fassung, setFassung] = useState(quelle.fassung)
  const [gespeichert, setGespeichert] = useState(false)
  const [loeschDialog, setLoeschDialog] = useState(false)
  const [textElement, setTextElement] = useState<HTMLElement | null>(null)
  const basis = `/quellen/${quelle.id}`

  useEffect(() => {
    let aktuell = true
    setSeite(null)
    anfrage<Seite>(projektPfad(`${basis}/seiten/${nummer}`))
      .then(s => aktuell && setSeite(s))
      .catch(e => aktuell && setFehler(e.message))
    return () => {
      aktuell = false
    }
  }, [basis, nummer])

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
      <RailPanelHeader title={quelle.web ? (quelle.titel ?? quelle.dateiname) : quelle.dateiname} />
      <div className="spur-panel-werkzeuge">
        <OLButton variant="secondary" size="sm" onClick={schliessen}>
          {t('spur_zurueck')}
        </OLButton>
        {quelle.web ? (
          <span className="spur-seitenzahl">
            {t('spur_abgerufen_am', { datum: datumLang(quelle.web.abgerufenAm, i18n.language) })}
          </span>
        ) : (
          <>
            <span className="spur-seitenzahl" aria-live="polite">
              {seite?.label && quelle.art === 'pdf'
                ? t('spur_seite_label_von', {
                    seite: seite.label,
                    nr: nummer,
                    gesamt: quelle.seitenzahl,
                  })
                : t('spur_seite_von', { seite: nummer, gesamt: quelle.seitenzahl })}
            </span>
            <OLButton
              variant="ghost"
              size="sm"
              disabled={nummer <= 1}
              onClick={() => setNummer(nummer - 1)}
            >
              {t('spur_vorherige_seite')}
            </OLButton>
            <OLButton
              variant="ghost"
              size="sm"
              disabled={nummer >= quelle.seitenzahl}
              onClick={() => setNummer(nummer + 1)}
            >
              {t('spur_naechste_seite')}
            </OLButton>
          </>
        )}
      </div>
      <div className="spur-panel-inhalt">
        {fehler && <Notification type="error" content={fehler} />}
        {!seite && !fehler && <OLSpinner size="sm" />}
        {seite && quelle.art === 'pdf' && (
          <img
            className="spur-seitenbild"
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
        {seite?.text.trim() && (
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
