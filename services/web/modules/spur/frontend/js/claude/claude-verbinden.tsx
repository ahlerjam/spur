import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import OLButton from '@/shared/components/ol/ol-button'
import Notification from '@/shared/components/notification'
import getMeta from '@/utils/meta'
import { anfrage, jsonAnfrage } from '../api'
import BefehlKasten from './befehl-kasten'

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

function schritte(token: string) {
  const adresse = `${getMeta('ol-ExposedSettings').siteUrl}/spur/mcp`
  return [
    {
      titel: 'spur_schritt_bekannt_machen',
      text: 'spur_schritt_bekannt_machen_text',
      befehl: 'claude plugin marketplace add ahlerjam/spur',
    },
    {
      titel: 'spur_schritt_konto',
      text: 'spur_schritt_konto_text',
      befehl: `claude plugin install spur@spur --config server_url=${adresse} --config token=${token}`,
    },
    { titel: 'spur_schritt_starten', text: 'spur_schritt_starten_text', befehl: startBefehl() },
  ]
}

const datum = (wert: string) => new Date(wert).toLocaleDateString()

export default function ClaudeVerbinden() {
  const { t } = useTranslation()
  const [tokens, setTokens] = useState<Token[] | null>(null)
  const [neu, setNeu] = useState<string | null>(null)
  const [fehler, setFehler] = useState<string | null>(null)

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

  return (
    <div className="settings-widget-container spur-claude-verbinden">
      <div className="description-container">
        <div className="title-row">
          <h4>{t('spur_claude_verbinden')}</h4>
        </div>
        <p className="small">{t('spur_claude_verbinden_text')}</p>
        {fehler && <Notification type="error" content={fehler} />}
        {neu && (
          <div className="spur-token-neu" data-spur-token={neu}>
            <h5>{t('spur_verbinden_anleitung')}</h5>
            <p className="small">{t('spur_token_einmalig')}</p>
            <ol className="spur-schritte">
              {schritte(neu).map(schritt => (
                // Neuer Befehl (neues Token): neuer Kasten, der Knopf zeigt wieder „Kopieren“.
                <li key={schritt.befehl}>
                  <h6>{t(schritt.titel)}</h6>
                  <p className="small">{t(schritt.text)}</p>
                  <BefehlKasten befehl={schritt.befehl} />
                </li>
              ))}
            </ol>
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
