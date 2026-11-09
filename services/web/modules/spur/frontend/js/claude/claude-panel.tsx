import { type FormEvent, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import RailPanelHeader from '@/features/ide-react/components/rail/rail-panel-header'
import OLBadge from '@/shared/components/ol/ol-badge'
import OLButton from '@/shared/components/ol/ol-button'
import OLFormControl from '@/shared/components/ol/ol-form-control'
import OLFormGroup from '@/shared/components/ol/ol-form-group'
import OLFormLabel from '@/shared/components/ol/ol-form-label'
import OLFormText from '@/shared/components/ol/ol-form-text'
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
type Status = {
  verbunden: boolean
  nachrichten: Nachricht[]
  aeltere?: boolean
  automatik: boolean
  lauf: Lauf | null
  aenderungen: Aenderung[]
}

export default function ClaudePanel() {
  const { t } = useTranslation()
  const { daten: status, fehler, setFehler, laden } = useAbfrage<Status>(projektPfad('/claude'))
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
      {fehler && (
        <div className="spur-chat-meldung">
          <Notification type="error" content={fehler} />
        </div>
      )}
      {status && (
        <>
          <Verbindung verbunden={status.verbunden} />
          <Verlauf status={status} neuLaden={laden} />
          {status.verbunden && (
            <>
              <Workflows gestartet={laden} fehler={setFehler} />
              <Eingabe gesendet={laden} fehler={setFehler} />
            </>
          )}
        </>
      )}
    </div>
  )
}

function Verbindung({ verbunden }: { verbunden: boolean }) {
  const { t } = useTranslation()
  return (
    <div className="spur-claude-status" aria-live="polite">
      <OLBadge bg={verbunden ? 'success' : 'warning'}>
        {verbunden ? t('spur_claude_verbunden') : t('spur_claude_nicht_verbunden')}
      </OLBadge>
      {!verbunden && (
        <>
          <p className="spur-zeile-meta">{t('spur_claude_starten')}</p>
          <BefehlKasten befehl={startBefehl()} />
        </>
      )}
    </div>
  )
}

function Verlauf({ status, neuLaden }: { status: Status; neuLaden: () => Promise<void> }) {
  const { t, i18n } = useTranslation()
  const nachrichten = status.nachrichten
  const wartet = status.verbunden && nachrichten.at(-1)?.von === 'mensch'
  // Die Lauf-Karte steht dort im Verlauf, wo der Lauf begann; spätere Antworten folgen darunter.
  const { lauf } = status
  const laufBei = lauf
    ? nachrichten.filter(n => new Date(n.am) <= new Date(lauf.gestartet)).length
    : -1
  const laufKarte = lauf && (
    <li className="spur-chat-lauf" key="lauf">
      <LaufKarte
        lauf={lauf}
        aenderungen={status.aenderungen}
        automatik={status.automatik}
        neuLaden={neuLaden}
      />
    </li>
  )

  // column-reverse im CSS hält den Verlauf unten, ohne das Zurücklesen zu stören.
  return (
    <div className="spur-chat-verlauf">
      <div>
        {nachrichten.length === 0 && !status.lauf && (
          <p className="spur-leer">{t('spur_keine_nachrichten')}</p>
        )}
        {status.aeltere && (
          <p className="spur-zeile-meta spur-chat-aeltere">
            {t('spur_chat_aeltere', { anzahl: nachrichten.length })}
          </p>
        )}
        <ol className="spur-chat" role="log" aria-label={t('spur_unterhaltung')}>
          {nachrichten.map((n, i) => [
            i === laufBei && laufKarte,
            <li className={`spur-chat-nachricht spur-nachricht-${n.von}`} key={n.id}>
              <p className="spur-zeile-meta">
                {n.von === 'claude' ? 'Claude' : t('spur_du')} ·{' '}
                <time dateTime={n.am}>
                  {new Date(n.am).toLocaleTimeString(i18n.language, { hour: '2-digit', minute: '2-digit' })}
                </time>
              </p>
              <p className="spur-nachricht-text">{n.text}</p>
            </li>,
          ])}
          {laufBei === nachrichten.length && laufKarte}
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
      <OLButton type="submit" variant="primary" size="sm" isLoading={laeuft}>
        {t('spur_sammeln_starten')}
      </OLButton>
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
            <OLButton
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
            </OLButton>
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

function Eingabe({ gesendet, fehler }: { gesendet: () => Promise<void>; fehler: (f: string | null) => void }) {
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
        <OLFormText id="spur-auftrag-hinweis">{t('spur_strg_enter')}</OLFormText>
      )}
      <OLButton type="submit" variant="primary" size="sm" isLoading={sendet}>
        {t('spur_senden')}
      </OLButton>
    </form>
  )
}
