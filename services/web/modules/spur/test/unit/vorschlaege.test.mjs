import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { ObjectId, schalterAttrappe, testDatenbank } from './hilfen/datenbank.mjs'
import { fehlerVon } from './hilfen/fehler.mjs'

let datenbank
let schalter
let V
const ada = new ObjectId()
const bo = new ObjectId()
const adasBot = new ObjectId()
const projekt = new ObjectId()

beforeAll(async () => {
  datenbank = await testDatenbank()
})
afterAll(async () => await datenbank.schliessen())

beforeEach(async () => {
  await datenbank.leeren()
  await datenbank.db.collection('users').insertOne({ _id: adasBot, spur: { botFuer: ada } })
  schalter = schalterAttrappe()
  vi.resetModules()
  vi.doMock('../../../../app/src/infrastructure/mongodb.mjs', () => datenbank.mongodbModul)
  vi.doMock('../../app/src/schalter.mjs', () => schalter.modul)
  V = await import('../../app/src/vorschlaege/Vorschlaege.mjs')
})

const ereignisse = () => datenbank.db.collection('spurEvents').find({ typ: 'suggest_trigger' }).toArray()
const compile = (menschId = ada) =>
  V.ausloesen({ projectId: projekt, menschId, art: 'compile_fehler', daten: () => ({ fehler: [{ zeile: 4, meldung: 'Undefined control sequence.' }] }) })

describe('Schalter', () => {
  it('stehen ohne Einstellung beide auf Aus, das Tageslimit auf 50', async () => {
    expect(await V.stand(projekt, ada)).toMatchObject({
      eigene: { compile_fehler: null, belegloses_argument: null },
      projekt: { compile_fehler: null, belegloses_argument: null },
      wirksam: { compile_fehler: 'aus', belegloses_argument: 'aus' },
      limit: 50,
      heute: 0,
      limitErreicht: false,
    })
  })

  it('der Projekt-Standard gilt für Mitglieder ohne eigene Einstellung, die eigene überschreibt ihn', async () => {
    await V.projektSetzen(projekt, 'compile_fehler', 'vorschlag')
    expect((await V.stand(projekt, bo)).wirksam.compile_fehler).toBe('vorschlag')
    await V.eigeneSetzen(projekt, bo, 'compile_fehler', 'aus')
    expect((await V.stand(projekt, bo)).wirksam.compile_fehler).toBe('aus')
    expect((await V.stand(projekt, ada)).wirksam.compile_fehler).toBe('vorschlag')
    // Zurück auf den Projekt-Standard
    await V.eigeneSetzen(projekt, bo, 'compile_fehler', null)
    expect((await V.stand(projekt, bo)).wirksam.compile_fehler).toBe('vorschlag')
  })

  it('lehnt unbekannte Schalter, Werte und Limits ab', async () => {
    expect((await fehlerVon(V.eigeneSetzen(projekt, ada, 'stil', 'vorschlag'))).status).toBe(422)
    expect((await fehlerVon(V.eigeneSetzen(projekt, ada, 'compile_fehler', 'auto'))).status).toBe(422)
    expect((await fehlerVon(V.projektSetzen(projekt, 'compile_fehler', null))).status).toBe(422)
    expect((await fehlerVon(V.limitSetzen(ada, 0))).status).toBe(422)
    expect((await fehlerVon(V.limitSetzen(ada, 2.5))).status).toBe(422)
  })
})

describe('Auslöser', () => {
  it('erzeugt mit Schalter Aus kein Ereignis', async () => {
    expect(await compile()).toEqual({ ausgeloest: false, grund: 'aus' })
    expect(await ereignisse()).toHaveLength(0)
  })

  it('erzeugt mit Vorschlag genau ein suggest_trigger für den eigenen Bot', async () => {
    await V.eigeneSetzen(projekt, ada, 'compile_fehler', 'vorschlag')
    expect(await compile()).toEqual({ ausgeloest: true })
    const liste = await ereignisse()
    expect(liste).toHaveLength(1)
    expect(liste[0]).toMatchObject({
      botId: adasBot,
      projectId: projekt,
      zugestellt: false,
      daten: { art: 'compile_fehler', fehler: [{ zeile: 4 }] },
    })
  })

  it('holt die Daten erst nach den Prüfungen und löst ohne Anlass nichts aus', async () => {
    const daten = vi.fn(async () => null)
    await V.ausloesen({ projectId: projekt, menschId: ada, art: 'compile_fehler', daten })
    expect(daten).not.toHaveBeenCalled()
    await V.eigeneSetzen(projekt, ada, 'compile_fehler', 'vorschlag')
    expect(await V.ausloesen({ projectId: projekt, menschId: ada, art: 'compile_fehler', daten })).toEqual({
      ausgeloest: false,
      grund: 'kein_anlass',
    })
    expect(await ereignisse()).toHaveLength(0)
  })

  it('erzeugt nichts für Menschen ohne Claude', async () => {
    await V.eigeneSetzen(projekt, bo, 'compile_fehler', 'vorschlag')
    expect(await compile(bo)).toEqual({ ausgeloest: false, grund: 'kein_claude' })
    expect(await ereignisse()).toHaveLength(0)
  })

  it('hält das Tageslimit ein und zählt am nächsten Tag neu', async () => {
    await V.eigeneSetzen(projekt, ada, 'compile_fehler', 'vorschlag')
    await V.limitSetzen(ada, 2)
    expect((await compile()).ausgeloest).toBe(true)
    expect((await compile()).ausgeloest).toBe(true)
    expect(await compile()).toEqual({ ausgeloest: false, grund: 'limit' })
    expect(await ereignisse()).toHaveLength(2)
    expect(await V.stand(projekt, ada)).toMatchObject({ limit: 2, heute: 2, limitErreicht: true })

    schalter.zeit = new Date(schalter.zeit.getTime() + 24 * 3600 * 1000)
    expect((await V.stand(projekt, ada)).limitErreicht).toBe(false)
    expect((await compile()).ausgeloest).toBe(true)
  })
})

describe('Vorschläge im Panel', () => {
  it('panel liefert Stand und offene Vorschläge zusammen', async () => {
    await vorschlag()
    const { stand, vorschlaege } = await V.panel(projekt, ada)
    expect(stand.wirksam.compile_fehler).toBe('aus')
    expect(vorschlaege.map(v => v.titel)).toEqual(['Beleg fehlt'])
  })

  async function vorschlag() {
    return await V.vorschlagen({
      projectId: projekt,
      botId: adasBot,
      art: 'belegloses_argument',
      titel: 'Beleg fehlt',
      text: 'Für „Schlaf verdoppelt die Gedächtnisleistung“ fehlt eine Quelle.',
      pfad: 'main.tex',
    })
  }

  it('legt einen Vorschlag ab, den nur der eigene Mensch sieht', async () => {
    const { vorschlag_id } = await vorschlag()
    expect(vorschlag_id).toBeDefined()
    const liste = await V.liste(projekt, ada)
    expect(liste).toEqual([
      expect.objectContaining({ id: vorschlag_id, titel: 'Beleg fehlt', art: 'belegloses_argument', pfad: 'main.tex' }),
    ])
    expect(await V.liste(projekt, bo)).toEqual([])
  })

  it('Verwerfen entfernt die Karte', async () => {
    const { vorschlag_id } = await vorschlag()
    await V.verwerfen(projekt, ada, String(vorschlag_id))
    expect(await V.liste(projekt, ada)).toEqual([])
  })

  it('Übernehmen legt einen Auftrag mit dem Vorschlag in die Inbox und entfernt die Karte', async () => {
    const { vorschlag_id } = await vorschlag()
    await V.uebernehmen(projekt, ada, String(vorschlag_id))
    const [auftrag] = await datenbank.db.collection('spurEvents').find({ typ: 'task_created' }).toArray()
    expect(auftrag.botId).toEqual(adasBot)
    expect(auftrag.daten.text).toContain('Für „Schlaf verdoppelt die Gedächtnisleistung“ fehlt eine Quelle.')
    expect(auftrag.daten.vorschlag_id).toEqual(vorschlag_id)
    expect(await V.liste(projekt, ada)).toEqual([])
  })

  it('fremde oder erledigte Vorschläge gibt es nicht', async () => {
    const { vorschlag_id } = await vorschlag()
    expect((await fehlerVon(V.verwerfen(projekt, bo, String(vorschlag_id)))).status).toBe(404)
    await V.verwerfen(projekt, ada, String(vorschlag_id))
    expect((await fehlerVon(V.uebernehmen(projekt, ada, String(vorschlag_id)))).status).toBe(404)
    expect((await fehlerVon(V.uebernehmen(projekt, ada, 'kaputt'))).status).toBe(404)
  })
})
