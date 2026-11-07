import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import OLButton from '@/shared/components/ol/ol-button'
import OLFormControl from '@/shared/components/ol/ol-form-control'
import OLFormLabel from '@/shared/components/ol/ol-form-label'
import Notification from '@/shared/components/notification'
import { jsonAnfrage, projektPfad } from '../api'
import { pruefenVerzoegert } from '../pruefung/pruef-store'
import type { Quelle } from './typen'

export default function SeitenzahlBestaetigen({
  quelle,
  pdfSeite,
  label,
}: {
  quelle: Quelle
  pdfSeite: number
  label: string | null
}) {
  const { t } = useTranslation()
  const [gedruckt, setGedruckt] = useState(label ?? '')
  const [bestaetigt, setBestaetigt] = useState(quelle.versatzQuelle === 'bestaetigt')
  const [fehler, setFehler] = useState<string | null>(null)

  const speichern = async () => {
    setFehler(null)
    // Gedruckte Seitenzahlen sind ganze Zahlen ab 1; „1.5“ oder „-5“ nicht still umdeuten.
    const text = gedruckt.trim()
    const zahl = Number(text)
    if (!/^\d+$/.test(text) || zahl < 1) {
      setFehler(t('spur_seitenzahl_ungueltig'))
      return
    }
    try {
      await jsonAnfrage('PATCH', projektPfad(`/quellen/${quelle.id}`), {
        versatz: zahl - pdfSeite,
      })
      setBestaetigt(true)
      pruefenVerzoegert()
    } catch (error) {
      setFehler((error as Error).message)
    }
  }

  return (
    <form
      className="spur-fassung"
      onSubmit={e => {
        e.preventDefault()
        speichern()
      }}
    >
      <OLFormLabel htmlFor="spur-seitenzahl">{t('spur_gedruckte_seitenzahl')}</OLFormLabel>
      <OLFormControl
        id="spur-seitenzahl"
        size="sm"
        inputMode="numeric"
        value={gedruckt}
        onChange={e => {
          setGedruckt(e.target.value)
          setBestaetigt(false)
        }}
      />
      <OLButton type="submit" variant="secondary" size="sm">
        {t('spur_seitenzahl_bestaetigen')}
      </OLButton>
      {bestaetigt && (
        <span role="status" className="spur-zeile-meta">
          {t('spur_seitenzahl_bestaetigt')}
        </span>
      )}
      {fehler && <Notification type="error" content={fehler} />}
    </form>
  )
}
