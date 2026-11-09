import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import OLButton from '@/shared/components/ol/ol-button'
import OLFormControl from '@/shared/components/ol/ol-form-control'
import OLFormLabel from '@/shared/components/ol/ol-form-label'
import OLSpinner from '@/shared/components/ol/ol-spinner'
import {
  OLModal,
  OLModalBody,
  OLModalFooter,
  OLModalHeader,
  OLModalTitle,
} from '@/shared/components/ol/ol-modal'
import Notification from '@/shared/components/notification'
import { usePermissionsContext } from '@/features/ide-react/context/permissions-context'
import { anfrage, jsonAnfrage, projektPfad } from '../api'

type Offenlegung = { text: string; leer: boolean }

export default function OffenlegungModal({ schliessen }: { schliessen: () => void }) {
  const { t } = useTranslation()
  const { write: darfSchreiben } = usePermissionsContext()
  const [modell, setModell] = useState('')
  const [daten, setDaten] = useState<Offenlegung | null>(null)
  const [meldung, setMeldung] = useState<{ typ: 'success' | 'error'; text: string } | null>(null)

  useEffect(() => {
    const zeit = setTimeout(() => {
      anfrage<Offenlegung>(projektPfad(`/offenlegung?${new URLSearchParams({ modell })}`))
        .then(setDaten)
        .catch(error => setMeldung({ typ: 'error', text: error.message }))
    }, 300)
    return () => clearTimeout(zeit)
  }, [modell])

  const kopieren = async () => {
    try {
      await navigator.clipboard.writeText(daten!.text)
      setMeldung({ typ: 'success', text: t('spur_kopiert') })
    } catch {
      setMeldung({ typ: 'error', text: t('spur_kopieren_fehlgeschlagen') })
    }
  }

  const einfuegen = async () => {
    try {
      const { pfad } = await jsonAnfrage<{ pfad: string }>('POST', projektPfad('/offenlegung/tex'), { modell })
      setMeldung({ typ: 'success', text: t('spur_offenlegung_eingefuegt', { pfad }) })
    } catch (error) {
      setMeldung({ typ: 'error', text: (error as Error).message })
    }
  }

  return (
    <OLModal show onHide={schliessen} size="lg">
      <OLModalHeader>
        <OLModalTitle>{t('spur_ki_offenlegung')}</OLModalTitle>
      </OLModalHeader>
      <OLModalBody>
        <OLFormLabel htmlFor="spur-offenlegung-modell">{t('spur_modell_freitext')}</OLFormLabel>
        <OLFormControl
          id="spur-offenlegung-modell"
          value={modell}
          placeholder={t('spur_modell_beispiel')}
          onChange={e => setModell(e.target.value)}
        />
        {!daten && !meldung && (
          <p className="spur-leer" role="status">
            <OLSpinner size="sm" /> {t('spur_offenlegung_laden')}
          </p>
        )}
        {daten && <p className="spur-offenlegung-text">{daten.text}</p>}
        <div role="status">{meldung && <Notification type={meldung.typ} content={meldung.text} />}</div>
      </OLModalBody>
      <OLModalFooter>
        <OLButton variant="secondary" onClick={schliessen}>
          {t('spur_schliessen')}
        </OLButton>
        <OLButton variant="secondary" disabled={!daten || daten.leer} onClick={kopieren}>
          {t('spur_text_kopieren')}
        </OLButton>
        {darfSchreiben && (
          <OLButton variant="primary" disabled={!daten || daten.leer} onClick={einfuegen}>
            {t('spur_als_tex_einfuegen')}
          </OLButton>
        )}
      </OLModalFooter>
    </OLModal>
  )
}
