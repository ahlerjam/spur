import { describe, expect, it } from 'vitest'
import { offenlegungText, texAbschnitt } from '../../app/src/offenlegung/text.mjs'

const lauf = (status, zusammenfassung, pfade, tag) => ({ status, zusammenfassung, pfade, gestartet: new Date(`2026-11-0${tag}T10:00:00Z`) })

describe('offenlegungText', () => {
  it('nennt Läufe, Zweck, Dateien und die Annahmequote', () => {
    const text = offenlegungText([
      lauf('angenommen', 'Einleitung überarbeitet', ['main.tex'], 1),
      lauf('abgelehnt', 'Methodenteil gekürzt', ['kapitel/methode.tex'], 3),
      lauf('angenommen', 'Literaturüberblick ergänzt', ['main.tex', 'kapitel/literatur.tex'], 5),
    ])
    expect(text).toContain('3 Läufe zwischen dem 01.11.2026 und dem 05.11.2026')
    expect(text).toContain('Zweck: Einleitung überarbeitet; Methodenteil gekürzt; Literaturüberblick ergänzt.')
    expect(text).toContain('Betroffene Dateien: kapitel/literatur.tex, kapitel/methode.tex, main.tex.')
    expect(text).toContain('Angenommen wurden 2 von 3 abgeschlossenen Läufen (67 %).')
    expect(text).not.toContain('Modell')
  })

  it('nennt das Modell nur, wenn es angegeben ist', () => {
    expect(offenlegungText([lauf('fertig', 'X', ['main.tex'], 1)], { modell: 'Claude Opus 5.5' })).toContain('Modell: Claude Opus 5.5.')
  })

  it('zählt offene und unbeantwortete Läufe nicht als abgelehnt', () => {
    const text = offenlegungText([lauf('angenommen', 'A', ['a.tex'], 1), lauf('offen', null, ['a.tex'], 2), lauf('fertig', 'B', ['a.tex'], 2)])
    expect(text).toContain('1 Lauf')
    expect(text).toContain('Angenommen wurden 1 von 1 abgeschlossenen Läufen (100 %).')
    expect(text).toContain('1 Lauf wartet noch auf eine Entscheidung')
  })

  it('meldet, wenn nichts protokolliert ist', () => {
    expect(offenlegungText([])).toBe('Keine KI-Nutzung protokolliert.')
  })
})

describe('texAbschnitt', () => {
  it('setzt den Text als Abschnitt und maskiert LaTeX-Zeichen', () => {
    expect(texAbschnitt('50 % in main_teil.tex')).toBe('\\section*{Nutzung von KI-Werkzeugen}\n50 \\% in main\\_teil.tex\n')
  })
})
