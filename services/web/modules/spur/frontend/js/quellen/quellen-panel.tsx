import SpeicherAnzeige from '../grenzen/speicher-anzeige'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import RailPanelHeader from '@/features/ide-react/components/rail/rail-panel-header'
import OLButton from '@/shared/components/ol/ol-button'
import LadeKnopf from '../lade-knopf'
import OLFormControl from '@/shared/components/ol/ol-form-control'
import OLSpinner from '@/shared/components/ol/ol-spinner'
import MaterialIcon from '@/shared/components/material-icon'
import {
  OLDropdown,
  OLDropdownItem,
  OLDropdownMenu,
  OLDropdownToggle,
} from '@/shared/components/ol/ol-dropdown-menu'
import Notification from '@/shared/components/notification'
import { usePermissionsContext } from '@/features/ide-react/context/permissions-context'
import { useConnectionContext } from '@/features/ide-react/context/connection-context'
import useSocketListener from '@/features/ide-react/hooks/use-socket-listener'
import { anfrage, projektPfad } from '../api'
import { pruefenVerzoegert } from '../pruefung/pruef-store'
import MatrixModal from '../literatur/matrix-modal'
import ImportModal from './import-modal'
import QuellenHolenModal, { type Projekt } from './quellen-holen-modal'
import QuelleVorschau from './quelle-vorschau'
import QuellenSuche from './quellen-suche'
import Semantik from './semantik'
import Zugewiesen from './zugewiesen'
import { datumLang, OCR_SICHER_AB, type Quelle, type Treffer } from './typen'
import WebAufnehmen from './web-aufnehmen'

const MAX_BYTES = 50 * 1024 * 1024

function TextStatus({ quelle }: { quelle: Quelle }) {
  const { t } = useTranslation()
  const ocr = quelle.ocr
  if (ocr?.status === 'laeuft') {
    return (
      <span role="status">
        <OLSpinner size="sm" />{' '}
        {/* Die Seite, die gerade erkannt wird, nicht die Zahl der fertigen. */}
        {t('spur_ocr_laeuft', { seite: Math.min(ocr.fertig + 1, ocr.gesamt), gesamt: ocr.gesamt })}
      </span>
    )
  }
  if (quelle.status === 'text') return <>{t('spur_text_erkannt')}</>
  if (quelle.status === 'ocr') {
    const unsicher = ocr?.konfidenz != null && ocr.konfidenz < OCR_SICHER_AB
    return <>{t(unsicher ? 'spur_ocr_unsicher' : 'spur_ocr_pruefen')}</>
  }
  if (ocr?.status === 'fehler') return <>{t('spur_ocr_fehler')}</>
  if (ocr?.status === 'abgebrochen') return <>{t('spur_ocr_abgebrochen')}</>
  if (ocr?.status === 'fertig') return <>{t('spur_ocr_nichts')}</>
  return <>{t('spur_kein_text')}</>
}

function QuellenZeile({
  quelle,
  oeffnen,
  textErkennen,
}: {
  quelle: Quelle
  oeffnen: () => void
  textErkennen?: () => void
}) {
  const { t, i18n } = useTranslation()
  const ocrMoeglich =
    textErkennen && quelle.art === 'pdf' && quelle.status === 'kein_text' && quelle.ocr?.status !== 'laeuft'
  const titel = quelle.titel ?? quelle.dateiname
  const herkunft = [autorenKurz(quelle.autoren, t), quelle.jahr].filter(Boolean).join(' · ')
  return (
    <li className="spur-zeile">
      <button type="button" className="spur-quelle-titel" data-quelle-id={quelle.id} onClick={oeffnen}>
        {titel}
        {/* Der Dateiname unterscheidet Quellen mit gleichem Titel und bleibt für Suche und Screenreader im Namen. */}
        {titel !== quelle.dateiname && <span className="visually-hidden"> ({quelle.dateiname})</span>}
      </button>
      {herkunft && !quelle.web && <p className="spur-zeile-meta">{herkunft}</p>}
      {quelle.web ? (
        <>
          <p className="spur-zeile-meta">
            {t('spur_webseite')}
            {' · '}
            {t('spur_abgerufen_am', { datum: datumLang(quelle.web.abgerufenAm, i18n.language) })}
            {quelle.fassung && ` · ${quelle.fassung}`}
          </p>
          <p className="spur-zeile-auszug">{quelle.web.url}</p>
        </>
      ) : (
        <p className="spur-zeile-meta">
          {t(quelle.art === 'pdf' ? 'spur_seiten' : 'spur_abschnitte', {
            count: quelle.seitenzahl,
          })}
          {' · '}
          <TextStatus quelle={quelle} />
          {quelle.fassung && ` · ${quelle.fassung}`}
        </p>
      )}
      {ocrMoeglich && (
        <OLButton variant="secondary" size="sm" onClick={textErkennen}>
          {t('spur_text_erkennen')}
        </OLButton>
      )}
      {quelle.nurProjekt && <p className="spur-zeile-meta">{t('spur_nur_projekt')}</p>}
    </li>
  )
}

function autorenKurz(autoren: string[], t: (k: string, o?: object) => string) {
  if (autoren.length >= 3) return t('spur_autoren_mehr', { erster: autoren[0] })
  return autoren.join(', ')
}

const seiteHolen = (nummer: number) =>
  anfrage<{ quellen: Quelle[]; gesamt: number }>(
    projektPfad(nummer ? `/quellen?seite=${nummer}` : '/quellen')
  )

const PLATZHALTER = [0, 1, 2]

function ListenPlatzhalter() {
  const { t } = useTranslation()
  return (
    <ul className="spur-liste" aria-busy="true" aria-label={t('spur_quellen_laden')}>
      {PLATZHALTER.map(i => (
        <li key={i} className="spur-zeile spur-platzhalter-zeile" aria-hidden="true">
          <span className="placeholder col-9" />
          <span className="placeholder col-5" />
          <span className="placeholder col-7" />
        </li>
      ))}
    </ul>
  )
}

type Dialog = 'web' | 'holen' | 'import' | 'matrix'

export default function QuellenPanel() {
  const { t } = useTranslation()
  const { write: darfSchreiben } = usePermissionsContext()
  const [quellen, setQuellen] = useState<Quelle[] | null>(null)
  const [gesamt, setGesamt] = useState(0)
  const [fehler, setFehler] = useState<string | null>(null)
  const [ladeFehler, setLadeFehler] = useState<string | null>(null)
  const [laedtHoch, setLaedtHoch] = useState(false)
  const [transkript, setTranskript] = useState(false)
  const [offen, setOffen] = useState<{ quelle: Quelle; seite: number } | null>(null)
  const [treffer, setTreffer] = useState<Treffer[] | null>(null)
  const [begriff, setBegriff] = useState('')
  const [andere, setAndere] = useState<Projekt[]>([])
  const [klonVon, setKlonVon] = useState<Projekt | null>(null)
  const [dialog, setDialog] = useState<{ art: Dialog; vorauswahl?: string } | null>(null)
  const [meldung, setMeldung] = useState<{ typ: 'success' | 'info'; text: string } | null>(null)
  const [seiten, setSeiten] = useState(1)
  const [laedtMehr, setLaedtMehr] = useState(false)
  const dateiFeld = useRef<HTMLInputElement>(null)
  const sucheFeld = useRef<HTMLInputElement>(null)
  const liste = useRef<HTMLDivElement>(null)
  const menuKnopf = useRef<HTMLButtonElement>(null)
  const warOffen = useRef(false)

  // Aus dem Menü geöffnet: Der Dialog gibt den Fokus beim Schließen an das Element zurück, das ihn beim Öffnen
  // hatte; der Menüeintrag ist dann verborgen, darum vorher „Weitere Aktionen“ fokussieren.
  const dialogOeffnen = (art: Dialog, vorauswahl?: string, menu = true) => {
    setMeldung(null)
    setFehler(null)
    if (menu) menuKnopf.current?.focus()
    setDialog({ art, vorauswahl })
  }

  const dialogSchliessen = () => setDialog(null)

  // Nach der Vorschau (etwa nach dem Löschen der Quelle) den Fokus im Panel halten statt auf BODY.
  useEffect(() => {
    if (warOffen.current && !offen) sucheFeld.current?.focus()
    warOffen.current = Boolean(offen)
  }, [offen])

  // Lädt alle bisher angezeigten Seiten neu, damit „Weitere Quellen laden“ beim Aktualisieren nicht verloren geht.
  const laden = useCallback(async (anzahlSeiten = 1) => {
    setFehler(null)
    setLadeFehler(null)
    try {
      const antworten = await Promise.all(Array.from({ length: anzahlSeiten }, (_, i) => seiteHolen(i)))
      setQuellen(antworten.flatMap(a => a.quellen))
      setGesamt(antworten[antworten.length - 1].gesamt)
    } catch (error) {
      setLadeFehler((error as Error).message)
    }
  }, [])

  const neuLaden = useCallback(() => laden(seiten), [laden, seiten])

  const mehrLaden = async () => {
    setLaedtMehr(true)
    try {
      const antwort = await seiteHolen(seiten)
      setQuellen(alt => [...(alt ?? []), ...antwort.quellen])
      setGesamt(antwort.gesamt)
      setSeiten(seiten + 1)
    } catch (error) {
      setFehler((error as Error).message)
    } finally {
      setLaedtMehr(false)
    }
  }

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

  // Fortschritt der Texterkennung und Änderungen anderer an Quellen.
  const { socket } = useConnectionContext()
  useSocketListener(socket, 'spur:quellen', neuLaden)

  const textErkennen = async (quelle: Quelle) => {
    setFehler(null)
    try {
      await anfrage(projektPfad(`/quellen/${quelle.id}/ocr`), { method: 'POST' })
      await neuLaden()
    } catch (error) {
      setFehler((error as Error).message)
    }
  }

  const hochladen = async (dateien: FileList | null) => {
    const datei = dateien?.[0]
    if (!datei) return
    setFehler(null)
    if (datei.size > MAX_BYTES) {
      setFehler(t('spur_datei_zu_gross'))
      return
    }
    // Interviews sind Sache der Nutzer; spur weist nur darauf hin (keine Sonderregeln).
    setTranskript(datei.name.toLowerCase().endsWith('.vtt'))
    const formular = new FormData()
    formular.append('datei', datei)
    setLaedtHoch(true)
    try {
      const neu = await anfrage<Quelle>(projektPfad('/quellen'), { method: 'POST', body: formular })
      await neuLaden()
      pruefenVerzoegert()
      window.setTimeout(() =>
        liste.current?.querySelector<HTMLButtonElement>(`[data-quelle-id="${neu.id}"]`)?.focus()
      )
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
    const quelle = t2.quelle ?? quellen?.find(q => q.id === t2.quelleId)
    if (quelle) setOffen({ quelle, seite: t2.seite })
  }

  if (offen) {
    return (
      <QuelleVorschau
        quelle={offen.quelle}
        startSeite={offen.seite}
        schliessen={() => {
          setOffen(null)
          neuLaden()
        }}
      />
    )
  }

  return (
    <div className="spur-panel">
      <RailPanelHeader title={t('spur_quellen')} />
      <SpeicherAnzeige stand={quellen?.length} />
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
            <LadeKnopf
              variant="primary"
              size="sm"
              isLoading={laedtHoch}
              loadingLabel={t('spur_wird_hochgeladen')}
              onClick={() => dateiFeld.current?.click()}
            >
              {t('spur_quelle_hinzufuegen')}
            </LadeKnopf>
          </>
        )}
        <OLDropdown align="end">
          <OLDropdownToggle
            ref={menuKnopf}
            id="spur-quellen-aktionen"
            bsPrefix="spur-menu-knopf"
            variant="ghost"
            size="sm"
            className="icon-button-small"
            aria-label={t('spur_weitere_aktionen')}
          >
            <MaterialIcon className="icon-small" type="more_vert" />
          </OLDropdownToggle>
          <OLDropdownMenu>
            {darfSchreiben && (
              <>
                <OLDropdownItem as="button" onClick={() => dialogOeffnen('web')}>
                  {t('spur_webseite_aufnehmen')}
                </OLDropdownItem>
                <OLDropdownItem as="button" onClick={() => dialogOeffnen('holen')}>
                  {t('spur_aus_projekt_holen')}
                </OLDropdownItem>
                <OLDropdownItem as="button" onClick={() => dialogOeffnen('import')}>
                  {t('spur_importieren')}
                </OLDropdownItem>
              </>
            )}
            <OLDropdownItem href={projektPfad('/quellen/export')} download>
              {t('spur_quellen_exportieren')}
            </OLDropdownItem>
            <OLDropdownItem as="button" onClick={() => dialogOeffnen('matrix')}>
              {t('spur_literaturmatrix')}
            </OLDropdownItem>
          </OLDropdownMenu>
        </OLDropdown>
      </div>
      {transkript && (
        <div className="spur-panel-hinweis">
          <Notification type="info" content={t('spur_transkript_hinweis')} />
        </div>
      )}
      {klonVon && darfSchreiben && (
        <div className="spur-panel-hinweis">
          <Notification
            type="info"
            content={t('spur_quellen_nicht_kopiert')}
            action={
              <OLButton
                variant="secondary"
                size="sm"
                onClick={() => dialogOeffnen('holen', klonVon.id, false)}
              >
                {t('spur_holen')}
              </OLButton>
            }
          />
        </div>
      )}
      <Zugewiesen oeffnen={(quelle, seite) => setOffen({ quelle, seite })} />
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
      <div className="spur-panel-inhalt" ref={liste}>
        {ladeFehler && (
          <Notification
            type="error"
            content={
              // Der Knopf steht unter dem Text: Als action stünde er im schmalen Panel daneben und quetschte den Text.
              <>
                <p className="mb-2">{ladeFehler}</p>
                <OLButton variant="secondary" size="sm" onClick={() => neuLaden()}>
                  {t('spur_erneut_versuchen')}
                </OLButton>
              </>
            }
          />
        )}
        {fehler && <Notification type="error" content={fehler} />}
        <div role="status">
          {meldung && <Notification type={meldung.typ} content={meldung.text} />}
        </div>
        {quellen === null && !ladeFehler && <ListenPlatzhalter />}
        <Semantik quellenAnzahl={gesamt} oeffnen={trefferOeffnen} />
        {treffer && <QuellenSuche treffer={treffer} oeffnen={trefferOeffnen} />}
        {!treffer && quellen?.length === 0 && (
          <div className="spur-leer">
            <p>{t('spur_keine_quellen')}</p>
            {darfSchreiben && (
              <OLButton variant="secondary" size="sm" onClick={() => dateiFeld.current?.click()}>
                {t('spur_quelle_hinzufuegen')}
              </OLButton>
            )}
          </div>
        )}
        {!treffer && quellen && quellen.length > 0 && (
          <>
            <ul className="spur-liste">
              {quellen.map(quelle => (
                <QuellenZeile
                  key={quelle.id}
                  quelle={quelle}
                  oeffnen={() => setOffen({ quelle, seite: 1 })}
                  textErkennen={darfSchreiben ? () => textErkennen(quelle) : undefined}
                />
              ))}
            </ul>
            {gesamt > quellen.length && (
              <div className="spur-mehr">
                <p className="spur-zeile-meta" role="status">
                  {t('spur_weitere_quellen', { anzahl: quellen.length, gesamt })}
                </p>
                <LadeKnopf
                  variant="secondary"
                  size="sm"
                  isLoading={laedtMehr}
                  loadingLabel={t('spur_quellen_laden')}
                  onClick={mehrLaden}
                >
                  {t('spur_weitere_quellen_laden')}
                </LadeKnopf>
              </div>
            )}
          </>
        )}
      </div>
      {dialog?.art === 'web' && (
        <WebAufnehmen
          aufgenommen={() => {
            dialogSchliessen()
            neuLaden()
            pruefenVerzoegert()
          }}
          abbrechen={dialogSchliessen}
        />
      )}
      {dialog?.art === 'matrix' && <MatrixModal schliessen={dialogSchliessen} />}
      {dialog?.art === 'import' && (
        <ImportModal
          schliessen={dialogSchliessen}
          importiert={() => {
            neuLaden()
            pruefenVerzoegert()
          }}
        />
      )}
      {dialog?.art === 'holen' && (
        <QuellenHolenModal
          projekte={klonVon && !andere.length ? [klonVon] : andere}
          vorauswahl={dialog.vorauswahl}
          schliessen={dialogSchliessen}
          geholt={anzahl => {
            dialogSchliessen()
            setFehler(null)
            setMeldung(
              anzahl
                ? { typ: 'success', text: t('spur_quellen_geholt', { count: anzahl }) }
                : { typ: 'info', text: t('spur_quellen_schon_da') }
            )
            neuLaden()
            andereLaden()
            pruefenVerzoegert()
          }}
        />
      )}
    </div>
  )
}
