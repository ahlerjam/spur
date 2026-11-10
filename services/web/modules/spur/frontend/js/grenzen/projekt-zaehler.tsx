import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { anfrage } from '../api'

// „x von y Projekten“ in der Projektliste, nur wenn eine Grenze gilt. `stand` ändert sich, wenn Projekte dazukommen
// oder endgültig gelöscht werden; dann neu laden.
export default function ProjektZaehler({ stand }: { stand: number }) {
  const { t } = useTranslation()
  const [werte, setWerte] = useState<{ anzahl: number; grenze: number | null } | null>(null)

  useEffect(() => {
    anfrage<{ anzahl: number; grenze: number | null }>('/spur/grenzen/projekte')
      .then(setWerte)
      .catch(() => setWerte(null))
  }, [stand])

  if (!werte || werte.grenze === null) return null
  return (
    <p className="spur-grenzen-anzeige mb-0" role="status">
      {t('spur_projekte_von', { anzahl: werte.anzahl, grenze: werte.grenze })}
    </p>
  )
}
