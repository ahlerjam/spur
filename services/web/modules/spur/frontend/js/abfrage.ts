import { useCallback, useEffect, useState } from 'react'
import { anfrage } from './api'

const ABFRAGE_MS = 5000

// Lädt sofort und dann alle `takt` ms (Standard 5 s), solange der Tab sichtbar ist. Ein Ladefehler verschwindet mit
// der nächsten gelungenen Abfrage.
export function useAbfrage<T>(pfad: string, takt = ABFRAGE_MS) {
  const [daten, setDaten] = useState<T | null>(null)
  const [fehler, setFehler] = useState<string | null>(null)

  const laden = useCallback(async () => {
    try {
      setDaten(await anfrage<T>(pfad))
      setFehler(null)
    } catch (error) {
      setFehler((error as Error).message)
    }
  }, [pfad])

  useEffect(() => {
    laden()
    const intervall = setInterval(() => {
      if (!document.hidden) laden()
    }, takt)
    return () => clearInterval(intervall)
  }, [laden, takt])

  return { daten, fehler, setFehler, laden }
}
