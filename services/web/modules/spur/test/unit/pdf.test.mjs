import { existsSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, it } from 'vitest'
import { seitenBild, seitenTexte, versatzAusLabels, vttSeiten } from '../../app/src/pdf.mjs'
import { fehlerVon } from './hilfen/fehler.mjs'

const fixture = name => fileURLToPath(new URL(`../fixtures/${name}`, import.meta.url))
const ordner = mkdtempSync(join(tmpdir(), 'spur-pdf-'))
afterAll(() => rmSync(ordner, { recursive: true, force: true }))

describe('seitenTexte', () => {
  it('liefert den Text je PDF-Seite, ohne leere Zusatzseite am Ende', async () => {
    const seiten = await seitenTexte(fixture('smith2024.pdf'))
    expect(seiten).toHaveLength(8)
    expect(seiten[0]).toContain('DOI 10.5555/spur.2024.001')
    expect(seiten[2]).toContain('Sleep supports the consolidation of declarative memory.')
  })

  it('liefert für einen Scan Seiten ohne Text', async () => {
    const seiten = await seitenTexte(fixture('scan.pdf'))
    expect(seiten).toHaveLength(2)
    expect(seiten.every(s => !s.trim())).toBe(true)
  })

  it('scheitert bei einer Datei, die kein PDF ist', async () => {
    const kaputt = join(ordner, 'kaputt.pdf')
    writeFileSync(kaputt, 'kein pdf')
    expect(await fehlerVon(seitenTexte(kaputt))).toBeInstanceOf(Error)
  })
})

describe('versatzAusLabels', () => {
  it('rechnet die gedruckte Seite minus PDF-Seite aus dezimalen PageLabels', async () => {
    expect(await versatzAusLabels(fixture('smith2024.pdf'))).toBe(344)
  })

  it('liefert nichts ohne PageLabels', async () => {
    expect(await versatzAusLabels(fixture('retracted.pdf'))).toBeNull()
  })
})

describe('seitenBild', () => {
  it('schreibt die Seite als PNG neben das Ziel', async () => {
    const ziel = join(ordner, 'seite-3')
    const pfad = await seitenBild(fixture('smith2024.pdf'), 3, ziel)
    expect(pfad).toBe(`${ziel}.png`)
    expect(existsSync(pfad)).toBe(true)
    expect(statSync(pfad).size).toBeGreaterThan(500)
  })
})

describe('vttSeiten', () => {
  it('macht aus jeder Replik einen Abschnitt mit Zeitmarke als Label', () => {
    const text = `WEBVTT

00:00:01.000 --> 00:00:06.000
Interviewer: Frage eins?

00:00:06.500 --> 00:00:12.000
Teilnehmerin: Antwort
über zwei Zeilen.
`
    expect(vttSeiten(text)).toEqual([
      { label: '00:00:01', text: 'Interviewer: Frage eins?' },
      { label: '00:00:06', text: 'Teilnehmerin: Antwort über zwei Zeilen.' },
    ])
  })

  it('liest die Fixture-Datei vollständig', async () => {
    const { readFileSync } = await import('node:fs')
    const seiten = vttSeiten(readFileSync(fixture('interview.vtt'), 'utf8'))
    expect(seiten).toHaveLength(3)
    expect(seiten[1].text).toMatch(/^Teilnehmerin: After three weeks/)
  })

  it('versteht Windows-Zeilenenden, Kommas bei Millisekunden, Stundenangaben und Cue-Kennungen', () => {
    const text = 'WEBVTT\r\n\r\ncue-1\r\n01:02:03,500 --> 01:02:05,000\r\nMit Kennung\r\n\r\n00:09.250 --> 00:10.000\r\nOhne Stunde\r\n'
    expect(vttSeiten(text)).toEqual([
      { label: '01:02:03', text: 'Mit Kennung' },
      { label: '00:09', text: 'Ohne Stunde' },
    ])
  })

  it('überspringt Kopf, Notizen und leere Repliken', () => {
    const text = 'WEBVTT\n\nNOTE nur ein Hinweis\n\n00:00:01.000 --> 00:00:02.000\n\n\n00:00:03.000 --> 00:00:04.000\nDa\n'
    expect(vttSeiten(text)).toEqual([{ label: '00:00:03', text: 'Da' }])
  })

  it('liefert nichts für Text ohne Zeitmarken', () => {
    expect(vttSeiten('kein vtt')).toEqual([])
  })
})
