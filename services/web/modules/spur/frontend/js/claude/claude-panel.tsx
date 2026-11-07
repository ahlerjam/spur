import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import RailPanelHeader from '@/features/ide-react/components/rail/rail-panel-header'
import OLBadge from '@/shared/components/ol/ol-badge'
import OLButton from '@/shared/components/ol/ol-button'
import OLFormControl from '@/shared/components/ol/ol-form-control'
import OLFormLabel from '@/shared/components/ol/ol-form-label'
import Notification from '@/shared/components/notification'
import { anfrage, jsonAnfrage, projektPfad } from '../api'
import { startBefehl } from './claude-verbinden'
import LaufKarte, { type Aenderung, type Lauf } from './lauf-karte'

type Nachricht = { id: string; von: 'mensch' | 'claude'; text: string; am: string }
type Status = {
  verbunden: boolean
  nachrichten: Nachricht[]
  automatik: boolean
  lauf: Lauf | null
  aenderungen: Aenderung[]
}

const ABFRAGE_MS = 5000

export default function ClaudePanel() {
  const { t } = useTranslation()
  const [status, setStatus] = useState<Status | null>(null)
  const [fehler, setFehler] = useState<string | null>(null)
  const [text, setText] = useState('')
  const [sendet, setSendet] = useState(false)
  const feld = useRef<HTMLTextAreaElement>(null)

  const laden = useCallback(async () => {
    try {
      setStatus(await anfrage<Status>(projektPfad('/claude')))
    } catch (error) {
      setFehler((error as Error).message)
    }
  }, [])

  useEffect(() => {
    laden()
    const takt = setInterval(() => {
      if (!document.hidden) laden()
    }, ABFRAGE_MS)
    return () => clearInterval(takt)
  }, [laden])

  const senden = async () => {
    if (!text.trim()) return
    setSendet(true)
    setFehler(null)
    try {
      await jsonAnfrage('POST', projektPfad('/claude/auftrag'), { text })
      setText('')
      await laden()
    } catch (error) {
      setFehler((error as Error).message)
    } finally {
      setSendet(false)
      feld.current?.focus()
    }
  }

  return (
    <div className="spur-panel">
      <RailPanelHeader title={t('spur_claude')} />
      <div className="spur-panel-inhalt">
        {fehler && <Notification type="error" content={fehler} />}
        {status && (
          <div className="spur-claude-status" aria-live="polite">
            <OLBadge bg={status.verbunden ? 'success' : 'warning'}>
              {status.verbunden ? t('spur_claude_verbunden') : t('spur_claude_nicht_verbunden')}
            </OLBadge>
            {!status.verbunden && (
              <>
                <p className="spur-zeile-meta">{t('spur_claude_starten')}</p>
                <pre className="spur-befehl">{startBefehl()}</pre>
              </>
            )}
          </div>
        )}
        {status?.lauf && (
          <LaufKarte
            lauf={status.lauf}
            aenderungen={status.aenderungen}
            automatik={status.automatik}
            neuLaden={laden}
          />
        )}
        <form
          className="spur-fassung"
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
            onChange={e => setText(e.target.value)}
          />
          <OLButton type="submit" variant="primary" size="sm" isLoading={sendet}>
            {t('spur_senden')}
          </OLButton>
        </form>
        {status?.nachrichten.length === 0 && (
          <p className="spur-leer">{t('spur_keine_nachrichten')}</p>
        )}
        <ul className="spur-liste">
          {status?.nachrichten.map(n => (
            <li className={`spur-zeile spur-nachricht-${n.von}`} key={n.id}>
              <p className="spur-zeile-meta">
                {n.von === 'claude' ? 'Claude' : t('spur_du')} ·{' '}
                {new Date(n.am).toLocaleTimeString()}
              </p>
              <p className="spur-nachricht-text">{n.text}</p>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
