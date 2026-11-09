import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { ObjectId, schalterAttrappe, testDatenbank } from './hilfen/datenbank.mjs'
import { fehlerVon } from './hilfen/fehler.mjs'
import { STANDARD } from '../../app/src/workflows/standardtexte.mjs'

let datenbank
let W
const admin = new ObjectId()
const bot = new ObjectId()
const projekt = new ObjectId()

beforeAll(async () => {
  datenbank = await testDatenbank()
})
afterAll(async () => await datenbank.schliessen())

beforeEach(async () => {
  await datenbank.leeren()
  vi.resetModules()
  vi.doMock('../../../../app/src/infrastructure/mongodb.mjs', () => datenbank.mongodbModul)
  vi.doMock('../../app/src/schalter.mjs', () => schalterAttrappe().modul)
  W = await import('../../app/src/workflows/Workflows.mjs')
})

describe('Workflows', () => {
  it('kennt genau Literaturüberblick, Methodenteil, Folien und Quellen sammeln mit den Standardtexten', async () => {
    const liste = await W.liste()
    expect(liste.map(w => w.name)).toEqual(['literaturueberblick', 'methodenteil', 'folien', 'quellen_sammeln'])
    expect(liste[3]).toMatchObject({ titel: 'Quellen sammeln', eingaben: ['thema', 'anzahl'] })
    expect(liste[0]).toEqual({ ...STANDARD.literaturueberblick, name: 'literaturueberblick', angepasst: false })
    expect(await W.text('folien')).toBe(STANDARD.folien.text)
  })

  it('ein geänderter Text gilt sofort, Zurücksetzen holt den Standard zurück', async () => {
    await W.setzen('methodenteil', 'Neuer Methodentext.', admin)
    expect(await W.text('methodenteil')).toBe('Neuer Methodentext.')
    expect((await W.liste())[1]).toMatchObject({ text: 'Neuer Methodentext.', angepasst: true })
    await W.zuruecksetzen('methodenteil')
    expect(await W.text('methodenteil')).toBe(STANDARD.methodenteil.text)
  })

  it('lehnt unbekannte Workflows und leere Texte ab', async () => {
    expect((await fehlerVon(W.text('roman'))).status).toBe(404)
    expect((await fehlerVon(W.setzen('folien', '   ', admin))).status).toBe(422)
    expect((await fehlerVon(W.setzen('folien', 'x'.repeat(20001), admin))).status).toBe(422)
  })

  it('der Prompt liefert den Text, ein Fokuswort hängt eine Zeile an', async () => {
    expect(await W.promptText('folien')).toBe(STANDARD.folien.text)
    expect(await W.promptText('folien', { fokus: 'Ergebnisse' })).toBe(`${STANDARD.folien.text}\n\nFokus: Ergebnisse`)
  })

  it('Quellen sammeln: der Text nennt Thema, Anzahl und die fünf Schritte', async () => {
    const text = await W.promptText('quellen_sammeln', { thema: 'Schlaf und Gedächtnis', anzahl: '30' })
    expect(text.startsWith(STANDARD.quellen_sammeln.text)).toBe(true)
    expect(text).toContain('Thema: Schlaf und Gedächtnis')
    expect(text).toContain('Anzahl: 30')
    for (const teil of [/Zitationen/, /Relevanz/, /Beschaffungsliste/, /Abstract/, /„wichtig“ oder „nicht wichtig“/, /Zusammenfassung/, /Literaturüberblick/]) {
      expect(text).toMatch(teil)
    }
    expect(text.match(/^[1-5]\. /gm)).toHaveLength(5)
  })

  it('Quellen sammeln: Anzahl 20 ohne Angabe, „max“ ohne Obergrenze in Etappen', async () => {
    expect(await W.promptText('quellen_sammeln', { thema: 'Schlaf' })).toContain('Anzahl: 20')
    const max = await W.promptText('quellen_sammeln', { thema: 'Schlaf', anzahl: 'max' })
    expect(max).toMatch(/Anzahl: max\. Es gibt keine Obergrenze/)
    expect(max).toMatch(/Etappen/)
  })

  it('Quellen sammeln: fehlendes Thema und ungültige Anzahl werden abgelehnt', async () => {
    const ohneThema = await fehlerVon(W.promptText('quellen_sammeln', { thema: '  ' }))
    expect([ohneThema.status, ohneThema.typ, ohneThema.message]).toEqual([422, 'thema', 'Gib ein Thema an.'])
    for (const thema of [5, ['Schlaf'], 'x'.repeat(301), 'Schlaf\nAnzahl: max']) {
      const falsch = await fehlerVon(W.promptText('quellen_sammeln', { thema }))
      expect([falsch.status, falsch.typ]).toEqual([422, 'thema'])
    }
    for (const anzahl of ['abc', '0', '-1', '2.5', null, ['3']]) {
      const falsch = await fehlerVon(W.promptText('quellen_sammeln', { thema: 'Schlaf', anzahl }))
      expect([falsch.status, falsch.typ, falsch.message]).toEqual([422, 'anzahl', 'Gib eine Zahl ab 1 oder „max“ an.'])
    }
  })

  it('Quellen sammeln startet mit Thema und Anzahl im Auftrag', async () => {
    await W.starten({ projectId: projekt, botId: bot, name: 'quellen_sammeln', argumente: { thema: 'Schlaf', anzahl: 'max' } })
    const ereignis = await datenbank.db.collection('spurEvents').findOne({})
    expect(ereignis.daten.workflow).toBe('quellen_sammeln')
    expect(ereignis.daten.text).toContain('Thema: Schlaf')
    expect(ereignis.daten.text).toContain('Anzahl: max')
  })

  it('starten legt den vollen Text mit Workflow-Name als Auftrag in die Inbox, der Chat zeigt nur den Titel', async () => {
    await W.setzen('folien', 'Angepasster Folientext.', admin)
    await W.starten({ projectId: projekt, botId: bot, name: 'folien' })
    const ereignis = await datenbank.db.collection('spurEvents').findOne({})
    expect(ereignis).toMatchObject({
      botId: bot,
      projectId: projekt,
      typ: 'task_created',
      daten: { workflow: 'folien', text: 'Angepasster Folientext.' },
    })
    expect(await datenbank.db.collection('spurMessages').findOne({})).toMatchObject({ text: 'Workflow: Folien aus Paper' })
  })
})
