import { useCallback, useEffect, useState } from 'react'
import { anfrage } from './api'

const ABFRAGE_MS = 5000

// Lädt sofort und dann alle 5 s, solange der Tab sichtbar ist.
export function useAbfrage<T>(pfad: string) {
  const [daten, setDaten] = useState<T | null>(null)
  const [fehler, setFehler] = useState<string | null>(null)

  const laden = useCallback(async () => {
    try {
      setDaten(await anfrage<T>(pfad))
    } catch (error) {
      setFehler((error as Error).message)
    }
  }, [pfad])

  useEffect(() => {
    laden()
    const takt = setInterval(() => {
      if (!document.hidden) laden()
    }, ABFRAGE_MS)
    return () => clearInterval(takt)
  }, [laden])

  return { daten, fehler, setFehler, laden }
}
