import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import RailPanelHeader from '@/features/ide-react/components/rail/rail-panel-header'
import OLButton from '@/shared/components/ol/ol-button'
import OLFormControl from '@/shared/components/ol/ol-form-control'
import OLSpinner from '@/shared/components/ol/ol-spinner'
import Notification from '@/shared/components/notification'
import { usePermissionsContext } from '@/features/ide-react/context/permissions-context'
import { anfrage, projektPfad } from '../api'
import { pruefenVerzoegert } from '../pruefung/pruef-store'
import QuellenHolenModal, { type Projekt } from './quellen-holen-modal'
import QuelleVorschau from './quelle-vorschau'
import QuellenSuche from './quellen-suche'
import type { Quelle, Treffer } from './typen'

const MAX_BYTES = 50 * 1024 * 1024

function QuellenZeile({ quelle, oeffnen }: { quelle: Quelle; oeffnen: () => void }) {
  const { t } = useTranslation()
  return (
    <li className="spur-zeile">
      <OLButton
        variant="link"
        size="sm"
        className="spur-zeile-link"
        onClick={oeffnen}
      >
        {quelle.dateiname}
      </OLButton>
      <p className="spur-zeile-meta">
        {t(quelle.art === 'pdf' ? 'spur_seiten' : 'spur_abschnitte', {
          count: quelle.seitenzahl,
        })}
        {' · '}
        {quelle.status === 'text' ? t('spur_text_erkannt') : t('spur_kein_text')}
        {quelle.fassung && ` · ${quelle.fassung}`}
      </p>
    </li>
  )
}

export default function QuellenPanel() {
  const { t } = useTranslation()
  const { write: darfSchreiben } = usePermissionsContext()
  const [quellen, setQuellen] = useState<Quelle[] | null>(null)
  const [gesamt, setGesamt] = useState(0)
  const [fehler, setFehler] = useState<string | null>(null)
  const [laedtHoch, setLaedtHoch] = useState(false)
  const [offen, setOffen] = useState<{ quelle: Quelle; seite: number } | null>(null)
  const [treffer, setTreffer] = useState<Treffer[] | null>(null)
  const [begriff, setBegriff] = useState('')
  const [andere, setAndere] = useState<Projekt[]>([])
  const [klonVon, setKlonVon] = useState<Projekt | null>(null)
  const [holenDialog, setHolenDialog] = useState<{ vorauswahl?: string } | null>(null)
  const [meldung, setMeldung] = useState<{ typ: 'success' | 'info'; text: string } | null>(null)
  const dateiFeld = useRef<HTMLInputElement>(null)
  const sucheFeld = useRef<HTMLInputElement>(null)
  const warOffen = useRef(false)

  // Nach der Vorschau (etwa nach dem Löschen der Quelle) den Fokus im Panel halten statt auf BODY.
  useEffect(() => {
    if (warOffen.current && !offen) sucheFeld.current?.focus()
    warOffen.current = Boolean(offen)
  }, [offen])

  const holenOeffnen = (vorauswahl?: string) => {
    setMeldung(null)
    setHolenDialog({ vorauswahl })
  }

  const laden = useCallback(async () => {
    setFehler(null)
    try {
      const antwort = await anfrage<{ quellen: Quelle[]; gesamt: number }>(
        projektPfad('/quellen')
      )
      setQuellen(antwort.quellen)
      setGesamt(antwort.gesamt)
    } catch (error) {
      setFehler((error as Error).message)
    }
  }, [])

  const andereLaden = useCallback(async () => {
    const antwort = await anfrage<{ projekte: Projekt[]; klonVon: Projekt | null }>(
      projektPfad('/quellen/andere')
    )
    setAndere(antwort.projekte)
    setKlonVon(antwort.klonVon)
  }, [])

  useEffect(() => {
    laden()
    andereLaden().catch(error => setFehler(error.message))
  }, [laden, andereLaden])

  const hochladen = async (dateien: FileList | null) => {
    const datei = dateien?.[0]
    if (!datei) return
    setFehler(null)
    if (datei.size > MAX_BYTES) {
      setFehler(t('spur_datei_zu_gross'))
      return
    }
    const formular = new FormData()
    formular.append('datei', datei)
    setLaedtHoch(true)
    try {
      await anfrage(projektPfad('/quellen'), { method: 'POST', body: formular })
      await laden()
      pruefenVerzoegert()
    } catch (error) {
      setFehler((error as Error).message)
    } finally {
      setLaedtHoch(false)
      if (dateiFeld.current) dateiFeld.current.value = ''
    }
  }

  const suchen = async (wert: string) => {
    setFehler(null)
    try {
      const pfad = `/quellen/suche?q=${encodeURIComponent(wert)}`
      const antwort = await anfrage<{ treffer: Treffer[] }>(projektPfad(pfad))
      setTreffer(antwort.treffer)
    } catch (error) {
      setFehler((error as Error).message)
    }
  }

  const trefferOeffnen = (t2: Treffer) => {
    const quelle = quellen?.find(q => q.id === t2.quelleId)
    if (quelle) setOffen({ quelle, seite: t2.seite })
  }

  if (offen) {
    return (
      <QuelleVorschau
        quelle={offen.quelle}
        startSeite={offen.seite}
        schliessen={() => {
          setOffen(null)
          laden()
        }}
      />
    )
  }

  return (
    <div className="spur-panel">
      <RailPanelHeader title={t('spur_quellen')} />
      <div className="spur-panel-werkzeuge">
        {darfSchreiben && (
          <>
            <input
              ref={dateiFeld}
              type="file"
              accept=".pdf,.vtt"
              className="visually-hidden"
              aria-label={t('spur_datei_waehlen')}
              onChange={e => hochladen(e.target.files)}
            />
            <OLButton
              variant="primary"
              size="sm"
              isLoading={laedtHoch}
              loadingLabel={t('spur_wird_hochgeladen')}
              onClick={() => dateiFeld.current?.click()}
            >
              {t('spur_hochladen')}
            </OLButton>
            <OLButton
              variant="secondary"
              size="sm"
              onClick={() => holenOeffnen()}
            >
              {t('spur_aus_projekt_holen')}
            </OLButton>
          </>
        )}
        <OLButton
          variant="secondary"
          size="sm"
          href={projektPfad('/quellen/export')}
          download
        >
          {t('spur_quellen_exportieren')}
        </OLButton>
      </div>
      {klonVon && darfSchreiben && (
        <div className="spur-panel-hinweis">
          <Notification
            type="info"
            content={t('spur_quellen_nicht_kopiert')}
            action={
              <OLButton
                variant="secondary"
                size="sm"
                onClick={() => holenOeffnen(klonVon.id)}
              >
                {t('spur_holen')}
              </OLButton>
            }
          />
        </div>
      )}
      <form
        className="spur-suche"
        role="search"
        onSubmit={e => {
          e.preventDefault()
          if (begriff.trim()) suchen(begriff)
          else setTreffer(null)
        }}
      >
        <OLFormControl
          ref={sucheFeld}
          type="search"
          size="sm"
          aria-label={t('spur_quellen_durchsuchen')}
          placeholder={t('spur_quellen_durchsuchen')}
          value={begriff}
          onChange={e => {
            setBegriff(e.target.value)
            if (!e.target.value) setTreffer(null)
          }}
        />
      </form>
      <div className="spur-panel-inhalt">
        {fehler && <Notification type="error" content={fehler} />}
        <div role="status">
          {meldung && <Notification type={meldung.typ} content={meldung.text} />}
        </div>
        {quellen === null && !fehler && (
          <p className="spur-leer">
            <OLSpinner size="sm" /> {t('spur_quellen_laden')}
          </p>
        )}
        {treffer && <QuellenSuche treffer={treffer} oeffnen={trefferOeffnen} />}
        {!treffer && quellen?.length === 0 && (
          <p className="spur-leer">{t('spur_keine_quellen')}</p>
        )}
        {!treffer && quellen && quellen.length > 0 && (
          <>
            <ul className="spur-liste">
              {quellen.map(quelle => (
                <QuellenZeile
                  key={quelle.id}
                  quelle={quelle}
                  oeffnen={() => setOffen({ quelle, seite: 1 })}
                />
              ))}
            </ul>
            {gesamt > quellen.length && (
              <p className="spur-leer">
                {t('spur_weitere_quellen', {
                  anzahl: quellen.length,
                  gesamt,
                })}
              </p>
            )}
          </>
        )}
      </div>
      {holenDialog && (
        <QuellenHolenModal
          projekte={klonVon && !andere.length ? [klonVon] : andere}
          vorauswahl={holenDialog.vorauswahl}
          schliessen={() => setHolenDialog(null)}
          geholt={anzahl => {
            setHolenDialog(null)
            setMeldung(
              anzahl
                ? { typ: 'success', text: t('spur_quellen_geholt', { count: anzahl }) }
                : { typ: 'info', text: t('spur_quellen_schon_da') }
            )
            laden()
            andereLaden()
            pruefenVerzoegert()
          }}
        />
      )}
    </div>
  )
}
