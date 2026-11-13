import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { useTranslation } from 'react-i18next'
import RailPanelHeader from '@/features/ide-react/components/rail/rail-panel-header'
import { useEditorManagerContext } from '@/features/ide-react/context/editor-manager-context'
import OLBadge from '@/shared/components/ol/ol-badge'
import OLButton from '@/shared/components/ol/ol-button'
import OLToggleButton from '@/shared/components/ol/ol-toggle-button'
import OLToggleButtonGroup from '@/shared/components/ol/ol-toggle-button-group'
import OLSpinner from '@/shared/components/ol/ol-spinner'
import MaterialIcon from '@/shared/components/material-icon'
import Notification from '@/shared/components/notification'
import { befunde } from './befunde'
import PruefEinstellungen from './pruef-einstellungen'
import { type Bericht, pruefen, pruefenWennNoetig, pruefStore, STELLEN_STATUS, Zeile } from './pruef-store'

const FILTER = {
  alle: () => true,
  markiert: (z: Zeile) => z.problem,
  ohne_quelle: (z: Zeile) => z.status === 'ohne_quelle',
  nicht_pruefbar: (z: Zeile) => z.status === 'nicht_pruefbar',
}
type Filter = keyof typeof FILTER

function Gruppe({ pfad, zeilen }: { pfad: string; zeilen: Zeile[] }) {
  const { t } = useTranslation()
  const [offen, setOffen] = useState(true)
  const id = `spur-gruppe-${pfad.replace(/[^\w-]/g, '_')}`
  return (
    <section className="spur-gruppe">
      <h5 className="spur-gruppe-kopf">
        <button type="button" aria-expanded={offen} aria-controls={id} onClick={() => setOffen(!offen)}>
          <MaterialIcon type={offen ? 'expand_more' : 'chevron_right'} />
          <span className="spur-gruppe-name">{pfad}</span>
          <span className="spur-zeile-meta">
            {t('spur_gruppe_zahl', { count: zeilen.length, markiert: zeilen.filter(z => z.problem).length })}
          </span>
        </button>
      </h5>
      {offen && (
        <ul className="spur-liste" id={id}>
          {zeilen.map(zeile => (
            <BerichtZeile key={zeile.id} zeile={zeile} />
          ))}
        </ul>
      )}
    </section>
  )
}

function Zeitpunkt({ am }: { am: number | null }) {
  const { t, i18n } = useTranslation()
  if (!am) return null
  const datum = new Date(am)
  const uhrzeit = datum.toLocaleTimeString(i18n.language, { hour: '2-digit', minute: '2-digit' })
  const heute = datum.toDateString() === new Date().toDateString()
  const zeit = heute ? t('spur_heute_um', { uhrzeit }) : `${datum.toLocaleDateString(i18n.language)}, ${uhrzeit}`
  return <p className="spur-zeile-meta spur-zeitpunkt">{t('spur_zuletzt_geprueft', { zeit })}</p>
}

function BerichtZeile({ zeile }: { zeile: Zeile }) {
  const { t } = useTranslation()
  const { openDocWithId } = useEditorManagerContext()
  const badges = befunde(zeile, t)
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
  const [filter, setFilter] = useState<Filter>('alle')
  const { bericht, status, fehler, geprueftAm } = zustand

  useEffect(() => {
    pruefenWennNoetig()
  }, [])

  const alleZeilen = useMemo(() => bericht?.zeilen ?? [], [bericht])
  const gruppen = useMemo(() => {
    const nachDatei = new Map<string, Zeile[]>()
    for (const zeile of alleZeilen.filter(FILTER[filter])) {
      nachDatei.set(zeile.pfad, [...(nachDatei.get(zeile.pfad) ?? []), zeile])
    }
    return [...nachDatei]
  }, [alleZeilen, filter])

  return (
    <div className="spur-panel">
      <RailPanelHeader title={t('spur_pruefbericht')} />
      <div className="spur-panel-werkzeuge">
        <OLButton variant="secondary" size="sm" onClick={pruefen}>
          {t('spur_erneut_pruefen')}
        </OLButton>
        <PruefEinstellungen />
        <Zeitpunkt am={geprueftAm} />
      </div>
      {bericht && bericht.zeilen.length > 0 && (
        <div className="spur-filter">
          <OLToggleButtonGroup
            type="radio"
            name="spur-bericht-filter"
            size="sm"
            value={filter}
            onChange={(wert: Filter) => setFilter(wert)}
            aria-label={t('spur_bericht_filtern')}
          >
            {(Object.keys(FILTER) as Filter[]).map(art => (
              <OLToggleButton key={art} id={`spur-filter-${art}`} variant="secondary" value={art}>
                {t(`spur_filter_${art}`)} <span className="spur-filter-zahl">{alleZeilen.filter(FILTER[art]).length}</span>
              </OLToggleButton>
            ))}
          </OLToggleButtonGroup>
        </div>
      )}
      <div className="spur-panel-inhalt">
        <div role="status">
          {status === 'laeuft' && (
            <p className="spur-zeile-meta">
              <OLSpinner size="sm" /> {t('spur_pruefung_laeuft')}
            </p>
          )}
        </div>
        {status === 'fehler' && (
          <Notification
            type="error"
            content={t('spur_pruefung_fehler', { grund: fehler })}
          />
        )}
        {bericht?.zeilen.length === 0 && status !== 'fehler' && (
          <p className="spur-leer">{t('spur_keine_zitate')}</p>
        )}
        {bericht && bericht.zeilen.length > 0 && <Zaehlung zaehlung={bericht.zaehlung} />}
        {bericht && bericht.uebersprungen > 0 && (
          <p className="spur-zeile-meta">{t('spur_uebersprungen', { count: bericht.uebersprungen })}</p>
        )}
        {bericht && bericht.zeilen.length > 0 && gruppen.length === 0 && (
          <p className="spur-leer">{t('spur_filter_leer')}</p>
        )}
        {gruppen.map(([pfad, zeilen]) => (
          <Gruppe key={pfad} pfad={pfad} zeilen={zeilen} />
        ))}
      </div>
    </div>
  )
}
