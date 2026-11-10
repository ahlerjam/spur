import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { anfrage, projektPfad } from '../api'

const GB = 1024 ** 3

// „x GB von y GB“ im Quellen-Panel, nur wenn für das Projekt eine Speicher-Grenze gilt. Lädt neu, wenn sich `stand`
// ändert (etwa die Zahl der Quellen).
export default function SpeicherAnzeige({ stand }: { stand: unknown }) {
  const { t, i18n } = useTranslation()
  const [werte, setWerte] = useState<{ bytes: number; grenze: number | null } | null>(null)

  useEffect(() => {
    anfrage<{ bytes: number; grenze: number | null }>(projektPfad('/speicher'))
      .then(setWerte)
      .catch(() => setWerte(null))
  }, [stand])

  if (!werte || werte.grenze === null) return null
  const gb = new Intl.NumberFormat(i18n.language, { maximumFractionDigits: 2 })
  return (
    <p className="spur-grenzen-anzeige spur-speicher-anzeige" role="status">
      {t('spur_speicher_von', { stand: gb.format(werte.bytes / GB), grenze: gb.format(werte.grenze / GB) })}
    </p>
  )
}
