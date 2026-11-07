export type Quelle = {
  id: string
  dateiname: string
  key: string
  art: 'pdf' | 'vtt'
  seitenzahl: number
  status: 'text' | 'kein_text'
  doi: string | null
  titel: string | null
  fassung: string
  versatz: number | null
  versatzQuelle: 'pagelabels' | 'bestaetigt' | null
}

export type Treffer = {
  quelleId: string
  dateiname: string
  art: Quelle['art']
  seite: number
  label: string | null
  auszug: string
  imDateinamen?: boolean
  quelle?: Quelle
}
