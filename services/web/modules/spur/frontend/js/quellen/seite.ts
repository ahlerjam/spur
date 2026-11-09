import { useEffect, useState } from 'react'
import { anfrage, projektPfad } from '../api'

export type Seite = {
  text: string
  label: string | null
  seite: number
  seitenzahl: number
  ocrKonfidenz: number | null
}

export function useSeite(quelleId: string, nummer: number) {
  const [seite, setSeite] = useState<Seite | null>(null)
  const [fehler, setFehler] = useState<string | null>(null)

  useEffect(() => {
    let aktuell = true
    setSeite(null)
    setFehler(null)
    anfrage<Seite>(projektPfad(`/quellen/${quelleId}/seiten/${nummer}`))
      .then(s => aktuell && setSeite(s))
      .catch(e => aktuell && setFehler(e.message))
    return () => {
      aktuell = false
    }
  }, [quelleId, nummer])

  return { seite, fehler }
}
