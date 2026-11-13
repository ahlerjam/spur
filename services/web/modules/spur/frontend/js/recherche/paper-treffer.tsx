import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import OLBadge from '@/shared/components/ol/ol-badge'
import type { PaperTreffer } from './typen'

const MAX_AUTOREN = 3

export function autorenText(autoren: string[], ohne: string) {
  if (!autoren.length) return ohne
  const erste = autoren.slice(0, MAX_AUTOREN).join(', ')
  return autoren.length > MAX_AUTOREN ? `${erste} u. a.` : erste
}

export default function PaperEintrag({
  treffer,
  children,
}: {
  treffer: PaperTreffer
  children?: ReactNode
}) {
  const { t } = useTranslation()
  return (
    <li className="spur-zeile spur-paper">
      <p className="spur-paper-titel">{treffer.titel ?? treffer.doi}</p>
      <p className="spur-zeile-meta">
        {autorenText(treffer.autoren, t('spur_ohne_autoren'))}
        {treffer.jahr && ` · ${treffer.jahr}`}
      </p>
      <p className="spur-zeile-meta">
        {t('spur_gefunden_ueber', { dienste: treffer.dienste.join(', ') })}
        {treffer.frei === true && (
          <OLBadge bg="success" className="spur-paper-badge">
            {t('spur_open_access')}
          </OLBadge>
        )}
        {treffer.frei === false && (
          <OLBadge bg="light" text="dark" className="spur-paper-badge">
            {t('spur_nicht_frei')}
          </OLBadge>
        )}
      </p>
      {treffer.doi && (
        <p className="spur-zeile-meta spur-paper-doi">
          <a href={`https://doi.org/${treffer.doi}`} target="_blank" rel="noopener noreferrer">
            {treffer.doi}
          </a>
        </p>
      )}
      {children}
    </li>
  )
}
