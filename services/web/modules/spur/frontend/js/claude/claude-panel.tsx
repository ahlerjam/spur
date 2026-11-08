import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import RailPanelHeader from '@/features/ide-react/components/rail/rail-panel-header'
import OLBadge from '@/shared/components/ol/ol-badge'
import OLButton from '@/shared/components/ol/ol-button'
import OLFormControl from '@/shared/components/ol/ol-form-control'
import OLFormLabel from '@/shared/components/ol/ol-form-label'
import OLFormText from '@/shared/components/ol/ol-form-text'
import Notification from '@/shared/components/notification'
import { useAbfrage } from '../abfrage'
import { anfrage, jsonAnfrage, projektPfad } from '../api'
import { startBefehl } from './claude-verbinden'
import LaufKarte, { type Aenderung, type Lauf } from './lauf-karte'
import OffenlegungModal from './offenlegung-modal'

type Nachricht ={ id: string; von: 'mensch' | 'claude'; text: string; am: string }
type Workflow = { name: string; titel: string; beschreibung: string }
type Status = {
  verbunden: boolean
  nachrichten: Nachricht[]
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
  const [kopiert, setKopiert] = useState(false)
  return (
    <div className="spur-claude-status" aria-live="polite">
      <OLBadge bg={verbunden ? 'success' : 'warning'}>
        {verbunden ? t('spur_claude_verbunden') : t('spur_claude_nicht_verbunden')}
      </OLBadge>
      {!verbunden && (
        <>
          <p className="spur-zeile-meta">{t('spur_claude_starten')}</p>
          <pre className="spur-befehl spur-befehl-kompakt">{startBefehl()}</pre>
          <OLButton
            variant="secondary"
            size="sm"
            onClick={async () => {
              await navigator.clipboard.writeText(startBefehl())
              setKopiert(true)
            }}
          >
            {kopiert ? t('spur_kopiert') : t('spur_befehl_kopieren')}
          </OLButton>
        </>
      )}
    </div>
  )
}

function Verlauf({ status, neuLaden }: { status: Status; neuLaden: () => Promise<void> }) {
  const { t } = useTranslation()
  const liste = useRef<HTMLDivElement>(null)
  const nachrichten = status.nachrichten
  const letzte = nachrichten.at(-1)
  const wartet = status.verbunden && letzte?.von === 'mensch'

  // Nur mitscrollen, wenn die Person schon unten war; sonst springt der Verlauf beim Zurücklesen.
  const unten = useRef(true)
  useLayoutEffect(() => {
    const el = liste.current
    if (el && unten.current) el.scrollTop = el.scrollHeight
  }, [letzte?.id, wartet, status.lauf?.id, status.lauf?.status])

  return (
    <div
      className="spur-chat-verlauf"
      ref={liste}
      onScroll={e => {
        const el = e.currentTarget
        unten.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40
      }}
    >
      {nachrichten.length === 0 && !status.lauf && (
        <p className="spur-leer">{t('spur_keine_nachrichten')}</p>
      )}
      <ol className="spur-chat" role="log" aria-label={t('spur_unterhaltung')}>
        {nachrichten.map(n => (
          <li className={`spur-chat-nachricht spur-nachricht-${n.von}`} key={n.id}>
            <p className="spur-zeile-meta">
              {n.von === 'claude' ? 'Claude' : t('spur_du')} ·{' '}
              <time dateTime={n.am}>{new Date(n.am).toLocaleTimeString()}</time>
            </p>
            <p className="spur-nachricht-text">{n.text}</p>
          </li>
        ))}
        {status.lauf && (
          <li className="spur-chat-lauf">
            <LaufKarte
              lauf={status.lauf}
              aenderungen={status.aenderungen}
              automatik={status.automatik}
              neuLaden={neuLaden}
            />
          </li>
        )}
        {wartet && <li className="spur-chat-wartet">{t('spur_claude_arbeitet')}</li>}
      </ol>
    </div>
  )
}

// Claude kann MCP-Prompts nicht selbst aufrufen; der Knopf legt den vollen Workflow-Text als Auftrag ab.
function Workflows({ gestartet, fehler }: { gestartet: () => Promise<void>; fehler: (f: string | null) => void }) {
  const { t } = useTranslation()
  const [liste, setListe] = useState<Workflow[]>([])
  const [laeuft, setLaeuft] = useState<string | null>(null)

  useEffect(() => {
    anfrage<{ workflows: Workflow[] }>(projektPfad('/workflows'))
      .then(antwort => setListe(antwort.workflows))
      .catch(error => fehler((error as Error).message))
  }, [fehler])

  const starten = async (name: string) => {
    setLaeuft(name)
    fehler(null)
    try {
      await jsonAnfrage('POST', projektPfad(`/workflows/${name}/starten`))
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
              onClick={() => starten(w.name)}
            >
              {w.titel}
            </OLButton>
            <p className="spur-zeile-meta" id={`spur-workflow-${w.name}`}>
              {w.beschreibung}
            </p>
          </li>
        ))}
      </ul>
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
