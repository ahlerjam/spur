import { FormEvent, useEffect, useId, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { usePermissionsContext } from '@/features/ide-react/context/permissions-context'
import OLButton from '@/shared/components/ol/ol-button'
import OLFormControl from '@/shared/components/ol/ol-form-control'
import OLFormLabel from '@/shared/components/ol/ol-form-label'
import OLSpinner from '@/shared/components/ol/ol-spinner'
import Notification from '@/shared/components/notification'
import { anfrage, jsonAnfrage, projektPfad } from '../api'
import { pruefen } from './pruef-store'

type Liste = 'zitat' | 'ausgeblendet'
type Makros = Record<Liste, string[]> & { erkannt: Record<Liste, string[]> }

const LISTEN: Liste[] = ['zitat', 'ausgeblendet']
const PFAD = () => projektPfad('/pruefbericht/makros')

// Eingabe „\wort, note“ → ['wort', 'note']; null, wenn ein Name nicht nur aus Buchstaben (und @) besteht.
function namenLesen(text: string) {
  const namen = text
    .split(/[\s,]+/)
    .filter(Boolean)
    .map(n => n.replace(/^\\/, ''))
  return namen.every(n => /^[a-zA-Z@]+$/.test(n)) ? namen : null
}

export default function PruefEinstellungen() {
  const { t } = useTranslation()
  const id = useId()
  const { write } = usePermissionsContext()
  const knopf = useRef<HTMLButtonElement>(null)
  const [offen, setOffen] = useState(false)
  const [makros, setMakros] = useState<Makros | null>(null)
  const [eingabe, setEingabe] = useState<Record<Liste, string>>({ zitat: '', ausgeblendet: '' })
  const [feldFehler, setFeldFehler] = useState<Partial<Record<Liste, string>>>({})
  const [fehler, setFehler] = useState<string | null>(null)
  const [laeuft, setLaeuft] = useState(false)

  useEffect(() => {
    if (!offen) return
    setFehler(null)
    setMakros(null)
    anfrage<Makros>(PFAD())
      .then(daten => {
        setMakros(daten)
        setEingabe({ zitat: daten.zitat.join(', '), ausgeblendet: daten.ausgeblendet.join(', ') })
      })
      .catch(error => setFehler((error as Error).message))
  }, [offen])

  const speichern = async (e: FormEvent) => {
    e.preventDefault()
    const neu: Partial<Record<Liste, string[]>> = {}
    const falsch: Partial<Record<Liste, string>> = {}
    for (const liste of LISTEN) {
      const namen = namenLesen(eingabe[liste])
      if (namen) neu[liste] = namen
      else falsch[liste] = t('spur_makro_name_ungueltig')
    }
    setFeldFehler(falsch)
    if (Object.keys(falsch).length) return
    setLaeuft(true)
    setFehler(null)
    try {
      await jsonAnfrage('PUT', PFAD(), neu)
      setOffen(false)
      knopf.current?.focus()
      pruefen()
    } catch (error) {
      setFehler((error as Error).message)
    } finally {
      setLaeuft(false)
    }
  }

  const erkannt = (liste: Liste) => {
    const namen = makros?.erkannt[liste] ?? []
    return namen.length ? t('spur_automatisch_erkannt', { liste: namen.join(', ') }) : t('spur_nichts_erkannt')
  }

  return (
    <>
      <OLButton
        ref={knopf}
        variant="secondary"
        size="sm"
        aria-expanded={offen}
        aria-controls={`${id}-form`}
        onClick={() => setOffen(!offen)}
      >
        {t('spur_pruef_einstellungen')}
      </OLButton>
      {offen && (
        <form id={`${id}-form`} className="spur-pruef-einstellungen" onSubmit={speichern} noValidate>
          {fehler && <Notification type="error" content={fehler} />}
          {!makros && !fehler && <OLSpinner size="sm" />}
          {makros && !write && <p className="spur-zeile-meta">{t('spur_makros_nur_lesen')}</p>}
          {makros && LISTEN.map(liste => (
            <div key={liste} className="spur-pruef-feld">
              <OLFormLabel htmlFor={`${id}-${liste}`}>
                {t(liste === 'zitat' ? 'spur_zitatmakros' : 'spur_ausgeblendete_makros')}
              </OLFormLabel>
              <OLFormControl
                id={`${id}-${liste}`}
                value={eingabe[liste]}
                readOnly={!write}
                isInvalid={Boolean(feldFehler[liste])}
                aria-invalid={Boolean(feldFehler[liste])}
                aria-describedby={`${id}-${liste}-hilfe${feldFehler[liste] ? ` ${id}-${liste}-fehler` : ''}`}
                onChange={e => setEingabe({ ...eingabe, [liste]: e.target.value })}
              />
              {feldFehler[liste] && (
                <div id={`${id}-${liste}-fehler`} className="invalid-feedback d-block">
                  {feldFehler[liste]}
                </div>
              )}
              <p id={`${id}-${liste}-hilfe`} className="spur-zeile-meta">
                {erkannt(liste)}
              </p>
            </div>
          ))}
          {makros && <p className="spur-zeile-meta">{t('spur_makros_hilfe')}</p>}
          {makros && write && (
            <OLButton type="submit" variant="primary" size="sm" disabled={laeuft}>
              {t('save')}
            </OLButton>
          )}
        </form>
      )}
    </>
  )
}
