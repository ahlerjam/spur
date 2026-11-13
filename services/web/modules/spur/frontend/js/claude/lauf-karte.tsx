import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import OLBadge from '@/shared/components/ol/ol-badge'
import OLButton from '@/shared/components/ol/ol-button'
import LadeKnopf from '../lade-knopf'
import { OLModal, OLModalBody, OLModalFooter, OLModalHeader, OLModalTitle } from '@/shared/components/ol/ol-modal'
import MaterialIcon from '@/shared/components/material-icon'
import Notification from '@/shared/components/notification'
import { usePermissionsContext } from '@/features/ide-react/context/permissions-context'
import { jsonAnfrage, projektPfad } from '../api'

export type Lauf = {
  id: string
  status: 'offen' | 'fertig' | 'angenommen' | 'abgelehnt' | 'zurueckgenommen'
  gestartet: string
  dateien: number
  aenderungen: number
  rot: { grund: string; auszug: string }[]
  zahlen: { zahl: string; pfad: string }[]
  zusammenfassung: string | null
  angelegt?: { art: 'datei' | 'ordner' | 'quelle'; pfad?: string; name?: string }[]
  rotAenderungen?: string[]
  automatisch?: { pfad: string; zeile: number; art: 'einfuegung' | 'loeschung'; text: string }[]
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

function AenderungZeile({
  aenderung,
  aktionen,
}: {
  aenderung: Pick<Aenderung, 'pfad' | 'zeile' | 'art' | 'text'>
  aktionen?: React.ReactNode
}) {
  const { t } = useTranslation()
  return (
    <li className="spur-zeile spur-lauf-aenderung">
      <p className="spur-zeile-meta">
        {aenderung.pfad}:{aenderung.zeile} · {aenderung.art === 'einfuegung' ? t('spur_eingefuegt') : t('spur_geloescht')}
      </p>
      <p className="spur-nachricht-text">{aenderung.text}</p>
      {aktionen}
    </li>
  )
}

export default function LaufKarte({
  lauf,
  aenderungen,
  neuLaden,
  aufgeklappt = true,
}: {
  lauf: Lauf
  aenderungen: Aenderung[]
  neuLaden: () => Promise<void>
  aufgeklappt?: boolean
}) {
  const { t } = useTranslation()
  const { write, trackedWrite } = usePermissionsContext()
  // Ablehnen dürfen wie im Server Schreibende und Reviewer.
  const darfAblehnen = write || trackedWrite
  const [offen, setOffen] = useState(aufgeklappt)
  const [fehler, setFehler] = useState<string | null>(null)
  const [laeuft, setLaeuft] = useState(false)
  const [fragen, setFragen] = useState(false)
  const alleAnnehmen = useRef<HTMLButtonElement>(null)
  // Nach jedem Schließen des Dialogs (Annehmen, Abbrechen, Esc) liegt der Fokus wieder auf „Alle annehmen“.
  const warOffen = useRef(false)
  useEffect(() => {
    if (warOffen.current && !fragen) alleAnnehmen.current?.focus()
    warOffen.current = fragen
  }, [fragen])
  const pfad = (aktion: string) => projektPfad(`/laeufe/${lauf.id}/${aktion}`)
  const laufOffen = lauf.status === 'offen' || lauf.status === 'fertig'
  const changes = aenderungen.filter(a => !a.geloescht)
  const rot = new Set(lauf.rotAenderungen ?? [])
  const zuPruefen = changes.filter(a => a.id && rot.has(a.id))
  const uebrige = changes.filter(a => !a.id || !rot.has(a.id))
  const automatisch = lauf.automatisch ?? []
  const angelegt = lauf.angelegt ?? []
  const rotMitAuszug = lauf.rot.filter(r => r.auszug)
  const koerperId = `spur-lauf-${lauf.id}`

  const aktion = async (methode: string, url: string, daten?: unknown) => {
    setLaeuft(true)
    setFehler(null)
    try {
      await jsonAnfrage(methode, url, daten)
      await neuLaden()
      return true
    } catch (error) {
      setFehler((error as Error).message)
      return false
    } finally {
      setLaeuft(false)
    }
  }

  const mitDialogAnnehmen = async (daten?: unknown) => {
    if (await aktion('POST', pfad('annehmen'), daten)) setFragen(false)
  }

  // Ohne Rückfrage nur, was die Karte kennt: Ein rotes Zitat, das erst nach dem Laden dazukam, bleibt offen.
  const keineRoten = () => aktion('POST', pfad('annehmen'), { change_ids: uebrige.map(a => a.id) })

  const knoepfe = (a: Aenderung) => (
    <div className="spur-panel-werkzeuge spur-ohne-rand">
      {write && (
        <OLButton variant="secondary" size="sm" disabled={laeuft} onClick={() => aktion('POST', pfad('annehmen'), { change_ids: [a.id] })}>
          {t('spur_annehmen')}
        </OLButton>
      )}
      {darfAblehnen && (
        <OLButton variant="ghost" size="sm" disabled={laeuft} onClick={() => aktion('POST', pfad('ablehnen'), { change_ids: [a.id] })}>
          {t('spur_ablehnen')}
        </OLButton>
      )}
    </div>
  )

  return (
    <section className="spur-lauf-karte" aria-labelledby={`${koerperId}-titel`}>
      <h5 className="spur-lauf-kopf" id={`${koerperId}-titel`}>
        <button type="button" aria-expanded={offen} aria-controls={koerperId} onClick={() => setOffen(!offen)}>
          <MaterialIcon type={offen ? 'expand_more' : 'chevron_right'} />
          <span>{t('spur_lauf')}</span>
          <OLBadge bg={STUFE[lauf.status]}>{t(`spur_lauf_${lauf.status}`)}</OLBadge>
          {laufOffen && changes.length > 0 && (
            <span className="spur-zeile-meta">{t('spur_lauf_offen_zahl', { anzahl: changes.length })}</span>
          )}
        </button>
      </h5>
      {offen && (
        <div id={koerperId}>
          <p className="spur-zeile-meta">
            {t('spur_lauf_umfang', { dateien: lauf.dateien, anzahl: lauf.aenderungen })}
          </p>
          {lauf.zusammenfassung && <p className="spur-nachricht-text">{lauf.zusammenfassung}</p>}
          {laufOffen && zuPruefen.length > 0 && (
            <div className="spur-lauf-rot" role="status">
              <OLBadge bg="danger">{t('spur_bitte_pruefen')}</OLBadge>
              <ul className="spur-liste">
                {zuPruefen.map(a => (
                  <AenderungZeile key={a.id} aenderung={a} aktionen={knoepfe(a)} />
                ))}
              </ul>
            </div>
          )}
          {laufOffen && zuPruefen.length === 0 && rotMitAuszug.length > 0 && (
            <div className="spur-lauf-rot" role="status">
              <OLBadge bg="danger">{t('spur_bitte_pruefen')}</OLBadge>
              <ul className="spur-liste">
                {rotMitAuszug.map((r, i) => (
                  <li key={i} className="spur-zeile-meta">
                    {t('spur_nicht_pruefbar')}: {r.auszug}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {lauf.zahlen.length > 0 && (
            <p className="spur-lauf-hinweis" role="status">
              {t('spur_zahl_ohne_beleg_liste', { zahlen: [...new Set(lauf.zahlen.map(z => z.zahl))].join(', ') })}
            </p>
          )}
          {aenderungen.some(a => a.geloescht) && <p className="spur-zeile-meta">{t('spur_datei_geloescht')}</p>}
          {angelegt.length > 0 && (
            <div>
              <p className="spur-zeile-meta">{t('spur_lauf_angelegt')}</p>
              <ul className="spur-liste">
                {angelegt.map(a => (
                  <li key={`${a.art}-${a.pfad ?? a.name}`} className="spur-zeile-meta spur-lauf-angelegt">
                    {a.pfad ?? a.name}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {fehler && <Notification type="error" content={fehler} />}
          {laufOffen && uebrige.length > 0 && (
            <ul className="spur-liste">
              {uebrige.map(a => (
                <AenderungZeile key={a.id} aenderung={a} aktionen={knoepfe(a)} />
              ))}
            </ul>
          )}
          {automatisch.length > 0 && (
            <div className="spur-lauf-automatisch">
              <p className="spur-zeile-meta">{t('spur_automatisch_angenommen')}</p>
              <ul className="spur-liste">
                {automatisch.map((a, i) => (
                  <AenderungZeile key={i} aenderung={a} />
                ))}
              </ul>
            </div>
          )}
          <div className="spur-panel-werkzeuge spur-ohne-rand">
            {laufOffen && write && changes.length > 0 && (
              <LadeKnopf
                ref={alleAnnehmen}
                variant="primary"
                size="sm"
                isLoading={laeuft}
                onClick={() => (zuPruefen.length > 0 ? setFragen(true) : keineRoten())}
              >
                {t('spur_alle_annehmen')}
              </LadeKnopf>
            )}
            {laufOffen && darfAblehnen && changes.length > 0 && (
              <OLButton variant="danger-ghost" size="sm" disabled={laeuft} onClick={() => aktion('POST', pfad('ablehnen'))}>
                {t('spur_lauf_ablehnen')}
              </OLButton>
            )}
            {(lauf.status === 'angenommen' || (laufOffen && (angelegt.length > 0 || automatisch.length > 0))) && write && (
              <OLButton variant="secondary" size="sm" disabled={laeuft} onClick={() => aktion('POST', pfad('zuruecknehmen'))}>
                {t('spur_lauf_rueckgaengig')}
              </OLButton>
            )}
          </div>
          <p className="spur-zeile-meta">{t('spur_label_hinweis')}</p>
          {fragen && (
            <OLModal themed show onHide={() => setFragen(false)}>
              <OLModalHeader>
                <OLModalTitle>{t('spur_rote_mitannehmen_titel', { count: zuPruefen.length })}</OLModalTitle>
              </OLModalHeader>
              <OLModalBody>
                <p>{t('spur_rote_mitannehmen_text')}</p>
              </OLModalBody>
              <OLModalFooter>
                <OLButton
                  variant="primary"
                  autoFocus
                  disabled={uebrige.length === 0}
                  onClick={() => mitDialogAnnehmen({ change_ids: uebrige.map(a => a.id) })}
                >
                  {t('spur_nur_die_anderen')}
                </OLButton>
                <LadeKnopf
                  variant="secondary"
                  isLoading={laeuft}
                  onClick={() => mitDialogAnnehmen()}
                >
                  {t('spur_alle_annehmen')}
                </LadeKnopf>
              </OLModalFooter>
            </OLModal>
          )}
        </div>
      )}
    </section>
  )
}
