import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import OLIconButton from '@/shared/components/ol/ol-icon-button'
import type { Seite } from './seite'
import type { Quelle } from './typen'

export function Seitenangabe({
  quelle,
  nummer,
  seite,
}: {
  quelle: Quelle
  nummer: number
  seite: Seite | null
}) {
  const { t } = useTranslation()
  return (
    <span className="spur-seitenzahl" aria-live="polite">
      {seite?.label && quelle.art === 'pdf'
        ? t('spur_seite_label_von', { seite: seite.label, nr: nummer, gesamt: quelle.seitenzahl })
        : t('spur_seite_von', { seite: nummer, gesamt: quelle.seitenzahl })}
    </span>
  )
}

export function SeitenBlaettern({
  quelle,
  nummer,
  setNummer,
  children,
}: {
  quelle: Quelle
  nummer: number
  setNummer: (nummer: number) => void
  children: ReactNode
}) {
  const { t } = useTranslation()
  return (
    <div className="spur-blaettern">
      {children}
      <OLIconButton
        variant="ghost"
        size="sm"
        icon="chevron_left"
        accessibilityLabel={t('spur_vorherige_seite')}
        disabled={nummer <= 1}
        onClick={() => setNummer(nummer - 1)}
      />
      <OLIconButton
        variant="ghost"
        size="sm"
        icon="chevron_right"
        accessibilityLabel={t('spur_naechste_seite')}
        disabled={nummer >= quelle.seitenzahl}
        onClick={() => setNummer(nummer + 1)}
      />
    </div>
  )
}
