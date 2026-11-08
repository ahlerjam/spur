import { useEffect, useId, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import OLButton from '@/shared/components/ol/ol-button'
import OLFormControl from '@/shared/components/ol/ol-form-control'
import OLFormLabel from '@/shared/components/ol/ol-form-label'
import OLFormSelect from '@/shared/components/ol/ol-form-select'
import Notification from '@/shared/components/notification'
import { anfrage, jsonAnfrage, projektPfad } from '../api'
import type { Person, Zitat } from './typen'

function KommentarFormular({
  pfad,
  fertig,
  abbrechen,
}: {
  pfad: string
  fertig: () => void
  abbrechen: () => void
}) {
  const { t } = useTranslation()
  const [text, setText] = useState('')
  const [zuweisen, setZuweisen] = useState('')
  const [team, setTeam] = useState<Person[]>([])
  const [fehler, setFehler] = useState<string | null>(null)
  const [sendet, setSendet] = useState(false)
  const feld = useRef<HTMLInputElement>(null)
  const id = useId()

  useEffect(() => {
    feld.current?.focus()
    anfrage<{ mitglieder: Person[] }>(projektPfad('/team'))
      .then(antwort => setTeam(antwort.mitglieder))
      .catch(error => setFehler(error.message))
  }, [])

  const senden = async () => {
    setFehler(null)
    setSendet(true)
    try {
      await jsonAnfrage('POST', pfad, { text, ...(zuweisen ? { zuweisen } : {}) })
      fertig()
    } catch (error) {
      setFehler((error as Error).message)
      setSendet(false)
    }
  }

  return (
    <form
      className="spur-kommentar-form"
      onSubmit={e => {
        e.preventDefault()
        senden()
      }}
    >
      {fehler && <Notification type="error" content={fehler} />}
      <OLFormLabel htmlFor={`${id}-text`}>{t('spur_kommentar')}</OLFormLabel>
      <OLFormControl
        ref={feld}
        as="textarea"
        id={`${id}-text`}
        rows={2}
        maxLength={2000}
        value={text}
        onChange={e => setText(e.target.value)}
      />
      <OLFormLabel htmlFor={`${id}-an`}>{t('spur_zuweisen_an')}</OLFormLabel>
      <OLFormSelect
        id={`${id}-an`}
        size="sm"
        value={zuweisen}
        onChange={e => setZuweisen(e.target.value)}
      >
        <option value="">{t('spur_niemandem')}</option>
        {team.map(person => (
          <option key={person.id} value={person.id}>
            {person.name}
          </option>
        ))}
      </OLFormSelect>
      <div className="spur-kommentar-knoepfe">
        <OLButton
          type="submit"
          variant="primary"
          size="sm"
          disabled={!text.trim()}
          isLoading={sendet}
        >
          {t('spur_kommentar_senden')}
        </OLButton>
        <OLButton variant="secondary" size="sm" onClick={abbrechen}>
          {t('cancel')}
        </OLButton>
      </div>
    </form>
  )
}

export default function ZitatKommentare({
  zitat,
  basis,
  darfKommentieren,
  geaendert,
}: {
  zitat: Zitat
  basis: string
  darfKommentieren: boolean
  geaendert: () => void
}) {
  const { t } = useTranslation()
  const [offen, setOffen] = useState(false)
  const knopf = useRef<HTMLButtonElement>(null)

  const schliessen = () => {
    setOffen(false)
    // Nach dem Senden oder Abbrechen bleibt der Fokus beim Zitat statt auf BODY.
    setTimeout(() => knopf.current?.focus())
  }

  return (
    <>
      {zitat.zugewiesen && (
        <p className="spur-zeile-meta spur-zugewiesen">
          {t('spur_zugewiesen_an', { name: zitat.zugewiesen.an.name })}
        </p>
      )}
      {zitat.kommentare.length > 0 && (
        <ul className="spur-kommentare">
          {zitat.kommentare.map(k => (
            <li key={k.id}>
              <span className="spur-kommentar-von">{k.von.name}:</span> {k.text}
            </li>
          ))}
        </ul>
      )}
      {darfKommentieren &&
        (offen ? (
          <KommentarFormular
            pfad={projektPfad(`${basis}/${zitat.id}/kommentare`)}
            fertig={() => {
              schliessen()
              geaendert()
            }}
            abbrechen={schliessen}
          />
        ) : (
          <OLButton ref={knopf} variant="ghost" size="sm" onClick={() => setOffen(true)}>
            {t('spur_kommentieren')}
          </OLButton>
        ))}
    </>
  )
}
