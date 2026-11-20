// Über dem Log im Editor: je Datei, die LaTeX nicht gefunden hat, das TeX-Live-Paket dazu (pdfLogEntriesComponents).
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useDetachCompileContext } from '@/shared/context/detach-compile-context'
import { fehlendeDateien } from '../../../app/src/kompilieren/fehlendeDateien.mjs'
import { anfrage, projektPfad } from '../api'

type Eintrag = { datei: string; paket: string | null }

export function FehlendePaketeZeilen({ rawLog }: { rawLog?: string }) {
  const { t } = useTranslation()
  const schluessel = useMemo(() => fehlendeDateien(rawLog ?? '').join('\n'), [rawLog])
  const [eintraege, setEintraege] = useState<Eintrag[]>([])

  useEffect(() => {
    const dateien = schluessel ? schluessel.split('\n') : []
    // Bis der Server antwortet (oder wenn er es nicht tut) stehen die Dateien ohne Paket da.
    setEintraege(dateien.map(datei => ({ datei, paket: null })))
    if (!dateien.length) return
    let aktuell = true
    const suche = new URLSearchParams(dateien.map(datei => ['datei', datei]))
    anfrage<{ fehlende_pakete: Eintrag[] }>(projektPfad(`/tex-pakete/fehlend?${suche}`))
      .then(antwort => aktuell && setEintraege(antwort.fehlende_pakete))
      .catch(() => {})
    return () => {
      aktuell = false
    }
  }, [schluessel])

  if (!eintraege.length) return null
  return (
    <ul className="spur-fehlende-pakete">
      {eintraege.map(({ datei, paket }) => (
        <li key={datei}>
          {paket ? t('spur_tex_fehlendes_paket', { paket, datei }) : t('spur_tex_fehlende_datei', { datei })}
        </li>
      ))}
    </ul>
  )
}

export default function FehlendePakete() {
  const { rawLog } = useDetachCompileContext()
  return <FehlendePaketeZeilen rawLog={rawLog} />
}
