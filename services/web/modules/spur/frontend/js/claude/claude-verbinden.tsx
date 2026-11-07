import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import OLButton from '@/shared/components/ol/ol-button'
import Notification from '@/shared/components/notification'
import getMeta from '@/utils/meta'
import { anfrage, jsonAnfrage } from '../api'

type Token = { id: string; angelegt: string; ablauf: string; abgelaufen: boolean }

const SCHREIBWERKZEUGE = [
  'quote_mark',
  'doc_edit',
  'doc_create',
  'reply',
  'run_finish',
  'wait_for_event',
]

export function startBefehl() {
  const regeln = SCHREIBWERKZEUGE.map(w => `mcp__plugin_spur_spur__${w}`).join(' ')
  return `claude --allowedTools "${regeln}"`
}

function einrichtung(token: string) {
  const adresse = `${getMeta('ol-ExposedSettings').siteUrl}/spur/mcp`
  return [
    'claude plugin marketplace add ahlerjam/spur',
    `claude plugin install spur@spur --config server_url=${adresse} --config token=${token}`,
    startBefehl(),
  ].join('\n')
}

const datum = (wert: string) => new Date(wert).toLocaleDateString()

export default function ClaudeVerbinden() {
  const { t } = useTranslation()
  const [tokens, setTokens] = useState<Token[] | null>(null)
  const [neu, setNeu] = useState<string | null>(null)
  const [fehler, setFehler] = useState<string | null>(null)
  const [kopiert, setKopiert] = useState(false)

  const laden = useCallback(async () => {
    try {
      setTokens((await anfrage<{ tokens: Token[] }>('/spur/claude/tokens')).tokens)
    } catch (error) {
      setFehler((error as Error).message)
    }
  }, [])

  useEffect(() => {
    laden()
  }, [laden])

  const erzeugen = async () => {
    setFehler(null)
    setKopiert(false)
    try {
      const { token } = await jsonAnfrage<{ token: string }>('POST', '/spur/claude/tokens')
      setNeu(token)
      await laden()
    } catch (error) {
      setFehler((error as Error).message)
    }
  }

  const widerrufen = async (id: string) => {
    setFehler(null)
    try {
      await jsonAnfrage('DELETE', `/spur/claude/tokens/${id}`)
      setNeu(null)
      await laden()
    } catch (error) {
      setFehler((error as Error).message)
    }
  }

  const kopieren = async () => {
    if (!neu) return
    await navigator.clipboard.writeText(einrichtung(neu))
    setKopiert(true)
  }

  return (
    <div className="settings-widget-container spur-claude-verbinden">
      <div className="description-container">
        <div className="title-row">
          <h4>{t('spur_claude_verbinden')}</h4>
        </div>
        <p className="small">{t('spur_claude_verbinden_text')}</p>
        {fehler && <Notification type="error" content={fehler} />}
        {neu && (
          <div className="spur-token-neu">
            <p className="small">{t('spur_token_einmalig')}</p>
            <pre className="spur-befehl" data-spur-token={neu}>
              {einrichtung(neu)}
            </pre>
            <OLButton variant="secondary" size="sm" onClick={kopieren}>
              {kopiert ? t('spur_kopiert') : t('spur_befehl_kopieren')}
            </OLButton>
          </div>
        )}
        <ul className="spur-liste">
          {tokens?.map(token => (
            <li className="spur-zeile spur-token" key={token.id}>
              <span>
                {token.abgelaufen
                  ? t('spur_token_abgelaufen')
                  : t('spur_token_gueltig_bis', { datum: datum(token.ablauf) })}
              </span>
              <OLButton variant="danger-ghost" size="sm" onClick={() => widerrufen(token.id)}>
                {t('spur_widerrufen')}
              </OLButton>
            </li>
          ))}
        </ul>
      </div>
      <div>
        <OLButton variant="secondary" onClick={erzeugen}>
          {t('spur_token_erzeugen')}
        </OLButton>
      </div>
    </div>
  )
}
