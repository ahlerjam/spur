import { latexSicher } from '../pruefung/bib.mjs'

const datum = d => d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC' })
const laeufeText = n => (n === 1 ? '1 Lauf' : `${n} Läufe`)

// laeufe: [{ status, zusammenfassung, pfade, gestartet }] ohne offene Läufe ohne Änderung.
export function offenlegungText(laeufe, { modell } = {}) {
  const beendet = laeufe.filter(l => l.status !== 'offen')
  if (!beendet.length) return 'Keine KI-Nutzung protokolliert.'
  const zeiten = beendet.map(l => l.gestartet.getTime())
  const von = datum(new Date(Math.min(...zeiten)))
  const bis = datum(new Date(Math.max(...zeiten)))
  const zeitraum = von === bis ? `am ${von}` : `zwischen dem ${von} und dem ${bis}`
  const zwecke = beendet.map(l => l.zusammenfassung?.trim()).filter(Boolean)
  const dateien = [...new Set(beendet.flatMap(l => l.pfade))].sort()
  const entschieden = beendet.filter(l => ['angenommen', 'abgelehnt'].includes(l.status))
  const angenommen = entschieden.filter(l => l.status === 'angenommen').length
  const wartet = beendet.length - entschieden.length
  const saetze = [
    `Für diese Arbeit wurde ein KI-Assistent (Claude) über spur eingesetzt. Protokolliert sind ${laeufeText(beendet.length)} ${zeitraum}.`,
    zwecke.length && `Zweck: ${zwecke.join('; ')}.`,
    dateien.length && `Betroffene Dateien: ${dateien.join(', ')}.`,
    modell?.trim() && `Modell: ${modell.trim()}.`,
    entschieden.length &&
      `Angenommen wurden ${angenommen} von ${entschieden.length} abgeschlossenen Läufen (${Math.round((angenommen / entschieden.length) * 100)} %).`,
    wartet && `${laeufeText(wartet)} ${wartet === 1 ? 'wartet' : 'warten'} noch auf eine Entscheidung.`,
    'Alle Vorschläge liefen als nachverfolgte Änderungen; übernommen wurde nur, was eine Person angenommen hat.',
  ]
  return saetze.filter(Boolean).join(' ')
}

export function texAbschnitt(text) {
  return `\\section*{Nutzung von KI-Werkzeugen}\n${latexSicher(text)}\n`
}
