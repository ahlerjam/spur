import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { ObjectId, schalterAttrappe, testDatenbank } from './hilfen/datenbank.mjs'

let datenbank
let schalter
let Inbox
const bot = new ObjectId()
const projekt = new ObjectId()

beforeAll(async () => {
  datenbank = await testDatenbank()
})
afterAll(async () => await datenbank.schliessen())

async function laden() {
  vi.resetModules()
  vi.doMock('../../../../app/src/infrastructure/mongodb.mjs', () => datenbank.mongodbModul)
  vi.doMock('../../app/src/schalter.mjs', () => schalter.modul)
  Inbox = await import('../../app/src/Inbox.mjs')
}

beforeEach(async () => {
  await datenbank.leeren()
  schalter = schalterAttrappe()
  await laden()
})

const kurz = ms => ({ signal: AbortSignal.timeout(ms), maxMs: 60000 })

describe('Aufträge und Antworten', () => {
  it('auftragAnlegen speichert die Nachricht und ein Ereignis für den Bot', async () => {
    const nachricht = await Inbox.auftragAnlegen({ projectId: projekt, botId: bot, text: 'Glätte Kapitel 2' })
    const ereignis = await datenbank.db.collection('spurEvents').findOne({})
    expect(ereignis).toMatchObject({
      botId: bot,
      projectId: projekt,
      typ: 'task_created',
      zugestellt: false,
      daten: { text: 'Glätte Kapitel 2', nachricht_id: nachricht._id },
    })
    expect(await datenbank.db.collection('spurMessages').countDocuments({ von: 'mensch' })).toBe(1)
  })

  it('antwortSpeichern legt eine Nachricht von Claude ab, aber kein Ereignis', async () => {
    await Inbox.antwortSpeichern({ projectId: projekt, botId: bot, text: 'Fertig.' })
    expect(await datenbank.db.collection('spurMessages').findOne({})).toMatchObject({ von: 'claude', text: 'Fertig.' })
    expect(await datenbank.db.collection('spurEvents').countDocuments()).toBe(0)
  })

  it('verlauf liefert die neuesten Nachrichten zuerst, nur für Projekt und Bot', async () => {
    await Inbox.auftragAnlegen({ projectId: projekt, botId: bot, text: 'eins' })
    await Inbox.antwortSpeichern({ projectId: projekt, botId: bot, text: 'zwei' })
    await Inbox.antwortSpeichern({ projectId: new ObjectId(), botId: bot, text: 'fremd' })
    expect((await Inbox.verlauf(projekt, bot)).map(n => n.text)).toEqual(['zwei', 'eins'])
  })

  it('verlauf ordnet nach Zeit, auch wenn die IDs aus zwei Prozessen anders sortieren', async () => {
    // web und web-api erzeugen ObjectIds mit eigenem Zufallsteil; in derselben Sekunde sagt die ID nichts über die Reihenfolge.
    const sekunde = Math.floor(Date.now() / 1000)
    const id = zufall => ObjectId.createFromHexString(sekunde.toString(16).padStart(8, '0') + zufall)
    await datenbank.db.collection('spurMessages').insertMany([
      { _id: id('ffffffffff000001'), projectId: projekt, botId: bot, von: 'mensch', text: 'frage', am: new Date(1000) },
      { _id: id('0000000000000001'), projectId: projekt, botId: bot, von: 'claude', text: 'antwort', am: new Date(2000) },
    ])
    expect((await Inbox.verlauf(projekt, bot)).map(n => n.text)).toEqual(['antwort', 'frage'])
  })
})

describe('warteAufEreignis', () => {
  it('liefert den ältesten offenen Auftrag genau einmal', async () => {
    await Inbox.auftragAnlegen({ projectId: projekt, botId: bot, text: 'erster' })
    await Inbox.auftragAnlegen({ projectId: projekt, botId: bot, text: 'zweiter' })
    const a = await Inbox.warteAufEreignis(bot, kurz(2000))
    const b = await Inbox.warteAufEreignis(bot, kurz(2000))
    const c = await Inbox.warteAufEreignis(bot, kurz(150))
    expect([a.daten.text, b.daten.text, c]).toEqual(['erster', 'zweiter', null])
    expect(a).toMatchObject({ typ: 'task_created', project_id: projekt })
  })

  it('wird von einem neuen Auftrag sofort geweckt', async () => {
    const wartend = Inbox.warteAufEreignis(bot, kurz(4000))
    await new Promise(r => setTimeout(r, 100))
    const start = Date.now()
    await Inbox.auftragAnlegen({ projectId: projekt, botId: bot, text: 'neu' })
    const ereignis = await wartend
    expect(ereignis.daten.text).toBe('neu')
    expect(Date.now() - start).toBeLessThan(1000)
  })

  it('liefert keine Aufträge anderer Bots', async () => {
    await Inbox.auftragAnlegen({ projectId: projekt, botId: new ObjectId(), text: 'fremd' })
    expect(await Inbox.warteAufEreignis(bot, kurz(150))).toBeNull()
  })

  it('beendet den älteren Aufruf, wenn derselbe Bot erneut wartet', async () => {
    const alt = Inbox.warteAufEreignis(bot, { maxMs: 60000 })
    await new Promise(r => setTimeout(r, 100))
    const neu = Inbox.warteAufEreignis(bot, kurz(4000))
    expect(await alt).toBeNull()
    await Inbox.auftragAnlegen({ projectId: projekt, botId: bot, text: 'für den neuen' })
    expect((await neu).daten.text).toBe('für den neuen')
  })

  it('gibt einen Auftrag wieder frei, wenn der Aufruf abgebrochen wird, während er ihn holt', async () => {
    await Inbox.auftragAnlegen({ projectId: projekt, botId: bot, text: 'darf nicht verloren gehen' })
    const abbruch = new AbortController()
    const echt = datenbank.mongodbModul.getCollectionInternal
    datenbank.mongodbModul.getCollectionInternal = async name => {
      const sammlung = await echt(name)
      if (name !== 'spurEvents') return sammlung
      return new Proxy(sammlung, {
        get: (ziel, eigenschaft) =>
          eigenschaft === 'findOneAndUpdate'
            ? async (...args) => {
                const ergebnis = await ziel.findOneAndUpdate(...args)
                abbruch.abort()
                return ergebnis
              }
            : typeof ziel[eigenschaft] === 'function'
              ? ziel[eigenschaft].bind(ziel)
              : ziel[eigenschaft],
      })
    }
    try {
      await laden()
      expect(await Inbox.warteAufEreignis(bot, { signal: abbruch.signal, maxMs: 60000 })).toBeNull()
    } finally {
      datenbank.mongodbModul.getCollectionInternal = echt
    }
    await laden()
    expect((await Inbox.warteAufEreignis(bot, kurz(2000))).daten.text).toBe('darf nicht verloren gehen')
  })
})

describe('verbunden', () => {
  it('gilt als verbunden, solange der letzte Herzschlag unter 45 Sekunden alt ist', async () => {
    expect(await Inbox.verbunden(bot)).toBe(false)
    await Inbox.warteAufEreignis(bot, kurz(100))
    expect(await Inbox.verbunden(bot)).toBe(true)
    schalter.zeit = new Date(schalter.zeit.getTime() + 44000)
    expect(await Inbox.verbunden(bot)).toBe(true)
    schalter.zeit = new Date(schalter.zeit.getTime() + 2000)
    expect(await Inbox.verbunden(bot)).toBe(false)
  })
})

describe('seit', () => {
  it('liefert Ereignisse nach dem Cursor und den neuen Cursor', async () => {
    for (const text of ['a', 'b', 'c']) await Inbox.auftragAnlegen({ projectId: projekt, botId: bot, text })
    const alle = await Inbox.seit(bot)
    expect(alle.ereignisse.map(e => e.daten.text)).toEqual(['a', 'b', 'c'])
    const rest = await Inbox.seit(bot, String(alle.ereignisse[0].id))
    expect(rest.ereignisse.map(e => e.daten.text)).toEqual(['b', 'c'])
    expect(rest.cursor).toEqual(alle.ereignisse[2].id)
    const leer = await Inbox.seit(bot, String(alle.cursor))
    expect(leer).toEqual({ ereignisse: [], cursor: String(alle.cursor) })
  })

  it('ignoriert einen ungültigen Cursor und liefert nur Ereignisse des eigenen Bots', async () => {
    await Inbox.auftragAnlegen({ projectId: projekt, botId: bot, text: 'meins' })
    await Inbox.auftragAnlegen({ projectId: projekt, botId: new ObjectId(), text: 'fremd' })
    const ergebnis = await Inbox.seit(bot, 'kaputt')
    expect(ergebnis.ereignisse.map(e => e.daten.text)).toEqual(['meins'])
    expect(await Inbox.seit(new ObjectId())).toEqual({ ereignisse: [], cursor: null })
  })
})
