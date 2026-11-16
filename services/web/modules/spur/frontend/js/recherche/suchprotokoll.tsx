import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import OLButton from '@/shared/components/ol/ol-button'
import OLSpinner from '@/shared/components/ol/ol-spinner'
import Notification from '@/shared/components/notification'
import { anfrage, projektPfad } from '../api'

type DienstStand = {
  dienst: string
  status: 'geantwortet' | 'gedrosselt' | 'nicht_erreichbar'
  treffer: number
  versuche?: number
}
type Eintrag = {
  zeit: string
  anfrage: string
  seite: number
  dienste: DienstStand[]
  treffer: number
  // null bei Einträgen von vor P12: Sie kennen ihre Treffer nicht einzeln.
  dubletten: number | null
}
type Prisma = {
  identifiziert: number
  dubletten: number
  gesichtet: number
  aufgenommen: number
  ausgeschlossen: { gesamt: number; nach_grund: Record<string, number> }
  nicht_beschaffbar: Record<string, number>
  offen: number
}
type Seite = { eintraege: Eintrag[]; gesamt: number; weiter: boolean; prisma: Prisma }

const datumText = (iso: string) =>
  new Date(iso).toLocaleString('de-DE', { dateStyle: 'medium', timeStyle: 'short' })

const summe = (zahlen: Record<string, number>) => Object.values(zahlen).reduce((a, b) => a + b, 0)

function Summen({ prisma }: { prisma: Prisma }) {
  const { t } = useTranslation()
  const teile = [
    t('spur_prisma_identifiziert', { count: prisma.identifiziert }),
    t('spur_prisma_dubletten', { count: prisma.dubletten }),
    t('spur_prisma_gesichtet', { count: prisma.gesichtet }),
    t('spur_prisma_aufgenommen', { count: prisma.aufgenommen }),
    t('spur_prisma_ausgeschlossen', { count: prisma.ausgeschlossen.gesamt }),
    t('spur_prisma_nicht_beschaffbar', { count: summe(prisma.nicht_beschaffbar) }),
    t('spur_prisma_offen', { count: prisma.offen }),
  ]
  const gruende = Object.entries(prisma.ausgeschlossen.nach_grund)
  const hindernisse = Object.entries(prisma.nicht_beschaffbar)
  return (
    <div className="spur-prisma">
      <p className="spur-prisma-zeile">{teile.join(', ')}</p>
      {gruende.length > 0 && (
        <p className="spur-zeile-meta">
          {t('spur_prisma_ausgeschlossen_gruende')} {gruende.map(([grund, n]) => `${grund} (${n})`).join(', ')}
        </p>
      )}
      {hindernisse.length > 0 && (
        <p className="spur-zeile-meta">
          {t('spur_prisma_nicht_beschaffbar_gruende')}{' '}
          {hindernisse.map(([grund, n]) => `${t(`spur_prisma_grund_${grund}`)} (${n})`).join(', ')}
        </p>
      )}
    </div>
  )
}

function DienstZeile({ stand }: { stand: DienstStand }) {
  const { t } = useTranslation()
  return (
    <li>
      {stand.dienst}:{' '}
      {stand.status === 'geantwortet'
        ? t('spur_treffer_anzahl', { count: stand.treffer })
        : t(stand.status === 'gedrosselt' ? 'spur_dienst_gedrosselt' : 'spur_dienst_nicht_erreichbar')}
      {(stand.versuche ?? 0) > 1 && ` · ${t('spur_versuche', { count: stand.versuche })}`}
    </li>
  )
}

export default function Suchprotokoll() {
  const { t } = useTranslation()
  const [eintraege, setEintraege] = useState<Eintrag[] | null>(null)
  const [prisma, setPrisma] = useState<Prisma | null>(null)
  const [weiter, setWeiter] = useState(false)
  const [seite, setSeite] = useState(0)
  const [fehler, setFehler] = useState<string | null>(null)

  const laden = useCallback(async (nummer: number) => {
    setFehler(null)
    try {
      const antwort = await anfrage<Seite>(projektPfad(`/recherche/protokoll?seite=${nummer}`))
      setEintraege(alt => (nummer === 0 ? antwort.eintraege : [...(alt ?? []), ...antwort.eintraege]))
      setPrisma(antwort.prisma)
      setWeiter(antwort.weiter)
      setSeite(nummer)
    } catch (error) {
      setFehler((error as Error).message)
    }
  }, [])

  useEffect(() => {
    laden(0)
  }, [laden])

  return (
    <>
      <div className="spur-panel-werkzeuge">
        <OLButton
          variant="secondary"
          size="sm"
          href={projektPfad('/recherche/protokoll.csv')}
          download
          disabled={!eintraege?.length}
        >
          {t('spur_protokoll_exportieren')}
        </OLButton>
      </div>
      <div className="spur-panel-inhalt">
        {fehler && <Notification type="error" content={fehler} />}
        {!eintraege && !fehler && (
          <p className="spur-leer" role="status">
            <OLSpinner size="sm" /> {t('spur_protokoll_laden')}
          </p>
        )}
        {eintraege?.length === 0 && <p className="spur-leer">{t('spur_protokoll_leer')}</p>}
        {eintraege && eintraege.length > 0 && (
          <>
            {prisma && <Summen prisma={prisma} />}
            <ul className="spur-liste spur-protokoll">
              {eintraege.map((e, i) => (
                <li key={`${e.zeit}-${e.seite}-${i}`} className="spur-zeile">
                  <p className="spur-paper-titel">{e.anfrage}</p>
                  <p className="spur-zeile-meta">
                    {t('spur_protokoll_seite', { seite: e.seite + 1 })} · {t('spur_treffer_anzahl', { count: e.treffer })}
                    {e.dubletten !== null && ` · ${t('spur_prisma_dubletten', { count: e.dubletten })}`} ·{' '}
                    <time dateTime={e.zeit}>{datumText(e.zeit)}</time>
                  </p>
                  <ul className="spur-protokoll-dienste">
                    {e.dienste.map(stand => (
                      <DienstZeile key={stand.dienst} stand={stand} />
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          </>
        )}
        {weiter && (
          <OLButton variant="secondary" size="sm" onClick={() => laden(seite + 1)}>
            {t('spur_weitere_eintraege')}
          </OLButton>
        )}
      </div>
    </>
  )
}
