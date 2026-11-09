import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { ObjectId, schalterAttrappe, testDatenbank } from './hilfen/datenbank.mjs'
import { fehlerVon } from './hilfen/fehler.mjs'

let datenbank
let schalter
let Zugang
let erzeugteBots

// createNewUser liefert ein Mongoose-Dokument: _id sitzt auf dem Prototyp, nicht am Objekt.
class MongooseDokument {
  constructor(roh) {
    this._doc = roh
  }

  get _id() {
    return this._doc._id
  }
}

beforeAll(async () => {
  datenbank = await testDatenbank()
})
afterAll(async () => await datenbank.schliessen())

beforeEach(async () => {
  await datenbank.leeren()
  erzeugteBots = 0
  schalter = schalterAttrappe()
  vi.resetModules()
  vi.doMock('../../../../app/src/infrastructure/mongodb.mjs', () => datenbank.mongodbModul)
  vi.doMock('../../app/src/schalter.mjs', () => schalter.modul)
  vi.doMock('../../../../app/src/Features/User/UserCreator.mjs', () => ({
    default: {
      promises: {
        createNewUser: async ({ email, first_name: vorname, last_name: nachname }) => {
          erzeugteBots++
          const roh = { _id: new ObjectId(), email, first_name: vorname, last_name: nachname, hashedPassword: 'x' }
          await datenbank.db.collection('users').insertOne(roh)
          return new MongooseDokument(roh)
        },
      },
    },
  }))
  Zugang = await import('../../app/src/ClaudeZugang.mjs')
})

async function mensch(felder = {}) {
  const roh = { _id: new ObjectId(), email: 'anna.schmidt@example.org', first_name: 'Anna', ...felder }
  await datenbank.db.collection('users').insertOne(roh)
  return roh
}

describe('botFuer', () => {
  it('legt für den Menschen einen Bot ohne Passwort an', async () => {
    const anna = await mensch()
    const bot = await Zugang.botFuer(anna)
    expect(bot.email).toBe(`claude-${anna._id}@bot.spur.invalid`)
    expect(bot.last_name).toBe('(Anna)')
    expect(bot.spur.botFuer).toEqual(anna._id)
    expect(bot.hashedPassword).toBeUndefined()
  })

  it('nimmt den Namen aus der E-Mail, wenn kein Vorname da ist', async () => {
    const anna = await mensch({ first_name: undefined })
    expect((await Zugang.botFuer(anna)).last_name).toBe('(anna.schmidt)')
  })

  it('legt den Bot nur einmal an', async () => {
    const anna = await mensch()
    const erster = await Zugang.botFuer(anna)
    const zweiter = await Zugang.botFuer(anna)
    expect(zweiter._id).toEqual(erster._id)
    expect(erzeugteBots).toBe(1)
  })

  it('übernimmt einen gleichzeitig angelegten Bot statt zu scheitern', async () => {
    const anna = await mensch()
    const vorhanden = {
      _id: new ObjectId(),
      email: `claude-${anna._id}@bot.spur.invalid`,
    }
    await datenbank.db.collection('users').insertOne(vorhanden)
    vi.resetModules()
    vi.doMock('../../../../app/src/Features/User/UserCreator.mjs', () => ({
      default: {
        promises: {
          createNewUser: async () => {
            throw Object.assign(new Error('E11000 duplicate key'), { code: 11000 })
          },
        },
      },
    }))
    const bot = await (await import('../../app/src/ClaudeZugang.mjs')).botFuer(anna)
    expect(bot._id).toEqual(vorhanden._id)
    expect(bot.spur.botFuer).toEqual(anna._id)
  })

  it('reicht andere Fehler der Kontoanlage weiter', async () => {
    const anna = await mensch()
    vi.resetModules()
    vi.doMock('../../../../app/src/Features/User/UserCreator.mjs', () => ({
      default: { promises: { createNewUser: async () => Promise.reject(new Error('kaputt')) } },
    }))
    const fehler = await fehlerVon((await import('../../app/src/ClaudeZugang.mjs')).botFuer(anna))
    expect(fehler.message).toBe('kaputt')
  })
})

describe('tokenErzeugen', () => {
  it('verknüpft schon das erste Token mit dem Bot des Menschen', async () => {
    const anna = await mensch()
    const { token } = await Zugang.tokenErzeugen(anna._id)
    const bot = await datenbank.db.collection('users').findOne({ 'spur.botFuer': anna._id })
    const eintrag = await datenbank.db.collection('oauthAccessTokens').findOne({ user_id: anna._id })
    expect(bot).toBeTruthy()
    expect(eintrag.spurBotId).toEqual(bot._id)
    expect(await Zugang.pruefen(token)).toMatchObject({ menschId: anna._id, botId: bot._id })
  })

  it('speichert nur den Hash und nennt das Token einmal im Klartext', async () => {
    const anna = await mensch()
    const { token, ablauf } = await Zugang.tokenErzeugen(anna._id)
    expect(token).toMatch(/^spur_[\w-]{43}$/)
    const eintrag = await datenbank.db.collection('oauthAccessTokens').findOne({})
    expect(eintrag.accessToken).not.toBe(token)
    expect(JSON.stringify(eintrag)).not.toContain(token)
    expect(eintrag.scope).toBe('spur_mcp')
    expect(ablauf).toEqual(new Date('2027-02-05T10:00:00Z'))
  })

  it('teilt sich den Bot zwischen mehreren Tokens', async () => {
    const anna = await mensch()
    await Zugang.tokenErzeugen(anna._id)
    await Zugang.tokenErzeugen(anna._id)
    const eintraege = await datenbank.db.collection('oauthAccessTokens').find({}).toArray()
    expect(eintraege[0].spurBotId).toEqual(eintraege[1].spurBotId)
    expect(erzeugteBots).toBe(1)
  })
})

describe('pruefen', () => {
  it('liefert nichts ohne Token oder bei unbekanntem Token', async () => {
    expect(await Zugang.pruefen(undefined)).toBeNull()
    expect(await Zugang.pruefen('spur_unbekannt')).toBeNull()
  })

  it('weist abgelaufene Tokens ab', async () => {
    const anna = await mensch()
    const { token } = await Zugang.tokenErzeugen(anna._id)
    schalter.zeit = new Date('2027-02-05T10:00:01Z')
    expect(await Zugang.pruefen(token)).toBeNull()
  })

  it('weist Tokens gesperrter Konten ab', async () => {
    const anna = await mensch()
    const { token } = await Zugang.tokenErzeugen(anna._id)
    await datenbank.db.collection('users').updateOne({ _id: anna._id }, { $set: { suspended: true } })
    expect(await Zugang.pruefen(token)).toBeNull()
  })

  it('weist Tokens gelöschter Konten ab', async () => {
    const anna = await mensch()
    const { token } = await Zugang.tokenErzeugen(anna._id)
    await datenbank.db.collection('users').deleteOne({ _id: anna._id })
    expect(await Zugang.pruefen(token)).toBeNull()
  })

  it('verknüpft ein altes Token ohne Bot nachträglich', async () => {
    const anna = await mensch()
    const { token, id } = await Zugang.tokenErzeugen(anna._id)
    await datenbank.db.collection('oauthAccessTokens').updateOne({ _id: id }, { $unset: { spurBotId: '' } })
    const zugang = await Zugang.pruefen(token)
    const bot = await datenbank.db.collection('users').findOne({ 'spur.botFuer': anna._id })
    expect(zugang.botId).toEqual(bot._id)
    expect((await datenbank.db.collection('oauthAccessTokens').findOne({ _id: id })).spurBotId).toEqual(bot._id)
  })
})

describe('tokens und widerrufen', () => {
  it('listet nur die eigenen Tokens, neueste zuerst, mit Ablaufstatus', async () => {
    const anna = await mensch()
    const ben = await mensch({ email: 'ben@example.org' })
    const alt = await Zugang.tokenErzeugen(anna._id)
    schalter.zeit = new Date('2026-11-08T10:00:00Z')
    const neu = await Zugang.tokenErzeugen(anna._id)
    await Zugang.tokenErzeugen(ben._id)
    schalter.zeit = new Date('2027-02-05T12:00:00Z')
    const liste = await Zugang.tokens(anna._id)
    expect(liste.map(t => t.id)).toEqual([neu.id, alt.id])
    expect(liste.map(t => t.abgelaufen)).toEqual([false, true])
  })

  it('widerruft ein Token, danach gilt es nicht mehr', async () => {
    const anna = await mensch()
    const { token, id } = await Zugang.tokenErzeugen(anna._id)
    await Zugang.widerrufen(anna._id, String(id))
    expect(await Zugang.pruefen(token)).toBeNull()
  })

  it('meldet 404 für fremde, schon widerrufene und ungültige Token-IDs', async () => {
    const anna = await mensch()
    const ben = await mensch({ email: 'ben@example.org' })
    const { id } = await Zugang.tokenErzeugen(anna._id)
    for (const [wer, tokenId] of [[ben._id, String(id)], [anna._id, 'quatsch'], [anna._id, String(new ObjectId())]]) {
      expect(await fehlerVon(Zugang.widerrufen(wer, tokenId))).toMatchObject({ status: 404, typ: 'token_fehlt' })
    }
    expect(await datenbank.db.collection('oauthAccessTokens').countDocuments()).toBe(1)
  })
})

describe('kontoAufraeumen', () => {
  it('entfernt Tokens, Bot und alles, was der Bot hinterlassen hat', async () => {
    const anna = await mensch()
    const ben = await mensch({ email: 'ben@example.org' })
    await Zugang.tokenErzeugen(anna._id)
    await Zugang.tokenErzeugen(ben._id)
    const botAnna = (await datenbank.db.collection('users').findOne({ 'spur.botFuer': anna._id }))._id
    const botBen = (await datenbank.db.collection('users').findOne({ 'spur.botFuer': ben._id }))._id
    for (const name of ['spurEvents', 'spurMessages', 'spurRuns', 'spurEdits', 'spurSuggestions']) {
      await datenbank.db.collection(name).insertMany([
        { botId: botAnna, status: 'fertig', schluessel: 'a' },
        { botId: botBen, status: 'fertig', schluessel: 'b' },
      ])
    }
    await datenbank.db.collection('spurHeartbeats').insertMany([{ _id: botAnna }, { _id: botBen }])
    await datenbank.db.collection('spurSettings').insertMany([{ userId: anna._id }, { userId: ben._id }])

    await Zugang.kontoAufraeumen(String(anna._id))

    expect(await datenbank.db.collection('users').findOne({ _id: botAnna })).toBeNull()
    expect(await datenbank.db.collection('users').findOne({ _id: botBen })).toBeTruthy()
    expect(await datenbank.db.collection('oauthAccessTokens').countDocuments()).toBe(1)
    for (const name of ['spurEvents', 'spurMessages', 'spurRuns', 'spurEdits', 'spurSuggestions', 'spurHeartbeats', 'spurSettings']) {
      expect(await datenbank.db.collection(name).countDocuments(), name).toBe(1)
    }
  })
})
