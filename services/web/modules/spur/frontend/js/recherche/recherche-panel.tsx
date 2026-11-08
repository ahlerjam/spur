import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import RailPanelHeader from '@/features/ide-react/components/rail/rail-panel-header'
import OLButton from '@/shared/components/ol/ol-button'
import OLFormControl from '@/shared/components/ol/ol-form-control'
import OLSpinner from '@/shared/components/ol/ol-spinner'
import Notification from '@/shared/components/notification'
import { usePermissionsContext } from '@/features/ide-react/context/permissions-context'
import { anfrage, ApiFehler, jsonAnfrage, projektPfad } from '../api'
import { pruefenVerzoegert } from '../pruefung/pruef-store'
import PaperEintrag from './paper-treffer'
import Beschaffung from './beschaffung'
import Suchprotokoll from './suchprotokoll'
import Zitationen from './zitationen'
import type { PaperTreffer, SuchErgebnis } from './typen'

type Ansicht = 'treffer' | 'protokoll' | 'beschaffung'
const ANSICHTEN: { id: Ansicht; titel: string }[] = [
  { id: 'treffer', titel: 'spur_treffer_reiter' },
  { id: 'protokoll', titel: 'spur_suchprotokoll' },
  { id: 'beschaffung', titel: 'spur_beschaffung' },
]

export default function RecherchePanel() {
  const { t } = useTranslation()
  const [begriff, setBegriff] = useState('')
  const [ergebnis, setErgebnis] = useState<SuchErgebnis | null>(null)
  const [laedt, setLaedt] = useState(false)
  const [fehler, setFehler] = useState<string | null>(null)
  const [ansicht, setAnsicht] = useState<Ansicht>('treffer')
  const { write: darfSchreiben } = usePermissionsContext()
  const [meldungen, setMeldungen] = useState<Record<string, { typ: 'success' | 'info' | 'error'; text: string }>>({})
  const [arbeitet, setArbeitet] = useState<string | null>(null)

  const aktion = async (treffer: PaperTreffer, ziel: 'aufnehmen' | 'beschaffen') => {
    const doi = treffer.doi!
    setArbeitet(doi)
    try {
      if (ziel === 'aufnehmen') {
        const quelle = await jsonAnfrage<{ key: string }>('POST', projektPfad('/recherche/aufnehmen'), { doi })
        setMeldungen(alt => ({ ...alt, [doi]: { typ: 'success', text: t('spur_aufgenommen', { key: quelle.key }) } }))
        pruefenVerzoegert()
      } else {
        await jsonAnfrage('POST', projektPfad('/beschaffung'), { doi })
        setMeldungen(alt => ({ ...alt, [doi]: { typ: 'success', text: t('spur_auf_liste_gesetzt') } }))
      }
    } catch (error) {
      const vorhanden = error instanceof ApiFehler && error.status === 409
      setMeldungen(alt => ({ ...alt, [doi]: { typ: vorhanden ? 'info' : 'error', text: (error as Error).message } }))
    } finally {
      setArbeitet(null)
    }
  }

  const suchen = async (seite: number) => {
    setFehler(null)
    setAnsicht('treffer')
    setLaedt(true)
    try {
      const parameter = new URLSearchParams({ anfrage: begriff.trim(), seite: String(seite) })
      setErgebnis(await anfrage<SuchErgebnis>(projektPfad(`/recherche?${parameter}`)))
    } catch (error) {
      setFehler((error as Error).message)
    } finally {
      setLaedt(false)
    }
  }

  return (
    <div className="spur-panel">
      <RailPanelHeader title={t('spur_recherche')} />
      <form
        className="spur-suche spur-recherche-suche"
        role="search"
        onSubmit={e => {
          e.preventDefault()
          if (begriff.trim()) suchen(0)
        }}
      >
        <OLFormControl
          type="search"
          size="sm"
          aria-label={t('spur_paper_suchen')}
          placeholder={t('spur_paper_suchen')}
          value={begriff}
          onChange={e => setBegriff(e.target.value)}
        />
        <OLButton type="submit" variant="primary" size="sm" disabled={!begriff.trim() || laedt}>
          {t('spur_suchen')}
        </OLButton>
      </form>
      <div className="spur-reiter" role="tablist" aria-label={t('spur_recherche_ansicht')}>
        {ANSICHTEN.map(a => (
          <button
            key={a.id}
            type="button"
            role="tab"
            className="spur-reiter-knopf"
            aria-selected={ansicht === a.id}
            onClick={() => setAnsicht(a.id)}
          >
            {t(a.titel)}
          </button>
        ))}
      </div>
      {ansicht === 'protokoll' && <Suchprotokoll />}
      {ansicht === 'beschaffung' && <Beschaffung />}
      {ansicht === 'treffer' && (
      <div className="spur-panel-inhalt" aria-busy={laedt}>
        {fehler && <Notification type="error" content={fehler} />}
        {laedt && (
          <p className="spur-leer" role="status">
            <OLSpinner size="sm" /> {t('spur_suche_laeuft')}
          </p>
        )}
        {!laedt && !ergebnis && !fehler && <p className="spur-leer">{t('spur_recherche_leer')}</p>}
        {!laedt && ergebnis && (
          <>
            {ergebnis.fehler.map(f => (
              <Notification key={f.dienst} type="warning" content={f.text} />
            ))}
            {ergebnis.hinweise.map(h => (
              <Notification key={h} type="info" content={h} />
            ))}
            {ergebnis.treffer.length === 0 ? (
              <p className="spur-leer">{t('spur_keine_treffer')}</p>
            ) : (
              <ul className="spur-liste">
                {ergebnis.treffer.map(treffer => (
                  <PaperEintrag key={treffer.doi ?? treffer.titel} treffer={treffer}>
                    {treffer.doi && (
                      <div className="spur-paper-aktionen">
                        {darfSchreiben && treffer.frei && (
                          <OLButton
                            variant="primary"
                            size="sm"
                            isLoading={arbeitet === treffer.doi}
                            loadingLabel={t('spur_wird_aufgenommen')}
                            onClick={() => aktion(treffer, 'aufnehmen')}
                          >
                            {t('spur_aufnehmen')}
                          </OLButton>
                        )}
                        {darfSchreiben && treffer.frei !== true && (
                          <OLButton
                            variant="secondary"
                            size="sm"
                            isLoading={arbeitet === treffer.doi}
                            loadingLabel={t('spur_wird_gesetzt')}
                            onClick={() => aktion(treffer, 'beschaffen')}
                          >
                            {t('spur_auf_beschaffungsliste')}
                          </OLButton>
                        )}
                        <Zitationen doi={treffer.doi} />
                      </div>
                    )}
                    {treffer.doi && meldungen[treffer.doi] && (
                      <div role="status">
                        <Notification type={meldungen[treffer.doi].typ} content={meldungen[treffer.doi].text} />
                      </div>
                    )}
                  </PaperEintrag>
                ))}
              </ul>
            )}
            {(ergebnis.seite > 0 || ergebnis.weiter) && (
              <nav className="spur-blaettern" aria-label={t('spur_trefferseiten')}>
                <OLButton
                  variant="secondary"
                  size="sm"
                  disabled={ergebnis.seite === 0}
                  onClick={() => suchen(ergebnis.seite - 1)}
                >
                  {t('spur_vorherige_seite')}
                </OLButton>
                <span>{t('spur_seite_n', { n: ergebnis.seite + 1 })}</span>
                <OLButton
                  variant="secondary"
                  size="sm"
                  disabled={!ergebnis.weiter}
                  onClick={() => suchen(ergebnis.seite + 1)}
                >
                  {t('spur_naechste_seite')}
                </OLButton>
              </nav>
            )}
          </>
        )}
      </div>
      )}
    </div>
  )
}
