import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import OLButton from '@/shared/components/ol/ol-button'
import OLFormControl from '@/shared/components/ol/ol-form-control'
import OLFormLabel from '@/shared/components/ol/ol-form-label'
import OLSpinner from '@/shared/components/ol/ol-spinner'
import {
  OLModal,
  OLModalBody,
  OLModalFooter,
  OLModalHeader,
  OLModalTitle,
} from '@/shared/components/ol/ol-modal'
import Notification from '@/shared/components/notification'
import { usePermissionsContext } from '@/features/ide-react/context/permissions-context'
import { anfrage, jsonAnfrage, projektPfad } from '../api'

type Spalte = { id: string; name: string }
type Zelle = { text: string; vorschlag: { text: string } | null }
type Zeile = { quelle: { id: string; dateiname: string; key: string }; zellen: Record<string, Zelle> }
type Matrix = { spalten: Spalte[]; zeilen: Zeile[]; gesamt: number; seite: number; proSeite: number }

function MatrixZelle({
  zeile,
  spalte,
  zelle,
  darfSchreiben,
  geaendert,
  fehler,
}: {
  zeile: Zeile
  spalte: Spalte
  zelle: Zelle
  darfSchreiben: boolean
  geaendert: () => void
  fehler: (text: string) => void
}) {
  const { t } = useTranslation()
  const [text, setText] = useState(zelle.text)
  useEffect(() => setText(zelle.text), [zelle.text])
  const adresse = { quelle_id: zeile.quelle.id, spalte_id: spalte.id }

  const senden = async (pfad: string, methode = 'POST', daten: object = adresse) => {
    try {
      await jsonAnfrage(methode, projektPfad(pfad), daten)
      geaendert()
    } catch (error) {
      fehler((error as Error).message)
    }
  }

  return (
    <td className="spur-matrix-zelle">
      <OLFormControl
        size="sm"
        value={text}
        readOnly={!darfSchreiben}
        aria-label={t('spur_zelle', { spalte: spalte.name, quelle: zeile.quelle.dateiname })}
        onChange={e => setText(e.target.value)}
        onBlur={() => {
          if (text !== zelle.text) senden('/matrix/zellen', 'PUT', { ...adresse, text })
        }}
      />
      {zelle.vorschlag && (
        <div className="spur-matrix-vorschlag">
          <p>
            <span className="spur-zeile-meta">{t('spur_vorschlag_claude')}</span> {zelle.vorschlag.text}
          </p>
          {darfSchreiben && (
            <div className="spur-paper-aktionen">
              <OLButton variant="primary" size="sm" onClick={() => senden('/matrix/zellen/bestaetigen')}>
                {t('spur_uebernehmen')}
              </OLButton>
              <OLButton variant="secondary" size="sm" onClick={() => senden('/matrix/zellen/verwerfen')}>
                {t('spur_verwerfen')}
              </OLButton>
            </div>
          )}
        </div>
      )}
    </td>
  )
}

export default function MatrixModal({ schliessen }: { schliessen: () => void }) {
  const { t } = useTranslation()
  const { write: darfSchreiben } = usePermissionsContext()
  const [matrix, setMatrix] = useState<Matrix | null>(null)
  const [seite, setSeite] = useState(1)
  const [fehler, setFehler] = useState<string | null>(null)
  const [neueSpalte, setNeueSpalte] = useState('')

  const laden = useCallback(async () => {
    try {
      setMatrix(await anfrage<Matrix>(projektPfad(`/matrix?seite=${seite}`)))
    } catch (error) {
      setFehler((error as Error).message)
    }
  }, [seite])

  useEffect(() => {
    laden()
  }, [laden])

  const spalteAnlegen = async () => {
    setFehler(null)
    try {
      await jsonAnfrage('POST', projektPfad('/matrix/spalten'), { name: neueSpalte })
      setNeueSpalte('')
      await laden()
    } catch (error) {
      setFehler((error as Error).message)
    }
  }

  const von = matrix && matrix.gesamt ? (matrix.seite - 1) * matrix.proSeite + 1 : 0
  const bis = matrix ? Math.min(matrix.gesamt, matrix.seite * matrix.proSeite) : 0

  return (
    <OLModal show onHide={schliessen} size="lg" fullscreen="md-down" dialogClassName="spur-matrix-dialog">
      <OLModalHeader>
        <OLModalTitle>{t('spur_literaturmatrix')}</OLModalTitle>
      </OLModalHeader>
      <OLModalBody>
        <div className="spur-paper-aktionen spur-matrix-werkzeuge">
          {darfSchreiben && (
            <form
              className="spur-recherche-suche"
              onSubmit={e => {
                e.preventDefault()
                if (neueSpalte.trim()) spalteAnlegen()
              }}
            >
              <OLFormLabel htmlFor="spur-neue-spalte" className="visually-hidden">
                {t('spur_neue_spalte')}
              </OLFormLabel>
              <OLFormControl
                id="spur-neue-spalte"
                size="sm"
                placeholder={t('spur_neue_spalte')}
                value={neueSpalte}
                onChange={e => setNeueSpalte(e.target.value)}
              />
              <OLButton type="submit" variant="secondary" size="sm" disabled={!neueSpalte.trim()}>
                {t('spur_spalte_hinzufuegen')}
              </OLButton>
            </form>
          )}
          <OLButton variant="secondary" size="sm" href={projektPfad('/matrix.csv')} download>
            {t('spur_matrix_exportieren')}
          </OLButton>
        </div>
        {fehler && <Notification type="error" content={fehler} />}
        {!matrix && !fehler && (
          <p className="spur-leer" role="status">
            <OLSpinner size="sm" /> {t('spur_matrix_laden')}
          </p>
        )}
        {matrix && matrix.gesamt === 0 && <p className="spur-leer">{t('spur_matrix_ohne_quellen')}</p>}
        {matrix && matrix.gesamt > 0 && (
          <>
            {matrix.spalten.length === 0 && <p className="spur-leer">{t('spur_matrix_ohne_spalten')}</p>}
            <div className="spur-matrix-rahmen">
              <table className="table table-sm spur-matrix">
                <caption>{t('spur_matrix_zeilen', { von, bis, gesamt: matrix.gesamt })}</caption>
                <thead>
                  <tr>
                    <th scope="col">{t('spur_quelle')}</th>
                    {matrix.spalten.map(s => (
                      <th scope="col" key={s.id}>
                        {s.name}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {matrix.zeilen.map(zeile => (
                    <tr key={zeile.quelle.id}>
                      <th scope="row">{zeile.quelle.dateiname}</th>
                      {matrix.spalten.map(s => (
                        <MatrixZelle
                          key={s.id}
                          zeile={zeile}
                          spalte={s}
                          zelle={zeile.zellen[s.id]}
                          darfSchreiben={darfSchreiben}
                          geaendert={laden}
                          fehler={setFehler}
                        />
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {matrix.gesamt > matrix.proSeite && (
              <nav className="spur-blaettern" aria-label={t('spur_matrix_seiten')}>
                <OLButton variant="secondary" size="sm" disabled={seite === 1} onClick={() => setSeite(seite - 1)}>
                  {t('spur_vorherige_seite')}
                </OLButton>
                <OLButton variant="secondary" size="sm" disabled={bis >= matrix.gesamt} onClick={() => setSeite(seite + 1)}>
                  {t('spur_naechste_seite')}
                </OLButton>
              </nav>
            )}
          </>
        )}
      </OLModalBody>
      <OLModalFooter>
        <OLButton variant="secondary" onClick={schliessen}>
          {t('spur_schliessen')}
        </OLButton>
      </OLModalFooter>
    </OLModal>
  )
}
