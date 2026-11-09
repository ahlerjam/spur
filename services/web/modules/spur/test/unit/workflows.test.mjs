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
  it('kennt genau Literaturüberblick, Methodenteil und Folien mit den Standardtexten', async () => {
    const liste = await W.liste()
    expect(liste.map(w => w.name)).toEqual(['literaturueberblick', 'methodenteil', 'folien'])
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
    expect(await W.promptText('folien', 'Ergebnisse')).toBe(`${STANDARD.folien.text}\n\nFokus: Ergebnisse`)
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
