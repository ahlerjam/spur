import { describe, expect, it } from 'vitest'
import { titelabgleich } from '../../app/src/recherche/titelabgleich.mjs'

const TITEL = 'Sleep and memory consolidation in adolescents'

describe('titelabgleich', () => {
  it('passt, wenn der Titel auf der ersten Seite steht', () => {
    expect(titelabgleich(TITEL, ['Sleep and memory consolidation\nin adolescents\nA. Smith'], null)).toBe('passt')
  })

  it('passt, wenn ein Deckblatt des Repositoriums voransteht und der Titel erst auf Seite 2 folgt', () => {
    const seiten = ['University Repository\nDownloaded from the institutional archive', `${TITEL}\nA. Smith`, 'Text']
    expect(titelabgleich(TITEL, seiten, null)).toBe('passt')
  })

  it('weicht ab, wenn das PDF ein anderes Werk ist', () => {
    const seiten = ['Soil microbes in alpine meadows\nB. Jones', 'Microbial communities differ with altitude.']
    expect(titelabgleich(TITEL, seiten, 'Soil microbes in alpine meadows')).toBe('abweichend')
  })

  it('sieht nur die ersten drei Seiten an', () => {
    expect(titelabgleich(TITEL, ['Eins', 'Zwei', 'Drei', TITEL], null)).toBe('abweichend')
  })

  it('zählt auch das Titelfeld des PDFs', () => {
    expect(titelabgleich(TITEL, ['Vorwort ohne den Namen des Werks'], TITEL)).toBe('passt')
  })

  it('vergleicht ohne Großschreibung, Satzzeichen und Akzente', () => {
    expect(titelabgleich('Schlaf: Gedächtnis & Müdigkeit bei Schülern', ['SCHLAF – GEDACHTNIS UND MUDIGKEIT BEI SCHULERN'], null)).toBe('passt')
  })

  it('verlangt mindestens die Hälfte der Wörter ab vier Zeichen, wenigstens aber drei', () => {
    // Sechs lange Wörter: drei reichen.
    const lang = 'Sleep memory consolidation adolescents hippocampus replay'
    expect(titelabgleich(lang, ['sleep memory consolidation'], null)).toBe('passt')
    expect(titelabgleich(lang, ['sleep memory'], null)).toBe('abweichend')
    // Vier lange Wörter: die Hälfte wären zwei, verlangt sind drei.
    expect(titelabgleich('Sleep memory consolidation adolescents', ['sleep memory'], null)).toBe('abweichend')
    // Zwei lange Wörter: beide müssen vorkommen.
    expect(titelabgleich('Sleep and Memory', ['On sleep in general'], null)).toBe('abweichend')
    expect(titelabgleich('Sleep and Memory', ['Sleep and Memory'], null)).toBe('passt')
  })

  it('ist nicht prüfbar ohne Textebene auf den ersten drei Seiten', () => {
    expect(titelabgleich(TITEL, ['', ' \n', ''], TITEL)).toBe('nicht_pruefbar')
    expect(titelabgleich(TITEL, [], null)).toBe('nicht_pruefbar')
  })

  it('ist nicht prüfbar, wenn der Titel kein Wort mit vier Zeichen hat', () => {
    expect(titelabgleich('On the Up', ['On the Up'], null)).toBe('nicht_pruefbar')
    expect(titelabgleich('', ['Text'], null)).toBe('nicht_pruefbar')
  })
})
