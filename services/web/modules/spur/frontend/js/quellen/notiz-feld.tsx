import { useEffect, useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import OLButton from '@/shared/components/ol/ol-button'
import OLFormControl from '@/shared/components/ol/ol-form-control'
import OLFormLabel from '@/shared/components/ol/ol-form-label'
import { jsonAnfrage, projektPfad } from '../api'

export type Notizen = Record<string, string>

export const notizSchluessel = (zitatId?: string | null) => zitatId ?? 'quelle'

export default function NotizFeld({
  quelleId,
  zitatId,
  label,
  gespeichert,
  darfSchreiben,
}: {
  quelleId: string
  zitatId?: string
  label: string
  gespeichert: string
  darfSchreiben: boolean
}) {
  const { t } = useTranslation()
  const id = useId()
  const [text, setText] = useState(gespeichert)
  const [stand, setStand] = useState<{ typ: 'ok' | 'fehler'; text: string } | null>(null)

  useEffect(() => setText(gespeichert), [gespeichert])

  const speichern = async () => {
    setStand(null)
    try {
      await jsonAnfrage('PUT', projektPfad(`/quellen/${quelleId}/notizen`), { zitat_id: zitatId, text })
      setStand({ typ: 'ok', text: t('spur_gespeichert') })
    } catch (error) {
      setStand({ typ: 'fehler', text: (error as Error).message })
    }
  }

  return (
    <div className="spur-notiz">
      <OLFormLabel htmlFor={id}>{label}</OLFormLabel>
      <OLFormControl
        id={id}
        as="textarea"
        rows={2}
        size="sm"
        value={text}
        readOnly={!darfSchreiben}
        onChange={e => {
          setText(e.target.value)
          setStand(null)
        }}
      />
      {darfSchreiben && (
        <div className="spur-notiz-aktion">
          <OLButton variant="secondary" size="sm" disabled={text === gespeichert && !stand} onClick={speichern}>
            {t('spur_notiz_speichern')}
          </OLButton>
          <span role="status" className={stand?.typ === 'fehler' ? 'spur-import-fehler' : 'spur-zeile-meta'}>
            {stand?.text}
          </span>
        </div>
      )}
    </div>
  )
}
