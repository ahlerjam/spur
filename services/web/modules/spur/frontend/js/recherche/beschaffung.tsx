import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import OLBadge from '@/shared/components/ol/ol-badge'
import OLButton from '@/shared/components/ol/ol-button'
import OLFormControl from '@/shared/components/ol/ol-form-control'
import OLFormLabel from '@/shared/components/ol/ol-form-label'
import OLFormSelect from '@/shared/components/ol/ol-form-select'
import OLSpinner from '@/shared/components/ol/ol-spinner'
import Notification from '@/shared/components/notification'
import { usePermissionsContext } from '@/features/ide-react/context/permissions-context'
import { anfrage, jsonAnfrage, projektPfad } from '../api'
import { pruefenVerzoegert } from '../pruefung/pruef-store'
import { autorenText } from './paper-treffer'

type Eintrag = {
  id: string
  doi: string
  titel: string | null
  autoren: string[]
  jahr: number | null
  status: 'offen' | 'beschafft'
  link: string
}
type Liste = { eintraege: Eintrag[]; offen: number; beschafft: number; weiter: boolean; vorlage: string }
type Hochgeladen = { quelle: { id: string; dateiname: string }; zugeordnet: string | null }
type Meldung = { typ: 'success' | 'error'; text: string }

const FORMATE = [
  { format: 'bib', name: '.bib' },
  { format: 'ris', name: '.ris' },
  { format: 'csv', name: 'CSV' },
]

export default function Beschaffung() {
  const { t } = useTranslation()
  const { write: darfSchreiben } = usePermissionsContext()
  const [liste, setListe] = useState<Liste | null>(null)
  const [seite, setSeite] = useState(0)
  const [vorlage, setVorlage] = useState('')
  const [fehler, setFehler] = useState<string | null>(null)
  const [meldung, setMeldung] = useState<Meldung | null>(null)
  const [ohneDoi, setOhneDoi] = useState<Hochgeladen['quelle'] | null>(null)
  const [auswahl, setAuswahl] = useState('')
  const [laedtHoch, setLaedtHoch] = useState(false)
  const dateiFeld = useRef<HTMLInputElement>(null)

  const laden = useCallback(async (nummer = 0) => {
    setFehler(null)
    try {
      const antwort = await anfrage<Liste>(projektPfad(`/beschaffung?seite=${nummer}`))
      setListe(alt =>
        nummer === 0 || !alt ? antwort : { ...antwort, eintraege: [...alt.eintraege, ...antwort.eintraege] }
      )
      setVorlage(antwort.vorlage)
      setSeite(nummer)
    } catch (error) {
      setFehler((error as Error).message)
    }
  }, [])

  useEffect(() => {
    laden()
  }, [laden])

  const vorlageSpeichern = async () => {
    setMeldung(null)
    try {
      await jsonAnfrage('PUT', '/spur/beschaffung/vorlage', { vorlage })
      setMeldung({ typ: 'success', text: t('spur_vorlage_gespeichert') })
      await laden()
    } catch (error) {
      setMeldung({ typ: 'error', text: (error as Error).message })
    }
  }

  const hochladen = async (datei: File | undefined) => {
    if (!datei) return
    setMeldung(null)
    setOhneDoi(null)
    const formular = new FormData()
    formular.append('datei', datei)
    setLaedtHoch(true)
    try {
      const antwort = await anfrage<Hochgeladen>(projektPfad('/beschaffung/hochladen'), {
        method: 'POST',
        body: formular,
      })
      if (antwort.zugeordnet) {
        setMeldung({ typ: 'success', text: t('spur_beschafft_per_doi', { name: antwort.quelle.dateiname }) })
      } else {
        setOhneDoi(antwort.quelle)
        setAuswahl('')
      }
      pruefenVerzoegert()
      await laden()
    } catch (error) {
      setMeldung({ typ: 'error', text: (error as Error).message })
    } finally {
      setLaedtHoch(false)
      if (dateiFeld.current) dateiFeld.current.value = ''
    }
  }

  const zuordnen = async () => {
    if (!ohneDoi || !auswahl) return
    try {
      await jsonAnfrage('POST', projektPfad(`/beschaffung/${auswahl}/zuordnen`), { quelle_id: ohneDoi.id })
      setMeldung({ typ: 'success', text: t('spur_beschafft_per_doi', { name: ohneDoi.dateiname }) })
      setOhneDoi(null)
      await laden()
    } catch (error) {
      setMeldung({ typ: 'error', text: (error as Error).message })
    }
  }

  const offene = liste?.eintraege.filter(e => e.status === 'offen') ?? []

  return (
    <div className="spur-panel-inhalt">
      {fehler && <Notification type="error" content={fehler} />}
      {!liste && !fehler && (
        <p className="spur-leer" role="status">
          <OLSpinner size="sm" /> {t('spur_beschaffung_laden')}
        </p>
      )}
      {liste && (
        <>
          <form
            className="spur-vorlage"
            onSubmit={e => {
              e.preventDefault()
              vorlageSpeichern()
            }}
          >
            <OLFormLabel htmlFor="spur-bibliothek-vorlage">{t('spur_bibliothek_vorlage')}</OLFormLabel>
            <div className="spur-recherche-suche">
              <OLFormControl
                id="spur-bibliothek-vorlage"
                size="sm"
                value={vorlage}
                aria-describedby="spur-bibliothek-hilfe"
                onChange={e => setVorlage(e.target.value)}
              />
              <OLButton type="submit" variant="secondary" size="sm">
                {t('spur_speichern')}
              </OLButton>
            </div>
            <p id="spur-bibliothek-hilfe" className="spur-zeile-meta">
              {t('spur_bibliothek_hilfe')}
            </p>
          </form>
          <div className="spur-paper-aktionen">
            {darfSchreiben && (
              <>
                <input
                  ref={dateiFeld}
                  type="file"
                  accept=".pdf"
                  className="visually-hidden"
                  aria-label={t('spur_beschafftes_pdf')}
                  onChange={e => hochladen(e.target.files?.[0])}
                />
                <OLButton
                  variant="primary"
                  size="sm"
                  isLoading={laedtHoch}
                  loadingLabel={t('spur_wird_hochgeladen')}
                  onClick={() => dateiFeld.current?.click()}
                >
                  {t('spur_pdf_hochladen')}
                </OLButton>
              </>
            )}
            {FORMATE.map(f => (
              <OLButton
                key={f.format}
                variant="secondary"
                size="sm"
                href={projektPfad(`/beschaffung/export/${f.format}`)}
                download
                aria-label={t('spur_exportieren_als', { format: f.name })}
              >
                {f.name}
              </OLButton>
            ))}
          </div>
          <div role="status">{meldung && <Notification type={meldung.typ} content={meldung.text} />}</div>
          {ohneDoi && (
            <div className="spur-zuordnen">
              <Notification type="warning" content={t('spur_keine_doi_im_pdf', { name: ohneDoi.dateiname })} />
              <OLFormLabel htmlFor="spur-zuordnen-eintrag">{t('spur_eintrag')}</OLFormLabel>
              <div className="spur-recherche-suche">
                <OLFormSelect
                  id="spur-zuordnen-eintrag"
                  size="sm"
                  value={auswahl}
                  onChange={e => setAuswahl(e.target.value)}
                >
                  <option value="">{t('spur_eintrag_waehlen')}</option>
                  {offene.map(e => (
                    <option key={e.id} value={e.id}>
                      {e.titel ?? e.doi}
                    </option>
                  ))}
                </OLFormSelect>
                <OLButton variant="primary" size="sm" disabled={!auswahl} onClick={zuordnen}>
                  {t('spur_zuordnen')}
                </OLButton>
              </div>
            </div>
          )}
          {liste.eintraege.length === 0 ? (
            <p className="spur-leer">{t('spur_beschaffung_leer')}</p>
          ) : (
            <>
              <p className="spur-zeile-meta">
                {t('spur_beschaffung_stand', { offen: liste.offen, beschafft: liste.beschafft })}
              </p>
              <ul className="spur-liste">
                {liste.eintraege.map(e => (
                  <li key={e.id} className="spur-zeile spur-paper">
                    <p className="spur-paper-titel">{e.titel ?? e.doi}</p>
                    <p className="spur-zeile-meta">
                      {autorenText(e.autoren, t('spur_ohne_autoren'))}
                      {e.jahr && ` · ${e.jahr}`}
                      <OLBadge bg={e.status === 'offen' ? 'warning' : 'success'} className="spur-paper-badge">
                        {t(e.status === 'offen' ? 'spur_offen' : 'spur_beschafft')}
                      </OLBadge>
                    </p>
                    <p className="spur-zeile-meta spur-paper-doi">{e.doi}</p>
                    {e.status === 'offen' && (
                      <a href={e.link} target="_blank" rel="noopener noreferrer" className="spur-bibliothek-link">
                        {t('spur_in_bibliothek')}
                      </a>
                    )}
                  </li>
                ))}
              </ul>
              {liste.weiter && (
                <OLButton variant="secondary" size="sm" onClick={() => laden(seite + 1)}>
                  {t('spur_weitere_eintraege')}
                </OLButton>
              )}
            </>
          )}
        </>
      )}
    </div>
  )
}
