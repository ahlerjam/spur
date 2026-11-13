import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import OLButton from '@/shared/components/ol/ol-button'
import LadeKnopf from '../lade-knopf'
import OLSpinner from '@/shared/components/ol/ol-spinner'
import OLFormLabel from '@/shared/components/ol/ol-form-label'
import OLFormSelect from '@/shared/components/ol/ol-form-select'
import {
  OLModal,
  OLModalBody,
  OLModalFooter,
  OLModalHeader,
  OLModalTitle,
} from '@/shared/components/ol/ol-modal'
import Notification from '@/shared/components/notification'
import { anfrage, ApiFehler, jsonAnfrage, projektPfad } from '../api'

type Sammlung = { key: string; name: string }
type ZoteroErgebnis = { neu: string[]; vorhanden: string[] }
type DateiStatus = { name: string; zustand: 'laeuft' | 'ok' | 'vorhanden' | 'fehler'; text?: string }

const MAX_BYTES = 50 * 1024 * 1024

export default function ImportModal({
  schliessen,
  importiert,
}: {
  schliessen: () => void
  importiert: () => void
}) {
  const { t } = useTranslation()
  const [sammlungen, setSammlungen] = useState<Sammlung[] | null>(null)
  const [sammlung, setSammlung] = useState('')
  const [zoteroFehler, setZoteroFehler] = useState<string | null>(null)
  const [zotero, setZotero] = useState<ZoteroErgebnis | null>(null)
  const [laeuft, setLaeuft] = useState(false)
  const [dateien, setDateien] = useState<DateiStatus[]>([])
  const [nachfragen, setNachfragen] = useState(false)
  const laedtHoch = dateien.some(d => d.zustand === 'laeuft')
  // Während eines Uploads fragt Schließen nach: Die übrigen Dateien kämen sonst nicht mehr an.
  const zu = () => (laedtHoch ? setNachfragen(true) : schliessen())

  useEffect(() => {
    anfrage<{ sammlungen: Sammlung[] }>(projektPfad('/import/zotero'))
      .then(antwort => {
        setSammlungen(antwort.sammlungen)
        setSammlung(antwort.sammlungen[0]?.key ?? '')
      })
      .catch(error => setZoteroFehler(error.message))
  }, [])

  const zoteroImportieren = async () => {
    setLaeuft(true)
    setZoteroFehler(null)
    try {
      setZotero(await jsonAnfrage<ZoteroErgebnis>('POST', projektPfad('/import/zotero'), { sammlung }))
      importiert()
    } catch (error) {
      setZoteroFehler((error as Error).message)
    } finally {
      setLaeuft(false)
    }
  }

  const setzen = (i: number, status: Omit<DateiStatus, 'name'>) =>
    setDateien(alt => alt.map((d, j) => (j === i ? { ...d, ...status } : d)))

  // Nacheinander hochladen: Jede Datei bekommt ihren eigenen Status, ein Fehler hält die übrigen nicht auf.
  const ordnerImportieren = async (liste: FileList | null) => {
    const auswahl = Array.from(liste ?? [])
    if (!auswahl.length) return
    setDateien(auswahl.map(d => ({ name: d.name, zustand: 'laeuft' })))
    for (const [i, datei] of auswahl.entries()) {
      if (datei.size > MAX_BYTES) {
        setzen(i, { zustand: 'fehler', text: t('spur_datei_zu_gross') })
        continue
      }
      const formular = new FormData()
      formular.append('datei', datei)
      try {
        await anfrage(projektPfad('/quellen'), { method: 'POST', body: formular })
        setzen(i, { zustand: 'ok' })
      } catch (error) {
        const vorhanden = error instanceof ApiFehler && error.status === 409
        setzen(i, { zustand: vorhanden ? 'vorhanden' : 'fehler', text: (error as Error).message })
      }
    }
    importiert()
  }

  const statusText = (d: DateiStatus) =>
    d.zustand === 'laeuft'
      ? t('spur_import_laeuft')
      : d.zustand === 'ok'
        ? t('spur_import_ok')
        : d.zustand === 'vorhanden'
          ? t('spur_schon_vorhanden')
          : d.text

  return (
    <OLModal themed show onHide={zu}>
      <OLModalHeader>
        <OLModalTitle>{t('spur_bestand_importieren')}</OLModalTitle>
      </OLModalHeader>
      <OLModalBody>
        <section className="spur-import-teil" aria-labelledby="spur-import-zotero">
          <h3 id="spur-import-zotero" className="spur-import-titel">{t('spur_aus_zotero')}</h3>
          {zoteroFehler && <Notification type="error" content={zoteroFehler} />}
          {sammlungen === null && !zoteroFehler && (
            <p className="spur-zeile-meta" role="status">
              <OLSpinner size="sm" /> {t('spur_sammlungen_laden')}
            </p>
          )}
          {sammlungen && sammlungen.length === 0 && <p>{t('spur_keine_sammlungen')}</p>}
          {sammlungen && sammlungen.length > 0 && (
            <>
              <OLFormLabel htmlFor="spur-zotero-sammlung">{t('spur_sammlung')}</OLFormLabel>
              <div className="spur-recherche-suche">
                <OLFormSelect id="spur-zotero-sammlung" value={sammlung} onChange={e => setSammlung(e.target.value)}>
                  {sammlungen.map(s => (
                    <option key={s.key} value={s.key}>
                      {s.name}
                    </option>
                  ))}
                </OLFormSelect>
                <LadeKnopf variant="primary" isLoading={laeuft} disabled={!sammlung} onClick={zoteroImportieren}>
                  {t('spur_aus_zotero_importieren')}
                </LadeKnopf>
              </div>
            </>
          )}
          {zotero && (
            <div role="status">
              <p>{t('spur_zotero_ergebnis', { neu: zotero.neu.length, vorhanden: zotero.vorhanden.length })}</p>
              <ul className="spur-import-liste">
                {zotero.neu.map(key => (
                  <li key={key}>
                    <code>{key}</code> · <span>{t('spur_neu_in_bib')}</span>
                  </li>
                ))}
                {zotero.vorhanden.map(key => (
                  <li key={key}>
                    <code>{key}</code> · <span>{t('spur_schon_vorhanden')}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
        <section className="spur-import-teil" aria-labelledby="spur-import-ordner">
          <h3 id="spur-import-ordner" className="spur-import-titel">{t('spur_aus_ordner')}</h3>
          <OLFormLabel htmlFor="spur-import-dateien">{t('spur_pdfs_waehlen')}</OLFormLabel>
          <input
            id="spur-import-dateien"
            className="form-control"
            type="file"
            multiple
            accept=".pdf,.vtt"
            onChange={e => ordnerImportieren(e.target.files)}
          />
          {dateien.length > 0 && (
            <ul className="spur-import-liste" aria-live="polite">
              {/* Zwei Dateien können gleich heißen: Jede Zeile gehört zu ihrer Position in der Auswahl. */}
              {dateien.map((d, i) => (
                <li key={i} className={d.zustand === 'fehler' ? 'spur-import-fehler' : undefined}>
                  <span className="spur-import-name">{d.name}</span> · <span>{statusText(d)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </OLModalBody>
      <OLModalFooter>
        {nachfragen && laedtHoch ? (
          <>
            <p className="spur-import-frage" role="alert">
              {t('spur_import_schliessen_frage')}
            </p>
            <OLButton variant="secondary" onClick={() => setNachfragen(false)}>
              {t('spur_weiter_hochladen')}
            </OLButton>
            <OLButton variant="danger" onClick={schliessen}>
              {t('spur_trotzdem_schliessen')}
            </OLButton>
          </>
        ) : (
          <OLButton variant="secondary" onClick={zu}>
            {t('close')}
          </OLButton>
        )}
      </OLModalFooter>
    </OLModal>
  )
}
