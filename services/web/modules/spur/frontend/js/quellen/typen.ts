// Unter diesem Mittelwert der Tesseract-Konfidenz gilt die Erkennung als unsicher.
export const OCR_SICHER_AB = 70

export type Quelle = {
  id: string
  dateiname: string
  key: string
  art: 'pdf' | 'vtt' | 'web'
  seitenzahl: number
  status: 'text' | 'kein_text' | 'ocr'
  doi: string | null
  titel: string | null
  autoren: string[]
  jahr: number | null
  fassung: string
  versatz: number | null
  nurProjekt?: boolean
  versatzQuelle: 'pagelabels' | 'bestaetigt' | null
  ocr: {
    status: 'laeuft' | 'fertig' | 'fehler' | 'abgebrochen'
    fertig: number
    gesamt: number
    konfidenz: number | null
  } | null
  web: { url: string; abgerufenAm: string } | null
}

// Webseiten heißen nach ihrem Titel, Dateien nach dem Dateinamen.
export const anzeigename = (quelle: Quelle) =>
  quelle.web ? (quelle.titel ?? quelle.dateiname) : quelle.dateiname

export const datumLang = (iso: string, sprache: string) =>
  new Date(iso).toLocaleDateString(sprache, { day: 'numeric', month: 'long', year: 'numeric' })

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

export type Person = { id: string; name: string }

export type Zitat = {
  id: string
  seite: number
  label: string | null
  text: string
  von: Person
  kommentare: { id: string; von: Person; text: string; am: string }[]
  zugewiesen: { an: Person; von: Person; am: string } | null
  bestaetigt: { von: Person; am: string } | null
}
