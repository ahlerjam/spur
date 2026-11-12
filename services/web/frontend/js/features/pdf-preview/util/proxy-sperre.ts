// spur: Liefert die PDF-Auslieferung kein PDF (etwa eine HTML-Seite eines Firmenproxys), ist das kein Fehler des
// Dokuments. Nach einem Ladefehler fragt der Betrachter darum einmal nach, was wirklich zurückkommt.
export async function fremdeAntwort(url: string): Promise<{ status?: number } | null> {
  let antwort: Response
  try {
    antwort = await fetch(url, { headers: { Range: 'bytes=0-1023' } })
  } catch {
    return null
  }
  const typ = antwort.headers.get('Content-Type') ?? ''
  const anfang = new Uint8Array(await antwort.arrayBuffer()).slice(0, 5)
  const istPdf = typ.includes('application/pdf') && String.fromCharCode(...anfang) === '%PDF-'
  if (istPdf) return null
  return { status: antwort.ok ? undefined : antwort.status }
}

export const PROXY_FEHLER = 'proxy-blocked'

export const proxyFehlerVon = (status?: number) =>
  status ? `${PROXY_FEHLER}:${status}` : PROXY_FEHLER
