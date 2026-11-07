import { anfrage, projektPfad } from '../api'

export type Zeile = {
  id: string
  docId: string
  pfad: string
  zeile: number
  form: string
  key: string | null
  auszug: string
  zitatVon: number
  zitatBis: number
  wortlaut: string | null
  seite: string | null
  gefundenAuf?: string
  referenz?: string
  retraction?: string | null
  problem: boolean
}

export type Bericht = {
  zeilen: Zeile[]
  statistik: { geprueft: number; wiederverwendet: number }
}

export type PruefZustand = {
  status: 'bereit' | 'laeuft' | 'fertig' | 'fehler'
  bericht: Bericht | null
  fehler: string | null
}

const WARTEZEIT_MS = 2500

let zustand: PruefZustand = { status: 'bereit', bericht: null, fehler: null }
const hoerer = new Set<() => void>()
let timer: ReturnType<typeof setTimeout> | undefined
let laufNummer = 0

function setzen(neu: Partial<PruefZustand>) {
  zustand = { ...zustand, ...neu }
  hoerer.forEach(h => h())
}

export const pruefStore = {
  abonnieren(hoererNeu: () => void) {
    hoerer.add(hoererNeu)
    return () => {
      hoerer.delete(hoererNeu)
    }
  },
  zustand: () => zustand,
}

export async function pruefen() {
  clearTimeout(timer)
  const nummer = ++laufNummer
  setzen({ status: 'laeuft', fehler: null })
  try {
    const bericht = await anfrage<Bericht>(projektPfad('/pruefbericht'))
    if (nummer === laufNummer) setzen({ status: 'fertig', bericht })
  } catch (error) {
    if (nummer === laufNummer) {
      setzen({ status: 'fehler', fehler: (error as Error).message })
    }
  }
}

export function pruefenVerzoegert() {
  clearTimeout(timer)
  timer = setTimeout(pruefen, WARTEZEIT_MS)
}

export function pruefenWennNoetig() {
  if (zustand.status === 'bereit') pruefen()
}
