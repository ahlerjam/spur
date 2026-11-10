import { type FormEvent, useCallback, useEffect, useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import useWaitForI18n from '@/shared/hooks/use-wait-for-i18n'
import OLBadge from '@/shared/components/ol/ol-badge'
import OLButton from '@/shared/components/ol/ol-button'
import OLFormCheckbox from '@/shared/components/ol/ol-form-checkbox'
import OLFormControl from '@/shared/components/ol/ol-form-control'
import OLFormLabel from '@/shared/components/ol/ol-form-label'
import OLFormSelect from '@/shared/components/ol/ol-form-select'
import Notification from '@/shared/components/notification'
import { anfrage, ApiFehler, jsonAnfrage } from '../api'

type Standard = { projekte: number | null; speicherGb: number | null; texPaketeAus: boolean }
type Nutzer = {
  id: string
  email: string
  name: string
  projekte: number
  grenze: number | null
  ausnahme: { projekte?: number | null; speicherGb?: number | null }
}
type Projekt = { id: string; name: string; eigentuemer: string; bytes: number; grenze: number | null }
type Daten = { standard: Standard; nutzer: Nutzer[]; projekte: Projekt[] }
type Feld = 'projekte' | 'speicherGb'

const PFAD = '/spur/admin/grenzen'
const GB = 1024 ** 3

const auslastung = (wert: number, grenze: number | null) =>
  grenze === null ? 0 : grenze === 0 ? (wert > 0 ? Infinity : 1) : wert / grenze

function useZahl() {
  const { i18n } = useTranslation()
  const format = new Intl.NumberFormat(i18n.language, { maximumFractionDigits: 2 })
  return (zahl: number) => format.format(zahl)
}

function Markierung({ anteil }: { anteil: number }) {
  const { t } = useTranslation()
  if (anteil > 1) return <OLBadge bg="danger">{t('spur_grenze_ueberschritten')}</OLBadge>
  if (anteil >= 1) return <OLBadge bg="danger">{t('spur_grenze_erreicht')}</OLBadge>
  if (anteil >= 0.8) return <OLBadge bg="warning">{t('spur_grenze_fast')}</OLBadge>
  return null
}

function FeldFehler({ id, text }: { id: string; text?: string }) {
  return text ? (
    <div id={id} className="invalid-feedback d-block">
      {text}
    </div>
  ) : null
}

export default function GrenzenAdmin() {
  const { isReady } = useWaitForI18n()
  const { t } = useTranslation()
  const [daten, setDaten] = useState<Daten | null>(null)
  const [fehler, setFehler] = useState<string | null>(null)

  const laden = useCallback(async () => {
    try {
      setDaten(await anfrage<Daten>(`${PFAD}.json`))
    } catch (error) {
      setFehler((error as Error).message)
    }
  }, [])

  useEffect(() => {
    laden()
  }, [laden])

  if (!isReady) return null

  return (
    <main id="main-content" className="content spur-grenzen-admin">
      <h1>{t('spur_grenzen')}</h1>
      <p>{t('spur_grenzen_hinweis')}</p>
      {fehler && <Notification type="error" content={fehler} />}
      {!daten && !fehler && <p aria-busy="true">{t('loading')}</p>}
      {daten && (
        <>
          <StandardFormular standard={daten.standard} neuLaden={laden} />
          <NutzerTabelle nutzer={daten.nutzer} neuLaden={laden} />
          <ProjektTabelle projekte={daten.projekte} neuLaden={laden} />
        </>
      )}
    </main>
  )
}

function StandardFormular({ standard, neuLaden }: { standard: Standard; neuLaden: () => Promise<void> }) {
  const { t } = useTranslation()
  const zahl = useZahl()
  const id = useId()
  const alsText = (wert: number | null) => (wert === null ? '' : zahl(wert))
  const [werte, setWerte] = useState({ projekte: alsText(standard.projekte), speicherGb: alsText(standard.speicherGb) })
  const [texPaketeErlaubt, setTexPaketeErlaubt] = useState(!standard.texPaketeAus)
  const [feldFehler, setFeldFehler] = useState<Record<string, string>>({})
  const [meldung, setMeldung] = useState<{ typ: 'success' | 'error'; text: string } | null>(null)
  const [laeuft, setLaeuft] = useState(false)

  const speichern = async (e: FormEvent) => {
    e.preventDefault()
    setLaeuft(true)
    setMeldung(null)
    setFeldFehler({})
    try {
      await jsonAnfrage('PUT', `${PFAD}/standard`, { ...werte, texPaketeAus: !texPaketeErlaubt })
      await neuLaden()
      setMeldung({ typ: 'success', text: t('spur_gespeichert') })
    } catch (error) {
      if (error instanceof ApiFehler && error.daten?.fehler) setFeldFehler(error.daten.fehler)
      else setMeldung({ typ: 'error', text: (error as Error).message })
    } finally {
      setLaeuft(false)
    }
  }

  const feld = (name: Feld, label: string) => (
    <div className="spur-grenzen-feld">
      <OLFormLabel htmlFor={`${id}-${name}`}>{label}</OLFormLabel>
      <OLFormControl
        id={`${id}-${name}`}
        inputMode="decimal"
        value={werte[name]}
        placeholder={t('spur_unbegrenzt')}
        isInvalid={Boolean(feldFehler[name])}
        aria-invalid={Boolean(feldFehler[name])}
        aria-describedby={feldFehler[name] ? `${id}-${name}-fehler` : undefined}
        onChange={e => setWerte({ ...werte, [name]: e.target.value })}
      />
      <FeldFehler id={`${id}-${name}-fehler`} text={feldFehler[name]} />
    </div>
  )

  return (
    <section className="spur-grenzen-abschnitt" aria-labelledby={`${id}-titel`}>
      <h2 id={`${id}-titel`}>{t('spur_grenzen_standard')}</h2>
      <dl className="spur-grenzen-stand">
        <div>
          <dt>{t('spur_projekte_je_nutzer')}:</dt>{' '}
          <dd>{standard.projekte === null ? t('spur_unbegrenzt') : zahl(standard.projekte)}</dd>
        </div>
        <div>
          <dt>{t('spur_speicher_je_projekt')}:</dt>{' '}
          <dd>{standard.speicherGb === null ? t('spur_unbegrenzt') : `${zahl(standard.speicherGb)} GB`}</dd>
        </div>
      </dl>
      <form onSubmit={speichern} noValidate>
        <div className="spur-grenzen-felder">
          {feld('projekte', t('spur_projekte_je_nutzer'))}
          {feld('speicherGb', t('spur_speicher_je_projekt_gb'))}
        </div>
        <p className="form-text">{t('spur_grenzen_leer_hinweis')}</p>
        <OLFormCheckbox
          id={`${id}-tex`}
          label={t('spur_tex_pakete_erlaubt')}
          checked={texPaketeErlaubt}
          onChange={e => setTexPaketeErlaubt(e.target.checked)}
        />
        <OLButton type="submit" variant="primary" isLoading={laeuft} className="mt-3">
          {t('save')}
        </OLButton>
      </form>
      {meldung && <Notification className="mt-3" type={meldung.typ} content={meldung.text} />}
    </section>
  )
}

function SortierKnopf({ aktiv, onClick }: { aktiv: boolean; onClick: () => void }) {
  const { t } = useTranslation()
  return (
    <OLButton variant="link" className="spur-grenzen-sortieren" aria-pressed={aktiv} onClick={onClick}>
      {t('spur_auslastung')} {aktiv ? '↓' : ''}
    </OLButton>
  )
}

function NutzerTabelle({ nutzer, neuLaden }: { nutzer: Nutzer[]; neuLaden: () => Promise<void> }) {
  const { t } = useTranslation()
  const zahl = useZahl()
  const [sortiert, setSortiert] = useState(false)
  const [bearbeitet, setBearbeitet] = useState<string | null>(null)
  const liste = sortiert
    ? [...nutzer].sort((a, b) => auslastung(b.projekte, b.grenze) - auslastung(a.projekte, a.grenze))
    : nutzer
  return (
    <section className="spur-grenzen-abschnitt" aria-labelledby="spur-grenzen-nutzer">
      <h2 id="spur-grenzen-nutzer">{t('spur_grenzen_nutzer')}</h2>
      <div className="table-responsive">
        <table className="table spur-grenzen-tabelle">
          <thead>
            <tr>
              <th scope="col">{t('spur_nutzer')}</th>
              <th scope="col">{t('spur_projekte')}</th>
              <th scope="col">
                <SortierKnopf aktiv={sortiert} onClick={() => setSortiert(!sortiert)} />
              </th>
              <th scope="col">{t('spur_ausnahme')}</th>
            </tr>
          </thead>
          <tbody>
            {liste.map(n => (
              <tr key={n.id} data-email={n.email}>
                <td>
                  {n.name && <span className="d-block">{n.name}</span>}
                  <span className="spur-zeile-meta">{n.email}</span>
                </td>
                <td className="spur-grenzen-zahl">
                  {n.grenze === null ? zahl(n.projekte) : `${zahl(n.projekte)} / ${zahl(n.grenze)}`}
                </td>
                <td>
                  <Markierung anteil={auslastung(n.projekte, n.grenze)} />
                </td>
                <td>
                  {bearbeitet === n.id ? (
                    <AusnahmeFormular
                      nutzer={n}
                      fertig={async () => {
                        setBearbeitet(null)
                        await neuLaden()
                      }}
                      abbrechen={() => setBearbeitet(null)}
                    />
                  ) : (
                    <>
                      <AusnahmeText ausnahme={n.ausnahme} />
                      <OLButton
                        variant="secondary"
                        size="sm"
                        aria-label={t('spur_ausnahme_fuer', { email: n.email })}
                        onClick={() => setBearbeitet(n.id)}
                      >
                        {t('spur_ausnahme_aendern')}
                      </OLButton>
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

function AusnahmeText({ ausnahme }: { ausnahme: Nutzer['ausnahme'] }) {
  const { t } = useTranslation()
  const zahl = useZahl()
  const teile = []
  const text = (wert: number | null, einheit = '') => (wert === null ? t('spur_unbegrenzt') : `${zahl(wert)}${einheit}`)
  if (ausnahme.projekte !== undefined) teile.push(`${t('spur_projekte')}: ${text(ausnahme.projekte)}`)
  if (ausnahme.speicherGb !== undefined) teile.push(`${t('spur_speicher')}: ${text(ausnahme.speicherGb, ' GB')}`)
  return <span className="d-block spur-zeile-meta">{teile.length ? teile.join(' · ') : t('spur_standard')}</span>
}

function AusnahmeFormular({ nutzer, fertig, abbrechen }: { nutzer: Nutzer; fertig: () => Promise<void>; abbrechen: () => void }) {
  const { t } = useTranslation()
  const zahl = useZahl()
  const id = useId()
  const modusVon = (wert: number | null | undefined) => (wert === undefined ? 'standard' : wert === null ? 'unbegrenzt' : 'zahl')
  const [modus, setModus] = useState({ projekte: modusVon(nutzer.ausnahme.projekte), speicherGb: modusVon(nutzer.ausnahme.speicherGb) })
  const [werte, setWerte] = useState({
    projekte: typeof nutzer.ausnahme.projekte === 'number' ? zahl(nutzer.ausnahme.projekte) : '',
    speicherGb: typeof nutzer.ausnahme.speicherGb === 'number' ? zahl(nutzer.ausnahme.speicherGb) : '',
  })
  const [feldFehler, setFeldFehler] = useState<Record<string, string>>({})
  const [laeuft, setLaeuft] = useState(false)

  const senden = (feld: Feld) => (modus[feld] === 'standard' ? '' : modus[feld] === 'unbegrenzt' ? 'unbegrenzt' : werte[feld])

  const speichern = async (e: FormEvent) => {
    e.preventDefault()
    setLaeuft(true)
    setFeldFehler({})
    try {
      await jsonAnfrage('PUT', `${PFAD}/nutzer/${nutzer.id}`, { projekte: senden('projekte'), speicherGb: senden('speicherGb') })
      await fertig()
    } catch (error) {
      setFeldFehler(error instanceof ApiFehler && error.daten?.fehler ? error.daten.fehler : { allgemein: (error as Error).message })
    } finally {
      setLaeuft(false)
    }
  }

  const feld = (name: Feld, label: string) => (
    <fieldset className="spur-grenzen-ausnahme-feld">
      <legend>{label}</legend>
      <OLFormSelect
        aria-label={`${label}: ${t('spur_art')}`}
        value={modus[name]}
        onChange={e => setModus({ ...modus, [name]: e.target.value })}
      >
        <option value="standard">{t('spur_standard')}</option>
        <option value="unbegrenzt">{t('spur_unbegrenzt')}</option>
        <option value="zahl">{t('spur_eigene_grenze')}</option>
      </OLFormSelect>
      {modus[name] === 'zahl' && (
        <OLFormControl
          aria-label={label}
          inputMode="decimal"
          value={werte[name]}
          isInvalid={Boolean(feldFehler[name])}
          aria-invalid={Boolean(feldFehler[name])}
          aria-describedby={feldFehler[name] ? `${id}-${name}-fehler` : undefined}
          onChange={e => setWerte({ ...werte, [name]: e.target.value })}
        />
      )}
      <FeldFehler id={`${id}-${name}-fehler`} text={feldFehler[name]} />
    </fieldset>
  )

  return (
    <form className="spur-grenzen-ausnahme" onSubmit={speichern} noValidate>
      {feld('projekte', t('spur_projekte_je_nutzer'))}
      {feld('speicherGb', t('spur_speicher_je_projekt_gb'))}
      <FeldFehler id={`${id}-fehler`} text={feldFehler.allgemein} />
      <div className="spur-panel-werkzeuge spur-ohne-rand">
        <OLButton type="submit" variant="primary" size="sm" isLoading={laeuft}>
          {t('save')}
        </OLButton>
        <OLButton variant="secondary" size="sm" onClick={abbrechen}>
          {t('cancel')}
        </OLButton>
      </div>
    </form>
  )
}

function ProjektTabelle({ projekte, neuLaden }: { projekte: Projekt[]; neuLaden: () => Promise<void> }) {
  const { t } = useTranslation()
  const zahl = useZahl()
  const [sortiert, setSortiert] = useState(false)
  const [laeuft, setLaeuft] = useState<string | null>(null)
  const [fehler, setFehler] = useState<string | null>(null)
  const liste = sortiert ? [...projekte].sort((a, b) => auslastung(b.bytes, b.grenze) - auslastung(a.bytes, a.grenze)) : projekte
  const gb = (bytes: number) => `${zahl(bytes / GB)} GB`

  const neuBerechnen = async (p: Projekt) => {
    setLaeuft(p.id)
    setFehler(null)
    try {
      await jsonAnfrage('POST', `${PFAD}/projekt/${p.id}/neu-berechnen`)
      await neuLaden()
    } catch (error) {
      setFehler((error as Error).message)
    } finally {
      setLaeuft(null)
    }
  }

  return (
    <section className="spur-grenzen-abschnitt" aria-labelledby="spur-grenzen-projekte">
      <h2 id="spur-grenzen-projekte">{t('spur_grenzen_projekte')}</h2>
      {fehler && <Notification type="error" content={fehler} />}
      <div className="table-responsive">
        <table className="table spur-grenzen-tabelle">
          <thead>
            <tr>
              <th scope="col">{t('spur_projekt')}</th>
              <th scope="col">{t('spur_eigentuemer')}</th>
              <th scope="col">{t('spur_speicher')}</th>
              <th scope="col">
                <SortierKnopf aktiv={sortiert} onClick={() => setSortiert(!sortiert)} />
              </th>
              <th scope="col">
                <span className="visually-hidden">{t('spur_aktionen')}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {liste.map(p => (
              <tr key={p.id} data-projekt={p.name}>
                <td>{p.name}</td>
                <td className="spur-zeile-meta">{p.eigentuemer}</td>
                <td className="spur-grenzen-zahl">{p.grenze === null ? gb(p.bytes) : `${gb(p.bytes)} / ${gb(p.grenze)}`}</td>
                <td>
                  <Markierung anteil={auslastung(p.bytes, p.grenze)} />
                </td>
                <td>
                  <OLButton
                    variant="secondary"
                    size="sm"
                    isLoading={laeuft === p.id}
                    aria-label={t('spur_speicher_neu_berechnen_fuer', { name: p.name })}
                    onClick={() => neuBerechnen(p)}
                  >
                    {t('spur_speicher_neu_berechnen')}
                  </OLButton>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}
