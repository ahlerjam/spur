import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import RailPanelHeader from '@/features/ide-react/components/rail/rail-panel-header'
import { usePermissionsContext } from '@/features/ide-react/context/permissions-context'
import OLBadge from '@/shared/components/ol/ol-badge'
import OLButton from '@/shared/components/ol/ol-button'
import LadeKnopf from '../lade-knopf'
import OLFormControl from '@/shared/components/ol/ol-form-control'
import OLFormLabel from '@/shared/components/ol/ol-form-label'
import OLFormSelect from '@/shared/components/ol/ol-form-select'
import OLFormText from '@/shared/components/ol/ol-form-text'
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
        {!daten && !fehler && <EinstellungenPlatzhalter />}
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

function EinstellungenPlatzhalter() {
  const { t } = useTranslation()
  return (
    <div className="spur-vorschlag-einstellungen" role="status" aria-label={t('spur_laedt')}>
      {[0, 1, 2].map(i => (
        <div key={i} className="spur-vorschlag-zeile spur-platzhalter-zeile" aria-hidden="true">
          <span className="placeholder col-6" />
          <span className="placeholder col-4" />
        </div>
      ))}
    </div>
  )
}

const LIMIT = /^[1-9]\d{0,3}$/

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
  const [limitFehler, setLimitFehler] = useState(false)
  const limitFeld = useRef<HTMLInputElement>(null)
  useEffect(() => setLimit(String(stand.limit)), [stand.limit])
  const wertName = (wert: Wert) => t(`spur_vorschlag_${wert}`)

  const limitSpeichern = () => {
    const ok = LIMIT.test(limit.trim()) && Number(limit) <= 1000
    setLimitFehler(!ok)
    if (!ok) return limitFeld.current?.focus()
    speichern('/spur/vorschlaege/limit', { limit: Number(limit) })
  }

  return (
    <div className="spur-vorschlag-einstellungen">
      <section className="spur-vorschlag-bereich" aria-labelledby="spur-vorschlag-eigene">
        <h5 id="spur-vorschlag-eigene" className="spur-abschnitt">
          {t('spur_vorschlag_eigene')}
        </h5>
        {ARTEN.map(art => (
          <div className="spur-vorschlag-zeile" key={art}>
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
        <form
          className="spur-vorschlag-limit"
          noValidate
          onSubmit={e => {
            e.preventDefault()
            limitSpeichern()
          }}
        >
          <OLFormLabel htmlFor="spur-vorschlag-limit">{t('spur_vorschlag_limit')}</OLFormLabel>
          <div className="spur-limit-zeile">
            <OLFormControl
              ref={limitFeld}
              id="spur-vorschlag-limit"
              inputMode="numeric"
              size="sm"
              value={limit}
              isInvalid={limitFehler}
              aria-invalid={limitFehler || undefined}
              aria-describedby={limitFehler ? 'spur-limit-fehler spur-limit-stand' : 'spur-limit-stand'}
              onChange={e => {
                setLimit(e.target.value)
                setLimitFehler(false)
              }}
            />
            <span className="spur-zeile-meta" id="spur-limit-stand" role="status">
              {stand.limitErreicht
                ? t('spur_vorschlag_limit_erreicht')
                : t('spur_vorschlag_heute', { heute: stand.heute, limit: stand.limit })}
            </span>
            <OLButton type="submit" variant="secondary" size="sm">
              {t('save')}
            </OLButton>
          </div>
          {limitFehler && (
            <OLFormText type="error" id="spur-limit-fehler">
              {t('spur_vorschlag_limit_ungueltig')}
            </OLFormText>
          )}
          {/* Kein Notification-Kasten: Im schmalen Panel bräche dessen Symbolspalte den Text Wort für Wort um. */}
          {stand.limitErreicht && <p className="spur-zeile-meta">{t('spur_vorschlag_limit_erreicht_hinweis')}</p>}
        </form>
      </section>
      {write && (
        <section className="spur-vorschlag-bereich" aria-labelledby="spur-vorschlag-projekt">
          <h5 id="spur-vorschlag-projekt" className="spur-abschnitt">
            {t('spur_vorschlag_projekt_standard')}
          </h5>
          {ARTEN.map(art => (
            <div className="spur-vorschlag-zeile" key={art}>
              <OLFormLabel htmlFor={`spur-projekt-${art}`}>
                {t(`spur_vorschlag_${art}`)}
                <span className="visually-hidden"> ({t('spur_projekt')})</span>
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
        </section>
      )}
    </div>
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
      <h5 id="spur-vorschlaege-liste" className="spur-abschnitt" ref={ueberschrift} tabIndex={-1}>
        {t('spur_vorschlaege_offen', { anzahl: daten.vorschlaege.length })}
      </h5>
      <div role="status">{meldung && <p className="spur-vorschlag-meldung">{meldung}</p>}</div>
      {daten.vorschlaege.length === 0 && (
        <p className="spur-leer">{alleAus ? t('spur_vorschlaege_aus') : t('spur_vorschlaege_keine')}</p>
      )}
      <ul className="spur-liste spur-vorschlaege">
        {daten.vorschlaege.map(v => (
          <li key={v.id}>
            <article className="spur-vorschlag-karte" aria-labelledby={`spur-vorschlag-${v.id}`}>
              <div className="spur-lauf-kopf">
                <h6 id={`spur-vorschlag-${v.id}`}>{v.titel}</h6>
                <OLBadge bg="info">{t(`spur_vorschlag_${v.art}`)}</OLBadge>
              </div>
              {v.pfad && <p className="spur-zeile-meta">{v.pfad}</p>}
              <p className="spur-nachricht-text">{v.text}</p>
              <div className="spur-vorschlag-aktionen">
                <LadeKnopf
                  variant="primary"
                  size="sm"
                  isLoading={laeuft === v.id}
                  onClick={() => erledigen(v, 'uebernehmen')}
                >
                  {t('spur_vorschlag_uebernehmen')}
                </LadeKnopf>
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
