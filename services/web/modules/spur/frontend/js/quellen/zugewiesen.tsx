import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import OLButton from '@/shared/components/ol/ol-button'
import Notification from '@/shared/components/notification'
import { useConnectionContext } from '@/features/ide-react/context/connection-context'
import useSocketListener from '@/features/ide-react/hooks/use-socket-listener'
import getMeta from '@/utils/meta'
import { anfrage, projektPfad } from '../api'
import type { Quelle, Zitat } from './typen'

type Zuweisung = Zitat & { quelle: Quelle }

// Hinweise auf Zitate, die jemand der angemeldeten Person zugewiesen hat.
export default function Zugewiesen({
  oeffnen,
}: {
  oeffnen: (quelle: Quelle, seite: number) => void
}) {
  const { t } = useTranslation()
  const { socket } = useConnectionContext()
  const [liste, setListe] = useState<Zuweisung[]>([])
  const [fehler, setFehler] = useState<string | null>(null)

  const laden = useCallback(async () => {
    try {
      const antwort = await anfrage<{ zitate: Zuweisung[] }>(projektPfad('/zitate/zugewiesen'))
      setListe(antwort.zitate)
      setFehler(null)
    } catch (error) {
      setFehler((error as Error).message)
    }
  }, [])

  useEffect(() => {
    laden()
  }, [laden])
  // Nur Änderungen an eigenen Zuweisungen betreffen diesen Hinweis.
  const ich = getMeta('ol-user_id')
  const live = useCallback(
    ({ an }: { an?: string }) => {
      if (an === ich) laden()
    },
    [laden, ich]
  )
  useSocketListener(socket, 'spur:zitate', live)

  const erledigt = async (zitat: Zuweisung) => {
    try {
      await anfrage(
        projektPfad(`/quellen/${zitat.quelle.id}/zitate/${zitat.id}/zuweisung`),
        { method: 'DELETE' }
      )
      await laden()
    } catch (error) {
      setFehler((error as Error).message)
    }
  }

  if (!liste.length && !fehler) return null
  return (
    <div className="spur-panel-hinweis" role="status">
      {fehler && <Notification type="error" content={fehler} />}
      {liste.map(zitat => (
        <Notification
          key={zitat.id}
          type="info"
          isActionBelowContent
          content={t('spur_ihnen_zugewiesen', {
            name: zitat.zugewiesen?.von.name,
            text: zitat.text,
            stelle: [
              zitat.quelle.dateiname,
              zitat.quelle.art === 'pdf'
                ? t('spur_seite_kurz', { seite: zitat.label ?? zitat.seite })
                : zitat.label,
            ]
              .filter(Boolean)
              .join(', '),
          })}
          action={
            <div className="spur-kommentar-knoepfe">
              <OLButton
                variant="secondary"
                size="sm"
                onClick={() => oeffnen(zitat.quelle, zitat.seite)}
              >
                {t('spur_oeffnen')}
              </OLButton>
              <OLButton variant="ghost" size="sm" onClick={() => erledigt(zitat)}>
                {t('spur_erledigt')}
              </OLButton>
            </div>
          }
        />
      ))}
    </div>
  )
}
