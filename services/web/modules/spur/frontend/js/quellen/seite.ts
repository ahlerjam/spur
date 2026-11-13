import { useEffect, useState } from 'react'
import { anfrage, projektPfad } from '../api'

export type Seite = {
  text: string
  label: string | null
  seite: number
  seitenzahl: number
  ocrKonfidenz: number | null
}

// `seite` gehört immer zu `nummer`; `zuletzt` bleibt beim Blättern stehen, bis die neue Seite da ist.
export function useSeite(quelleId: string, nummer: number) {
  const [zuletzt, setZuletzt] = useState<Seite | null>(null)
  const [fehler, setFehler] = useState<string | null>(null)

  useEffect(() => {
    let aktuell = true
    setFehler(null)
    anfrage<Seite>(projektPfad(`/quellen/${quelleId}/seiten/${nummer}`))
      .then(s => aktuell && setZuletzt(s))
      .catch(e => aktuell && setFehler(e.message))
    return () => {
      aktuell = false
    }
  }, [quelleId, nummer])

  const seite = zuletzt?.seite === nummer ? zuletzt : null
  return { seite, zuletzt, fehler }
}
