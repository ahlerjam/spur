import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { ObjectId, schalterAttrappe, testDatenbank } from './hilfen/datenbank.mjs'
import { fehlerVon } from './hilfen/fehler.mjs'

let datenbank
let E
let m
const ada = new ObjectId()
const bo = new ObjectId()
const adasBot = new ObjectId()
const bosBot = new ObjectId()
const projekt = new ObjectId()
const thread = 'aaaaaaaaaaaaaaaaaaaaaaaa'
const DOC = '0123456789abcdef01234567'
const TEXT = 'Einleitung.\nSchlaf verdoppelt die Gedächtnisleistung.\nEnde.'

// Wie der echte DocstoreManager, der die ID in einen URL-Pfad setzt (path.posix.join verlangt Text).
const nurText = id => {
  if (typeof id !== 'string') throw new TypeError('projectId muss Text sein')
}

beforeAll(async () => {
  datenbank = await testDatenbank()
})
afterAll(async () => await datenbank.schliessen())

beforeEach(async () => {
  await datenbank.leeren()
  await datenbank.db.collection('users').insertMany([
    { _id: adasBot, spur: { botFuer: ada } },
    { _id: bosBot, spur: { botFuer: bo } },
  ])
  const position = TEXT.indexOf('Schlaf')
  m = {
    ranges: [{ _id: DOC, ranges: { comments: [{ id: 'c1', op: { c: 'Schlaf verdoppelt', p: position, t: thread } }] } }],
    threads: {
      [thread]: {
        messages: [
          { id: 'm-bo', content: 'Geheime Notiz von Bo', user_id: String(bo) },
          { id: 'm-ada', content: '@claude prüfe diese Aussage', user_id: String(ada) },
        ],
      },
    },
  }
  m.ChatApiHandler = {
    promises: {
      getThreads: vi.fn(async () => m.threads),
      sendComment: vi.fn(async (p, t, u, content) => ({ id: 'm-claude', content, user_id: u })),
    },
  }
  m.DocstoreManager = { promises: { getAllRanges: vi.fn(async id => (nurText(id), m.ranges)) } }
  m.PruefManager = { dokumente: vi.fn(async () => [{ docId: DOC, pfad: 'main.tex', text: TEXT }]) }
  m.EditorRealTimeController = { emitToRoom: vi.fn() }
  m.UserInfoManager = { promises: { getPersonalInfo: vi.fn(async id => ({ _id: id, first_name: 'Claude', last_name: '(Ada)' })) } }
  m.UserInfoController = { formatPersonalInfo: u => ({ id: String(u._id), first_name: u.first_name, last_name: u.last_name }) }
  vi.resetModules()
  vi.doMock('../../../../app/src/infrastructure/mongodb.mjs', () => datenbank.mongodbModul)
  vi.doMock('../../app/src/schalter.mjs', () => schalterAttrappe().modul)
  vi.doMock('../../../../app/src/Features/Chat/ChatApiHandler.mjs', () => ({ default: m.ChatApiHandler }))
  vi.doMock('../../../../app/src/Features/Docstore/DocstoreManager.mjs', () => ({ default: m.DocstoreManager }))
  vi.doMock('../../../../app/src/Features/Editor/EditorRealTimeController.mjs', () => ({ default: m.EditorRealTimeController }))
  vi.doMock('../../../../app/src/Features/User/UserInfoManager.mjs', () => ({ default: m.UserInfoManager }))
  vi.doMock('../../../../app/src/Features/User/UserInfoController.mjs', () => ({ default: m.UserInfoController }))
  vi.doMock('../../app/src/pruefung/PruefManager.mjs', () => m.PruefManager)
  E = await import('../../app/src/erwaehnung/Erwaehnung.mjs')
})

const ereignisse = () => datenbank.db.collection('spurEvents').find({}).toArray()
const gesendet = (menschId, text, optionen = { pauseMs: 1 }) =>
  E.kommentarGesendet({ projectId: projekt, threadId: thread, menschId, text }, optionen)

describe('@claude im Kommentar', () => {
  it('meldet dem Bot der schreibenden Person Dokument, Stelle und Kommentar-ID', async () => {
    await gesendet(ada, '@claude prüfe diese Aussage')
    const liste = await ereignisse()
    expect(liste).toHaveLength(1)
    expect(liste[0]).toMatchObject({
      botId: adasBot,
      projectId: projekt,
      typ: 'comment_mention',
      daten: {
        kommentar_id: thread,
        nachricht_id: 'm-ada',
        text: '@claude prüfe diese Aussage',
        doc_id: DOC,
        pfad: 'main.tex',
        stelle: { position: TEXT.indexOf('Schlaf'), laenge: 17, zeile: 2, markiert: 'Schlaf verdoppelt' },
        andere_nachrichten: ['m-bo'],
      },
    })
  })

  it('gibt den Kommentartext anderer Personen nicht weiter', async () => {
    await gesendet(ada, '@claude prüfe diese Aussage')
    expect(JSON.stringify(await ereignisse())).not.toContain('Geheime Notiz von Bo')
  })

  it('der Bot einer anderen Person erhält nichts', async () => {
    await gesendet(ada, '@claude prüfe diese Aussage')
    expect((await ereignisse()).filter(e => String(e.botId) === String(bosBot))).toHaveLength(0)
  })

  it('reagiert nur auf @claude als eigenes Wort', async () => {
    await gesendet(ada, 'Schreib an mail@claude.de')
    await gesendet(ada, 'Kein Aufruf hier')
    await gesendet(ada, '@claudette sieht das anders')
    expect(await ereignisse()).toHaveLength(0)
    await gesendet(ada, 'Bitte @Claude: prüfen')
    expect(await ereignisse()).toHaveLength(1)
  })

  it('wartet, bis die Kommentarstelle im Dokument angekommen ist', async () => {
    const spaeter = m.ranges
    m.ranges = [{ _id: DOC, ranges: {} }]
    m.DocstoreManager.promises.getAllRanges.mockImplementationOnce(async () => m.ranges).mockImplementation(async id => (nurText(id), spaeter))
    await gesendet(ada, '@claude prüfe diese Aussage')
    expect(m.DocstoreManager.promises.getAllRanges).toHaveBeenCalledTimes(2)
    expect((await ereignisse())[0].daten.pfad).toBe('main.tex')
  })

  it('meldet ohne gefundene Stelle trotzdem, dann ohne Dokument', async () => {
    m.ranges = []
    await gesendet(ada, '@claude prüfe diese Aussage', { versuche: 2, pauseMs: 1 })
    expect((await ereignisse())[0].daten).toMatchObject({ kommentar_id: thread, doc_id: null, stelle: null })
  })

  it('ohne eigenes Claude passiert nichts', async () => {
    await datenbank.db.collection('users').deleteMany({})
    await gesendet(ada, '@claude prüfe diese Aussage')
    expect(await ereignisse()).toHaveLength(0)
    expect(m.DocstoreManager.promises.getAllRanges).not.toHaveBeenCalled()
  })
})

describe('Antwort im Thread', () => {
  it('schreibt als Bot in den Thread und meldet es live', async () => {
    const ergebnis = await E.imThreadAntworten({ projectId: projekt, threadId: thread, botId: adasBot, text: 'Die Aussage ist nicht belegt.' })
    expect(ergebnis).toEqual({ nachricht_id: 'm-claude' })
    expect(m.ChatApiHandler.promises.sendComment).toHaveBeenCalledWith(projekt, thread, adasBot, 'Die Aussage ist nicht belegt.')
    expect(m.EditorRealTimeController.emitToRoom).toHaveBeenCalledWith(
      String(projekt),
      'new-comment',
      thread,
      expect.objectContaining({ content: 'Die Aussage ist nicht belegt.', user: expect.objectContaining({ first_name: 'Claude', last_name: '(Ada)' }) })
    )
  })

  it('lehnt einen Thread ab, den es im Projekt nicht gibt', async () => {
    const fehler = await fehlerVon(
      E.imThreadAntworten({ projectId: projekt, threadId: 'bbbbbbbbbbbbbbbbbbbbbbbb', botId: adasBot, text: 'x' })
    )
    expect(fehler.code).toBe('kommentar_fehlt')
    expect(m.ChatApiHandler.promises.sendComment).not.toHaveBeenCalled()
  })
})
