export type PaperTreffer = {
  doi: string | null
  titel: string | null
  autoren: string[]
  jahr: number | null
  dienste: string[]
  frei: boolean | null
  pdf: string | null
  lizenz: string | null
}

export type DienstFehler = {
  dienst: string
  art: 'nicht_erreichbar' | 'limit'
  text: string
}

export type SuchErgebnis = {
  anfrage: string
  seite: number
  treffer: PaperTreffer[]
  weiter: boolean
  fehler: DienstFehler[]
  hinweise: string[]
}
