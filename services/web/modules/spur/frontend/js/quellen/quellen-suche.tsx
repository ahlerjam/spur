import { useTranslation } from 'react-i18next'
import OLButton from '@/shared/components/ol/ol-button'
import type { Treffer } from './typen'

export default function QuellenSuche({
  treffer,
  oeffnen,
}: {
  treffer: Treffer[]
  oeffnen: (treffer: Treffer) => void
}) {
  const { t } = useTranslation()
  if (treffer.length === 0) {
    return <p className="spur-leer">{t('spur_keine_treffer')}</p>
  }
  return (
    <ul className="spur-liste">
      {treffer.map(eintrag => (
        <li className="spur-zeile" key={`${eintrag.quelleId}-${eintrag.imDateinamen ? 'name' : eintrag.seite}`}>
          <OLButton
            variant="link"
            size="sm"
            className="spur-zeile-link"
            onClick={() => oeffnen(eintrag)}
          >
            {eintrag.dateiname}
          </OLButton>
          <p className="spur-zeile-meta">
            {eintrag.imDateinamen
              ? t('spur_treffer_dateiname')
              : eintrag.art === 'vtt'
                ? eintrag.label
                : eintrag.art === 'web'
                  ? t('spur_webseite')
                : t('spur_seite_kurz', { seite: eintrag.label ?? eintrag.seite })}
          </p>
          {eintrag.auszug && <p className="spur-zeile-auszug">{eintrag.auszug}</p>}
        </li>
      ))}
    </ul>
  )
}
