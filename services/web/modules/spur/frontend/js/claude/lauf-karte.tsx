import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import OLBadge from '@/shared/components/ol/ol-badge'
import OLButton from '@/shared/components/ol/ol-button'
import OLFormCheckbox from '@/shared/components/ol/ol-form-checkbox'
import Notification from '@/shared/components/notification'
import { usePermissionsContext } from '@/features/ide-react/context/permissions-context'
import { jsonAnfrage, projektPfad } from '../api'

export type Lauf = {
  id: string
  status: 'offen' | 'fertig' | 'angenommen' | 'abgelehnt' | 'zurueckgenommen'
  dateien: number
  aenderungen: number
  rot: { grund: string; auszug: string }[]
  zahlen: { zahl: string; pfad: string }[]
  zusammenfassung: string | null
}

export type Aenderung = {
  id?: string
  docId: string
  pfad?: string
  art?: 'einfuegung' | 'loeschung'
  text?: string
  zeile?: number
  geloescht?: boolean
}

const STUFE = {
  offen: 'info',
  fertig: 'info',
  angenommen: 'success',
  abgelehnt: 'warning',
  zurueckgenommen: 'warning',
} as const

export default function LaufKarte({
  lauf,
  aenderungen,
  automatik,
  neuLaden,
}: {
  lauf: Lauf
  aenderungen: Aenderung[]
  automatik: boolean
  neuLaden: () => Promise<void>
}) {
  const { t } = useTranslation()
  const { write, trackedWrite } = usePermissionsContext()
  // Ablehnen dürfen wie im Server Schreibende und Reviewer.
  const darfAblehnen = write || trackedWrite
  const [fehler, setFehler] = useState<string | null>(null)
  const [laeuft, setLaeuft] = useState(false)
  const [automatikAn, setAutomatikAn] = useState(automatik)
  useEffect(() => setAutomatikAn(automatik), [automatik])
  const pfad = (aktion: string) => projektPfad(`/laeufe/${lauf.id}/${aktion}`)
  const offen = lauf.status === 'offen' || lauf.status === 'fertig'
  const changes = aenderungen.filter(a => !a.geloescht)

  const aktion = async (methode: string, url: string, daten?: unknown) => {
    setLaeuft(true)
    setFehler(null)
    try {
      await jsonAnfrage(methode, url, daten)
      await neuLaden()
    } catch (error) {
      setFehler((error as Error).message)
    } finally {
      setLaeuft(false)
    }
  }

  return (
    <section className="spur-lauf-karte" aria-labelledby="spur-lauf-titel">
      <div className="spur-lauf-kopf">
        <h5 id="spur-lauf-titel">{t('spur_lauf')}</h5>
        <OLBadge bg={STUFE[lauf.status]}>{t(`spur_lauf_${lauf.status}`)}</OLBadge>
      </div>
      <p className="spur-zeile-meta">
        {t('spur_lauf_umfang', { dateien: lauf.dateien, anzahl: lauf.aenderungen })}
      </p>
      {lauf.zusammenfassung && <p className="spur-nachricht-text">{lauf.zusammenfassung}</p>}
      {lauf.rot.length > 0 && (
        <div className="spur-lauf-rot" role="status">
          <OLBadge bg="danger">{t('spur_bitte_pruefen')}</OLBadge>
          <ul className="spur-liste">
            {lauf.rot.map((r, i) => (
              <li key={i} className="spur-zeile-meta">
                {t('spur_nicht_pruefbar')}: {r.auszug}
              </li>
            ))}
          </ul>
        </div>
      )}
      {lauf.zahlen.length > 0 && (
        <div className="spur-lauf-rot" role="status">
          <OLBadge bg="warning">{t('spur_zahl_ohne_beleg')}</OLBadge>
          <ul className="spur-liste">
            {lauf.zahlen.map((z, i) => (
              <li key={i} className="spur-zeile-meta">
                {t('spur_zahl_ohne_beleg_text', { zahl: z.zahl, pfad: z.pfad })}
              </li>
            ))}
          </ul>
        </div>
      )}
      {aenderungen.some(a => a.geloescht) && (
        <p className="spur-zeile-meta">{t('spur_datei_geloescht')}</p>
      )}
      {fehler && <Notification type="error" content={fehler} />}
      {offen && changes.length > 0 && (
        <ul className="spur-liste">
          {changes.map(a => (
            <li className="spur-zeile spur-lauf-aenderung" key={a.id}>
              <p className="spur-zeile-meta">
                {a.pfad}:{a.zeile} ·{' '}
                {a.art === 'einfuegung' ? t('spur_eingefuegt') : t('spur_geloescht')}
              </p>
              <p className="spur-nachricht-text">{a.text}</p>
              <div className="spur-panel-werkzeuge spur-ohne-rand">
                {write && (
                  <OLButton
                    variant="secondary"
                    size="sm"
                    disabled={laeuft}
                    onClick={() => aktion('POST', pfad('annehmen'), { change_ids: [a.id] })}
                  >
                    {t('spur_annehmen')}
                  </OLButton>
                )}
                {darfAblehnen && (
                  <OLButton
                    variant="ghost"
                    size="sm"
                    disabled={laeuft}
                    onClick={() => aktion('POST', pfad('ablehnen'), { change_ids: [a.id] })}
                  >
                    {t('spur_ablehnen')}
                  </OLButton>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      <div className="spur-panel-werkzeuge spur-ohne-rand">
        {offen && write && changes.length > 0 && (
          <OLButton variant="primary" size="sm" isLoading={laeuft} onClick={() => aktion('POST', pfad('annehmen'))}>
            {t('spur_alle_annehmen')}
          </OLButton>
        )}
        {offen && darfAblehnen && changes.length > 0 && (
          <OLButton variant="danger-ghost" size="sm" disabled={laeuft} onClick={() => aktion('POST', pfad('ablehnen'))}>
            {t('spur_lauf_ablehnen')}
          </OLButton>
        )}
        {lauf.status === 'angenommen' && write && (
          <OLButton variant="secondary" size="sm" disabled={laeuft} onClick={() => aktion('POST', pfad('zuruecknehmen'))}>
            {t('spur_lauf_rueckgaengig')}
          </OLButton>
        )}
      </div>
      {write && (
        <OLFormCheckbox
          id="spur-automatik"
          label={t('spur_automatisch_annehmen')}
          checked={automatikAn}
          onChange={e => {
            setAutomatikAn(e.target.checked)
            aktion('PUT', projektPfad('/claude/automatik'), { an: e.target.checked })
          }}
        />
      )}
      <p className="spur-zeile-meta">{t('spur_label_hinweis')}</p>
    </section>
  )
}
