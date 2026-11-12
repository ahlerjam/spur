import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { useTranslation } from 'react-i18next'
import RailPanelHeader from '@/features/ide-react/components/rail/rail-panel-header'
import { useEditorManagerContext } from '@/features/ide-react/context/editor-manager-context'
import OLBadge from '@/shared/components/ol/ol-badge'
import OLButton from '@/shared/components/ol/ol-button'
import OLFormCheckbox from '@/shared/components/ol/ol-form-checkbox'
import OLSpinner from '@/shared/components/ol/ol-spinner'
import Notification from '@/shared/components/notification'
import PruefEinstellungen from './pruef-einstellungen'
import { type Bericht, pruefen, pruefenWennNoetig, pruefStore, STELLEN_STATUS, Zeile } from './pruef-store'

type Stufe = 'success' | 'warning' | 'danger' | 'info'

function useBadges(zeile: Zeile) {
  const { t } = useTranslation()
  const badges: { text: string; stufe: Stufe }[] = []
  const add = (text: string, stufe: Stufe) => badges.push({ text, stufe })

  if (zeile.wortlaut === 'exakt') add(t('spur_wortlaut_exakt'), 'success')
  if (zeile.wortlaut === 'trennung') add(t('spur_wortlaut_trennung'), 'success')
  if (zeile.wortlaut === 'abweichend') add(t('spur_wortlaut_abweichend'), 'danger')
  if (zeile.wortlaut === 'nicht_pruefbar') add(t('spur_nicht_pruefbar'), 'warning')
  if (zeile.wortlaut === 'quelle_fehlt') add(t('spur_quelle_fehlt'), 'danger')
  if (zeile.wortlaut === 'ocr_unbestaetigt') add(t('spur_wortlaut_ocr'), 'warning')
  if (zeile.wortlaut === 'bestaetigt') add(t('spur_wortlaut_bestaetigt'), 'success')

  if (zeile.status === 'beleg_ohne_wortlaut') add(t('spur_beleg_ohne_wortlaut'), 'info')

  if (zeile.seite === 'stimmt') add(t('spur_seite_stimmt'), 'success')
  if (zeile.seite === 'bestaetigt') add(t('spur_seite_bestaetigt'), 'success')
  if (zeile.seite === 'nicht_pruefbar') add(t('spur_seite_nicht_pruefbar'), 'warning')
  if (zeile.seite === 'gefunden') {
    add(t('spur_gefunden_auf', { seite: zeile.gefundenAuf }), 'warning')
  }

  if (zeile.referenz === 'nicht_gefunden') add(t('spur_referenz_nicht_gefunden'), 'danger')
  // Ein Ausfall bei Crossref oder der Registrierstelle ist kein Befund über die Arbeit: neutral, nicht als Fehler.
  if (zeile.referenz === 'nicht_pruefbar') {
    add(
      t(zeile.grund === 'registrierstelle_nicht_erreichbar' ? 'spur_referenz_registrierstelle_nicht_erreichbar' : 'spur_referenz_nicht_pruefbar'),
      'info'
    )
  }
  if (zeile.registrierstelle === 'datacite' && zeile.referenz === 'gefunden') add(t('spur_referenz_datacite'), 'success')
  if (zeile.referenz === 'registriert') add(t('spur_referenz_registriert', { name: zeile.registrierstelleName }), 'info')
  if (zeile.retraction === 'zurueckgezogen') add(t('spur_zurueckgezogen'), 'danger')
  if (zeile.retraction === 'korrektur') add(t('spur_korrektur'), 'warning')
  if (zeile.retraction === 'keine_meldung') add(t('spur_keine_meldung'), 'info')
  return badges
}

function BerichtZeile({ zeile }: { zeile: Zeile }) {
  const { t } = useTranslation()
  const { openDocWithId } = useEditorManagerContext()
  const badges = useBadges(zeile)
  return (
    <li className="spur-zeile">
      <OLButton
        variant="link"
        size="sm"
        className="spur-zeile-link"
        onClick={() => openDocWithId(zeile.docId, { gotoLine: zeile.zeile })}
      >
        {zeile.pfad}:{zeile.zeile}
      </OLButton>
      {zeile.key && <span className="spur-zeile-key">{zeile.key}</span>}
      {zeile.auszug && <p className="spur-zeile-auszug">{zeile.auszug}</p>}
      {/* Den Ausfall und den Beleg ohne Wortlaut nennt schon die Marke darunter. */}
      {zeile.grund && zeile.referenz !== 'nicht_pruefbar' && zeile.status !== 'beleg_ohne_wortlaut' && (
        <p className="spur-zeile-meta">{t(`spur_grund_${zeile.grund}`)}</p>
      )}
      {zeile.registrierstelle === 'datacite' && zeile.referenz === 'gefunden' && (
        <p className="spur-zeile-meta">{t('spur_referenz_datacite_hinweis')}</p>
      )}
      <div className="spur-badges" aria-label={t('spur_status')}>
        {badges.map(b => (
          <OLBadge key={b.text} bg={b.stufe}>
            {b.text}
          </OLBadge>
        ))}
      </div>
    </li>
  )
}

function Zaehlung({ zaehlung }: { zaehlung: Bericht['zaehlung'] }) {
  const { t } = useTranslation()
  const teile = STELLEN_STATUS.filter(s => zaehlung[s] > 0).map(s => t(`spur_stellen_${s}`, { anzahl: zaehlung[s], count: zaehlung[s] }))
  if (zaehlung.geprueft > 0) {
    teile[0] += zaehlung.markiert > 0 ? `, ${t('spur_stellen_markiert', { anzahl: zaehlung.markiert })}` : `, ${t('spur_stellen_keine_markiert')}`
  }
  return <p className="spur-zeile-meta">{t('spur_zitierstellen', { liste: teile.join(', ') })}</p>
}

export default function PruefberichtPanel() {
  const { t } = useTranslation()
  const zustand = useSyncExternalStore(pruefStore.abonnieren, pruefStore.zustand)
  const [nurProbleme, setNurProbleme] = useState(false)
  const { bericht, status, fehler } = zustand

  useEffect(() => {
    pruefenWennNoetig()
  }, [])

  const zeilen = useMemo(
    () =>
      (bericht?.zeilen ?? []).filter(z => !nurProbleme || z.problem),
    [bericht, nurProbleme]
  )

  return (
    <div className="spur-panel">
      <RailPanelHeader title={t('spur_pruefbericht')} />
      <div className="spur-panel-werkzeuge">
        <OLFormCheckbox
          id="spur-nur-probleme"
          label={t('spur_nur_probleme')}
          checked={nurProbleme}
          onChange={e => setNurProbleme(e.target.checked)}
        />
        <OLButton variant="secondary" size="sm" onClick={pruefen}>
          {t('spur_erneut_pruefen')}
        </OLButton>
        <PruefEinstellungen />
      </div>
      <div className="spur-panel-inhalt" aria-live="polite">
        {status === 'laeuft' && <OLSpinner size="sm" />}
        {status === 'laeuft' && !bericht && <span> {t('spur_pruefung_laeuft')}</span>}
        {status === 'fehler' && (
          <Notification
            type="error"
            content={t('spur_pruefung_fehler', { grund: fehler })}
          />
        )}
        {bericht?.zeilen.length === 0 && status !== 'fehler' && (
          <p className="spur-leer">{t('spur_keine_zitate')}</p>
        )}
        {bericht && bericht.zeilen.length > 0 && zeilen.length === 0 && (
          <p className="spur-leer">{t('spur_keine_probleme')}</p>
        )}
        {bericht && bericht.zeilen.length > 0 && <Zaehlung zaehlung={bericht.zaehlung} />}
        {bericht && bericht.uebersprungen > 0 && (
          <p className="spur-zeile-meta">{t('spur_uebersprungen', { count: bericht.uebersprungen })}</p>
        )}
        <ul className="spur-liste">
          {zeilen.map(zeile => (
            <BerichtZeile key={zeile.id} zeile={zeile} />
          ))}
        </ul>
      </div>
    </div>
  )
}
