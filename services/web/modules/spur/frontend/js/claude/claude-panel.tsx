import { type FormEvent, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import RailPanelHeader from '@/features/ide-react/components/rail/rail-panel-header'
import OLBadge from '@/shared/components/ol/ol-badge'
import OLButton from '@/shared/components/ol/ol-button'
import LadeKnopf from '../lade-knopf'
import OLFormControl from '@/shared/components/ol/ol-form-control'
import OLFormGroup from '@/shared/components/ol/ol-form-group'
import OLFormLabel from '@/shared/components/ol/ol-form-label'
import OLFormText from '@/shared/components/ol/ol-form-text'
import {
  OLModal,
  OLModalBody,
  OLModalFooter,
  OLModalHeader,
  OLModalTitle,
} from '@/shared/components/ol/ol-modal'
import { FormCheck } from 'react-bootstrap'
import { usePermissionsContext } from '@/features/ide-react/context/permissions-context'
import getMeta from '@/utils/meta'
import Notification from '@/shared/components/notification'
import { useAbfrage } from '../abfrage'
import { anfrage, jsonAnfrage, projektPfad } from '../api'
import { startBefehl } from './claude-verbinden'
import BefehlKasten from './befehl-kasten'
import LaufKarte, { type Aenderung, type Lauf } from './lauf-karte'
import OffenlegungModal from './offenlegung-modal'
import { WORKFLOW_PRAEFIX } from './workflow-befehl'

type Nachricht = { id: string; von: 'mensch' | 'claude'; text: string; am: string }
type Workflow = { name: string; titel: string; beschreibung: string; eingaben?: string[] }
type LaufMitAenderungen = { lauf: Lauf; aenderungen: Aenderung[] }
type Status = {
  verbunden: boolean
  nachrichten: Nachricht[]
  aeltere?: boolean
  automatik: boolean
  offen: { aenderungen: number; dateien: number }
  laeufe: LaufMitAenderungen[]
  weitereLaeufe: boolean
}

// Sobald Claude einmal verbunden war oder der Befehl kopiert wurde, bleibt der Startbefehl eingeklappt (je Person).
const befehlSchluessel = () => `spur-startbefehl-bekannt:${getMeta('ol-user_id')}`
function befehlBekannt() {
  try {
    return window.localStorage.getItem(befehlSchluessel()) === 'ja'
  } catch {
    return false
  }
}
function befehlMerken() {
  try {
    window.localStorage.setItem(befehlSchluessel(), 'ja')
  } catch {
    // Ohne Speicher klappt der Befehl beim nächsten Öffnen wieder auf.
  }
}

export default function ClaudePanel() {
  const { t } = useTranslation()
  const { write } = usePermissionsContext()
  // Ohne Verbindung alle 2 s: Eine neue Verbindung soll binnen 5 s sichtbar sein, auch mit der Antwortzeit.
  const [takt, setTakt] = useState(2000)
  const { daten: status, fehler: ladeFehler, laden } = useAbfrage<Status>(projektPfad('/claude'), takt)
  // Fehler beim Senden oder Starten bleiben stehen, bis die nächste Aktion gelingt; nur der Ladefehler geht von selbst.
  const [fehler, setFehler] = useState<string | null>(null)
  useEffect(() => setTakt(status?.verbunden ? 5000 : 2000), [status?.verbunden])
  const [offenlegung, setOffenlegung] = useState(false)

  return (
    <div className="spur-panel">
      <RailPanelHeader title={t('spur_claude')} />
      <div className="spur-panel-werkzeuge">
        <OLButton variant="secondary" size="sm" onClick={() => setOffenlegung(true)}>
          {t('spur_ki_offenlegung')}
        </OLButton>
      </div>
      {offenlegung && <OffenlegungModal schliessen={() => setOffenlegung(false)} />}
      <div className="spur-panel-inhalt spur-claude-inhalt">
        {ladeFehler && <Notification type="error" content={ladeFehler} />}
        {fehler && <Notification type="error" content={fehler} />}
        {status && (
          <>
            {write && <Automatik an={status.automatik} offen={status.offen} neuLaden={laden} />}
            <Verbindung verbunden={status.verbunden} />
            <Laeufe status={status} neuLaden={laden} />
            <Verlauf status={status} />
            {status.verbunden && <Workflows gestartet={laden} fehler={setFehler} />}
            <Eingabe verbunden={status.verbunden} gesendet={laden} fehler={setFehler} />
          </>
        )}
      </div>
    </div>
  )
}

function Automatik({
  an,
  offen,
  neuLaden,
}: {
  an: boolean
  offen: Status['offen']
  neuLaden: () => Promise<void>
}) {
  const { t } = useTranslation()
  const [wert, setWert] = useState(an)
  const [speichert, setSpeichert] = useState(false)
  const [fehler, setFehler] = useState<string | null>(null)
  const [fragen, setFragen] = useState(false)
  const [nimmtAn, setNimmtAn] = useState(false)
  const knopf = useRef<HTMLButtonElement>(null)
  // Die Abfrage alle paar Sekunden überschreibt keine laufende Änderung.
  useEffect(() => {
    if (!speichert) setWert(an)
  }, [an, speichert])

  const umschalten = async (neu: boolean) => {
    // Gesperrt wird nicht über `disabled`: Der Browser nähme dem Schalter sonst den Fokus.
    if (speichert) return
    setWert(neu)
    setFehler(null)
    setSpeichert(true)
    try {
      await jsonAnfrage('PUT', projektPfad('/claude/automatik'), { an: neu })
      await neuLaden()
    } catch (error) {
      setWert(!neu)
      setFehler((error as Error).message)
    } finally {
      setSpeichert(false)
    }
  }

  const allesAnnehmen = async () => {
    setNimmtAn(true)
    setFehler(null)
    try {
      await jsonAnfrage('POST', projektPfad('/claude/alles-annehmen'))
      await neuLaden()
    } catch (error) {
      setFehler((error as Error).message)
    } finally {
      dialogSchliessen()
      setNimmtAn(false)
    }
  }

  // Nach dem Dialog kehrt der Fokus auf den Knopf zurück, auch wenn er inzwischen „Nichts offen“ zeigt.
  const dialogSchliessen = () => {
    setFragen(false)
    window.requestAnimationFrame(() => knopf.current?.focus())
  }

  const nichtsOffen = offen.aenderungen === 0
  return (
    <section className="spur-automatik" aria-label={t('spur_automatik')}>
      <FormCheck
        type="switch"
        id="spur-automatik"
        role="switch"
        checked={wert}
        aria-busy={speichert || undefined}
        aria-describedby="spur-automatik-hinweis"
        label={t('spur_automatik_schalter')}
        onChange={e => umschalten(e.target.checked)}
      />
      <p className="spur-zeile-meta" id="spur-automatik-hinweis">
        {t('spur_rote_bleiben_offen')}
      </p>
      {fehler && (
        <OLFormText type="error" role="alert">
          {fehler}
        </OLFormText>
      )}
      {/* Gesperrt über `aria-disabled`, damit der Knopf den Fokus nach dem Annehmen behält. */}
      <OLButton
        ref={knopf}
        variant="secondary"
        size="sm"
        className={nichtsOffen ? 'disabled' : undefined}
        aria-disabled={nichtsOffen || undefined}
        onClick={() => !nichtsOffen && setFragen(true)}
      >
        {nichtsOffen ? t('spur_nichts_offen') : t('spur_alles_offene_annehmen')}
      </OLButton>
      {fragen && (
        <OLModal themed show onHide={dialogSchliessen}>
          <OLModalHeader>
            <OLModalTitle>{t('spur_alles_offene_annehmen')}</OLModalTitle>
          </OLModalHeader>
          <OLModalBody>
            <p>
              {t('spur_alles_annehmen_frage', {
                aenderungen: t('spur_aenderungen_zahl', { count: offen.aenderungen }),
                dateien: t('spur_dateien_zahl', { count: offen.dateien }),
              })}{' '}
              {t('spur_rote_bleiben_offen')}
            </p>
          </OLModalBody>
          <OLModalFooter>
            <OLButton variant="secondary" onClick={dialogSchliessen}>
              {t('cancel')}
            </OLButton>
            <LadeKnopf variant="primary" isLoading={nimmtAn} onClick={allesAnnehmen}>
              {t('spur_annehmen')}
            </LadeKnopf>
          </OLModalFooter>
        </OLModal>
      )}
    </section>
  )
}

function Verbindung({ verbunden }: { verbunden: boolean }) {
  const { t } = useTranslation()
  const [bekannt, setBekannt] = useState(befehlBekannt)
  const [aufgeklappt, setAufgeklappt] = useState(false)
  useEffect(() => {
    if (verbunden && !bekannt) {
      befehlMerken()
      setBekannt(true)
    }
  }, [verbunden, bekannt])
  const eingeklappt = (verbunden || bekannt) && !aufgeklappt

  return (
    <div className="spur-claude-status">
      <p className="spur-claude-statuszeile" aria-live="polite">
        <OLBadge bg={verbunden ? 'success' : 'warning'}>
          {verbunden ? t('spur_claude_verbunden') : t('spur_claude_nicht_verbunden')}
        </OLBadge>
        {!verbunden && <a href="/user/settings#language-feedback">{t('spur_token_verwalten')}</a>}
      </p>
      {(verbunden || bekannt) && (
        <OLButton
          variant="link"
          size="sm"
          className="spur-befehl-umschalten"
          aria-expanded={!eingeklappt}
          aria-controls="spur-startbefehl"
          onClick={() => setAufgeklappt(!aufgeklappt)}
        >
          {eingeklappt ? t('spur_startbefehl_anzeigen') : t('spur_startbefehl_ausblenden')}
        </OLButton>
      )}
      {!eingeklappt && (
        <div id="spur-startbefehl">
          {!verbunden && <p className="spur-zeile-meta">{t('spur_claude_starten')}</p>}
          <BefehlKasten
            befehl={startBefehl(t)}
            kopiert={() => {
              befehlMerken()
            }}
          />
        </div>
      )}
    </div>
  )
}

// Der neueste Lauf steht offen, ältere eingeklappt mit Status und Zahl offener Änderungen.
function Laeufe({ status, neuLaden }: { status: Status; neuLaden: () => Promise<void> }) {
  const { t } = useTranslation()
  const [aeltere, setAeltere] = useState<{ laeufe: LaufMitAenderungen[]; weitere: boolean } | null>(null)
  const [laedt, setLaedt] = useState(false)
  const [fehler, setFehler] = useState<string | null>(null)
  const alle = [...status.laeufe, ...(aeltere?.laeufe ?? [])]
  const weitere = aeltere ? aeltere.weitere : status.weitereLaeufe

  const mehrLaden = async () => {
    setLaedt(true)
    setFehler(null)
    try {
      const letzter = alle.at(-1)!.lauf.id
      const antwort = await anfrage<{ laeufe: LaufMitAenderungen[]; weitereLaeufe: boolean }>(
        projektPfad(`/claude/laeufe?vor=${letzter}`)
      )
      setAeltere({ laeufe: [...(aeltere?.laeufe ?? []), ...antwort.laeufe], weitere: antwort.weitereLaeufe })
    } catch (error) {
      setFehler((error as Error).message)
    } finally {
      setLaedt(false)
    }
  }

  // Nach einer Aktion an einem älteren Lauf auch die nachgeladenen neu holen.
  const allesNeuLaden = async () => {
    await neuLaden()
    setAeltere(null)
  }

  if (!alle.length) return null
  return (
    <div className="spur-laeufe">
      {alle.map(({ lauf, aenderungen }, i) => (
        <LaufKarte key={lauf.id} lauf={lauf} aenderungen={aenderungen} neuLaden={allesNeuLaden} aufgeklappt={i === 0} />
      ))}
      {fehler && <Notification type="error" content={fehler} />}
      {weitere && (
        <LadeKnopf variant="secondary" size="sm" isLoading={laedt} loadingLabel={t('spur_laedt')} onClick={mehrLaden}>
          {t('spur_aeltere_laden')}
        </LadeKnopf>
      )}
    </div>
  )
}

function Verlauf({ status }: { status: Status }) {
  const { t, i18n } = useTranslation()
  const nachrichten = status.nachrichten
  const wartet = status.verbunden && nachrichten.at(-1)?.von === 'mensch'

  if (nachrichten.length === 0 && status.laeufe.length === 0) {
    return <p className="spur-leer spur-chat-leer">{t('spur_keine_auftraege')}</p>
  }
  return (
    // column-reverse im CSS hält den Verlauf unten, ohne das Zurücklesen zu stören.
    <div className="spur-chat-verlauf">
      <div>
      {status.aeltere && (
        <p className="spur-zeile-meta spur-chat-aeltere">
          {t('spur_chat_aeltere', { anzahl: nachrichten.length })}
        </p>
      )}
      <ol className="spur-chat" role="log" aria-label={t('spur_unterhaltung')}>
        {nachrichten.map(n => (
          <li className={`spur-chat-nachricht spur-nachricht-${n.von}`} key={n.id}>
            <p className="spur-zeile-meta">
              {n.von === 'claude' ? 'Claude' : t('spur_du')} ·{' '}
              <time dateTime={n.am}>
                {new Date(n.am).toLocaleTimeString(i18n.language, { hour: '2-digit', minute: '2-digit' })}
              </time>
            </p>
            <p className="spur-nachricht-text">{n.text}</p>
          </li>
        ))}
        {wartet && <li className="spur-chat-wartet">{t('spur_claude_arbeitet')}</li>}
      </ol>
      </div>
    </div>
  )
}

// Prüft wie der Server (Workflows.mjs), damit die Meldung gleich am Feld steht.
const ANZAHL = /^(max|[1-9]\d{0,4})$/

function QuellenSammelnFormular({
  laeuft,
  starten,
}: {
  laeuft: boolean
  starten: (eingaben: { thema: string; anzahl: string }) => void
}) {
  const { t } = useTranslation()
  const [thema, setThema] = useState('')
  const [anzahl, setAnzahl] = useState('20')
  const [fehler, setFehler] = useState<{ thema?: string; anzahl?: string }>({})
  const themaFeld = useRef<HTMLInputElement>(null)
  const anzahlFeld = useRef<HTMLInputElement>(null)

  const absenden = (e: FormEvent) => {
    e.preventDefault()
    const neu = {
      thema: thema.trim() ? undefined : t('spur_fehler_thema_fehlt'),
      anzahl: ANZAHL.test(anzahl.trim()) ? undefined : t('spur_fehler_anzahl'),
    }
    setFehler(neu)
    if (neu.thema) return themaFeld.current?.focus()
    if (neu.anzahl) return anzahlFeld.current?.focus()
    starten({ thema: thema.trim(), anzahl: anzahl.trim() })
  }

  return (
    <form className="spur-workflow-formular" noValidate onSubmit={absenden}>
      <OLFormGroup controlId="spur-quellen-thema">
        <OLFormLabel>{t('spur_thema')}</OLFormLabel>
        <OLFormControl
          ref={themaFeld}
          size="sm"
          value={thema}
          maxLength={300}
          aria-invalid={Boolean(fehler.thema)}
          aria-describedby={fehler.thema ? 'spur-quellen-thema-fehler' : undefined}
          onChange={e => setThema(e.target.value)}
        />
        {fehler.thema && (
          <OLFormText id="spur-quellen-thema-fehler" type="error">
            {fehler.thema}
          </OLFormText>
        )}
      </OLFormGroup>
      <OLFormGroup controlId="spur-quellen-anzahl">
        <OLFormLabel>{t('spur_anzahl')}</OLFormLabel>
        <OLFormControl
          ref={anzahlFeld}
          size="sm"
          value={anzahl}
          maxLength={6}
          aria-invalid={Boolean(fehler.anzahl)}
          aria-describedby={fehler.anzahl ? 'spur-quellen-anzahl-fehler' : 'spur-quellen-anzahl-hilfe'}
          onChange={e => setAnzahl(e.target.value)}
        />
        {fehler.anzahl ? (
          <OLFormText id="spur-quellen-anzahl-fehler" type="error">
            {fehler.anzahl}
          </OLFormText>
        ) : (
          <OLFormText id="spur-quellen-anzahl-hilfe">{t('spur_anzahl_hilfe')}</OLFormText>
        )}
      </OLFormGroup>
      <LadeKnopf type="submit" variant="primary" size="sm" isLoading={laeuft}>
        {t('spur_sammeln_starten')}
      </LadeKnopf>
    </form>
  )
}

// Claude kann MCP-Prompts nicht selbst aufrufen; der Knopf legt den vollen Workflow-Text als Auftrag ab.
function Workflows({ gestartet, fehler }: { gestartet: () => Promise<void>; fehler: (f: string | null) => void }) {
  const { t } = useTranslation()
  const [liste, setListe] = useState<Workflow[]>([])
  const [laeuft, setLaeuft] = useState<string | null>(null)
  const [formular, setFormular] = useState<string | null>(null)

  useEffect(() => {
    anfrage<{ workflows: Workflow[] }>(projektPfad('/workflows'))
      .then(antwort => setListe(antwort.workflows))
      .catch(error => fehler((error as Error).message))
  }, [fehler])

  const starten = async (name: string, eingaben?: Record<string, string>) => {
    setLaeuft(name)
    fehler(null)
    try {
      await jsonAnfrage('POST', projektPfad(`/workflows/${name}/starten`), eingaben)
      setFormular(null)
      await gestartet()
    } catch (error) {
      fehler((error as Error).message)
    } finally {
      setLaeuft(null)
    }
  }

  return (
    <details className="spur-workflows">
      <summary>{t('spur_workflows')}</summary>
      <ul className="spur-liste">
        {liste.map(w => (
          <li className="spur-workflow" key={w.name}>
            <LadeKnopf
              variant="secondary"
              size="sm"
              isLoading={laeuft === w.name}
              aria-describedby={`spur-workflow-${w.name}`}
              aria-expanded={w.eingaben?.length ? formular === w.name : undefined}
              onClick={() =>
                w.eingaben?.length
                  ? setFormular(formular === w.name ? null : w.name)
                  : starten(w.name)
              }
            >
              {w.titel}
            </LadeKnopf>
            <p className="spur-zeile-meta" id={`spur-workflow-${w.name}`}>
              {w.beschreibung}
            </p>
            {formular === w.name && (
              <QuellenSammelnFormular
                laeuft={laeuft === w.name}
                starten={eingaben => starten(w.name, eingaben)}
              />
            )}
          </li>
        ))}
      </ul>
      {liste.length > 0 && (
        <div className="spur-workflows-hilfe">
          <p className="spur-zeile-meta" id="spur-workflows-befehle">
            {t('spur_workflows_befehle')}
          </p>
          <ul className="spur-liste" aria-labelledby="spur-workflows-befehle">
            {liste.map(w => (
              <li key={w.name}>
                <code>
                  {WORKFLOW_PRAEFIX}
                  <wbr />
                  {w.name}
                </code>
              </li>
            ))}
          </ul>
        </div>
      )}
    </details>
  )
}

function Eingabe({
  verbunden,
  gesendet,
  fehler,
}: {
  verbunden: boolean
  gesendet: () => Promise<void>
  fehler: (f: string | null) => void
}) {
  const { t } = useTranslation()
  const [text, setText] = useState('')
  const [sendet, setSendet] = useState(false)
  const [leer, setLeer] = useState(false)
  const feld = useRef<HTMLTextAreaElement>(null)

  const senden = async () => {
    if (!text.trim()) {
      setLeer(true)
      feld.current?.focus()
      return
    }
    setSendet(true)
    fehler(null)
    try {
      await jsonAnfrage('POST', projektPfad('/claude/auftrag'), { text })
      setText('')
      await gesendet()
    } catch (error) {
      fehler((error as Error).message)
    } finally {
      setSendet(false)
      feld.current?.focus()
    }
  }

  return (
    <form
      className="spur-chat-eingabe"
      onSubmit={e => {
        e.preventDefault()
        senden()
      }}
    >
      <OLFormLabel htmlFor="spur-auftrag">{t('spur_auftrag')}</OLFormLabel>
      <OLFormControl
        as="textarea"
        id="spur-auftrag"
        ref={feld}
        rows={3}
        value={text}
        disabled={!verbunden}
        isInvalid={leer}
        aria-invalid={leer || undefined}
        aria-describedby={leer ? 'spur-auftrag-leer' : 'spur-auftrag-hinweis'}
        onChange={e => {
          setText(e.target.value)
          setLeer(false)
        }}
        onKeyDown={e => {
          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
            e.preventDefault()
            senden()
          }
        }}
      />
      {/* Unter dem Feld: Eine Meldung oben im Panel läge nach dem Fokus außer Sicht. */}
      {leer ? (
        <OLFormText type="error" id="spur-auftrag-leer" role="alert">
          {t('spur_auftrag_leer')}
        </OLFormText>
      ) : (
        <OLFormText id="spur-auftrag-hinweis">{verbunden ? t('spur_strg_enter') : t('spur_erst_verbinden')}</OLFormText>
      )}
      <LadeKnopf type="submit" variant="primary" size="sm" isLoading={sendet} disabled={!verbunden}>
        {t('spur_senden')}
      </LadeKnopf>
    </form>
  )
}
