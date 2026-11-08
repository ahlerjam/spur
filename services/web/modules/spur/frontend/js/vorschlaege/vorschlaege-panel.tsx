import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import RailPanelHeader from '@/features/ide-react/components/rail/rail-panel-header'
import { usePermissionsContext } from '@/features/ide-react/context/permissions-context'
import OLBadge from '@/shared/components/ol/ol-badge'
import OLButton from '@/shared/components/ol/ol-button'
import OLFormControl from '@/shared/components/ol/ol-form-control'
import OLFormLabel from '@/shared/components/ol/ol-form-label'
import OLFormSelect from '@/shared/components/ol/ol-form-select'
import Notification from '@/shared/components/notification'
import { useAbfrage } from '../abfrage'
import { jsonAnfrage, projektPfad } from '../api'

const ARTEN = ['compile_fehler', 'belegloses_argument'] as const
type Art = (typeof ARTEN)[number]
type Wert = 'aus' | 'vorschlag'
type Stand = {
  eigene: Record<Art, Wert | null>
  projekt: Record<Art, Wert | null>
  wirksam: Record<Art, Wert>
  limit: number
  heute: number
  limitErreicht: boolean
}
type Vorschlag = { id: string; art: Art; titel: string; text: string; pfad: string | null; am: string }
type Antwort = { stand: Stand; vorschlaege: Vorschlag[] }

export default function VorschlaegePanel() {
  const { t } = useTranslation()
  const { daten, fehler, setFehler, laden } = useAbfrage<Antwort>(projektPfad('/vorschlaege'))

  const speichern = async (pfad: string, body: unknown) => {
    setFehler(null)
    try {
      await jsonAnfrage('PUT', pfad, body)
      await laden()
    } catch (error) {
      setFehler((error as Error).message)
    }
  }

  return (
    <div className="spur-panel">
      <RailPanelHeader title={t('spur_vorschlaege')} />
      <div className="spur-panel-inhalt" aria-busy={!daten}>
        {fehler && <Notification type="error" content={fehler} />}
        {daten && (
          <>
            <Einstellungen stand={daten.stand} speichern={speichern} />
            <Liste daten={daten} neuLaden={laden} fehler={setFehler} />
          </>
        )}
      </div>
    </div>
  )
}

function Einstellungen({
  stand,
  speichern,
}: {
  stand: Stand
  speichern: (pfad: string, body: unknown) => Promise<void>
}) {
  const { t } = useTranslation()
  const { write } = usePermissionsContext()
  const [limit, setLimit] = useState(String(stand.limit))
  useEffect(() => setLimit(String(stand.limit)), [stand.limit])
  const wertName = (wert: Wert) => t(`spur_vorschlag_${wert}`)

  return (
    <section className="spur-vorschlag-einstellungen" aria-labelledby="spur-vorschlag-einstellungen">
      <h3 id="spur-vorschlag-einstellungen" className="spur-abschnitt">
        {t('spur_vorschlag_eigene')}
      </h3>
      {ARTEN.map(art => (
        <div className="spur-vorschlag-schalter" key={art}>
          <OLFormLabel htmlFor={`spur-schalter-${art}`}>{t(`spur_vorschlag_${art}`)}</OLFormLabel>
          <OLFormSelect
            id={`spur-schalter-${art}`}
            size="sm"
            value={stand.eigene[art] ?? ''}
            onChange={e =>
              speichern(projektPfad('/vorschlaege/eigene'), { art, wert: e.target.value || null })
            }
          >
            <option value="">
              {t('spur_vorschlag_wie_projekt', { wert: wertName(stand.projekt[art] ?? 'aus') })}
            </option>
            <option value="aus">{wertName('aus')}</option>
            <option value="vorschlag">{wertName('vorschlag')}</option>
          </OLFormSelect>
        </div>
      ))}
      {write && (
        <fieldset className="spur-vorschlag-projekt">
          <legend className="spur-abschnitt">{t('spur_vorschlag_projekt_standard')}</legend>
          {ARTEN.map(art => (
            <div className="spur-vorschlag-schalter" key={art}>
              <OLFormLabel htmlFor={`spur-projekt-${art}`}>
                {t('spur_vorschlag_projekt_label', { art: t(`spur_vorschlag_${art}`) })}
              </OLFormLabel>
              <OLFormSelect
                id={`spur-projekt-${art}`}
                size="sm"
                value={stand.projekt[art] ?? 'aus'}
                onChange={e => speichern(projektPfad('/vorschlaege/projekt'), { art, wert: e.target.value })}
              >
                <option value="aus">{wertName('aus')}</option>
                <option value="vorschlag">{wertName('vorschlag')}</option>
              </OLFormSelect>
            </div>
          ))}
        </fieldset>
      )}
      <form
        className="spur-vorschlag-limit"
        onSubmit={e => {
          e.preventDefault()
          speichern('/spur/vorschlaege/limit', { limit: Number(limit) })
        }}
      >
        <OLFormLabel htmlFor="spur-vorschlag-limit">{t('spur_vorschlag_limit')}</OLFormLabel>
        <div className="spur-limit-zeile">
          <OLFormControl
            id="spur-vorschlag-limit"
            type="number"
            min={1}
            max={1000}
            size="sm"
            value={limit}
            onChange={e => setLimit(e.target.value)}
          />
          <OLButton type="submit" variant="secondary" size="sm">
            {t('spur_vorschlag_limit_speichern')}
          </OLButton>
        </div>
      </form>
      <div role="status">
        {/* Kein Notification-Kasten: Im schmalen Panel bräche dessen Symbolspalte den Text Wort für Wort um. */}
        {stand.limitErreicht ? (
          <>
            <OLBadge bg="warning">{t('spur_vorschlag_limit_erreicht')}</OLBadge>
            <p className="spur-zeile-meta">{t('spur_vorschlag_limit_erreicht_hinweis')}</p>
          </>
        ) : (
          <p className="spur-zeile-meta">
            {t('spur_vorschlag_heute', { heute: stand.heute, limit: stand.limit })}
          </p>
        )}
      </div>
    </section>
  )
}

function Liste({
  daten,
  neuLaden,
  fehler,
}: {
  daten: Antwort
  neuLaden: () => Promise<void>
  fehler: (f: string | null) => void
}) {
  const { t } = useTranslation()
  const ueberschrift = useRef<HTMLHeadingElement>(null)
  const [laeuft, setLaeuft] = useState<string | null>(null)
  const [meldung, setMeldung] = useState<string | null>(null)
  const alleAus = ARTEN.every(art => daten.stand.wirksam[art] === 'aus')

  const erledigen = async (vorschlag: Vorschlag, aktion: 'uebernehmen' | 'verwerfen') => {
    setLaeuft(vorschlag.id)
    fehler(null)
    setMeldung(null)
    try {
      await jsonAnfrage('POST', projektPfad(`/vorschlaege/${vorschlag.id}/${aktion}`))
      if (aktion === 'uebernehmen') setMeldung(t('spur_vorschlag_uebernommen'))
      await neuLaden()
      // Die Karte ist weg; der Fokus bleibt in der Liste statt auf dem Seitenkörper.
      ueberschrift.current?.focus()
    } catch (error) {
      fehler((error as Error).message)
    } finally {
      setLaeuft(null)
    }
  }

  return (
    <section aria-labelledby="spur-vorschlaege-liste">
      <h3 id="spur-vorschlaege-liste" className="spur-abschnitt" ref={ueberschrift} tabIndex={-1}>
        {t('spur_vorschlaege_offen', { anzahl: daten.vorschlaege.length })}
      </h3>
      <div role="status">{meldung && <Notification type="success" content={meldung} />}</div>
      {daten.vorschlaege.length === 0 && (
        <p className="spur-leer">{alleAus ? t('spur_vorschlaege_aus') : t('spur_vorschlaege_keine')}</p>
      )}
      <ul className="spur-liste spur-vorschlaege">
        {daten.vorschlaege.map(v => (
          <li key={v.id}>
            <article className="spur-vorschlag-karte" aria-labelledby={`spur-vorschlag-${v.id}`}>
              <div className="spur-lauf-kopf">
                <h4 id={`spur-vorschlag-${v.id}`}>{v.titel}</h4>
                <OLBadge bg="info">{t(`spur_vorschlag_${v.art}`)}</OLBadge>
              </div>
              {v.pfad && <p className="spur-zeile-meta">{v.pfad}</p>}
              <p className="spur-nachricht-text">{v.text}</p>
              <div className="spur-vorschlag-aktionen">
                <OLButton
                  variant="primary"
                  size="sm"
                  isLoading={laeuft === v.id}
                  onClick={() => erledigen(v, 'uebernehmen')}
                >
                  {t('spur_vorschlag_uebernehmen')}
                </OLButton>
                <OLButton
                  variant="secondary"
                  size="sm"
                  disabled={laeuft === v.id}
                  onClick={() => erledigen(v, 'verwerfen')}
                >
                  {t('spur_vorschlag_verwerfen')}
                </OLButton>
              </div>
            </article>
          </li>
        ))}
      </ul>
    </section>
  )
}
