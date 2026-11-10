import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { ObjectId, schalterAttrappe, testDatenbank } from './hilfen/datenbank.mjs'
import { fehlerVon } from './hilfen/fehler.mjs'

let datenbank
let UploadLink
let schalter
const projekt = new ObjectId()
const anna = new ObjectId()
const bot = new ObjectId()

beforeAll(async () => {
  datenbank = await testDatenbank()
})
afterAll(async () => await datenbank.schliessen())

beforeEach(async () => {
  await datenbank.leeren()
  vi.resetModules()
  vi.doMock('../../../../app/src/infrastructure/mongodb.mjs', () => datenbank.mongodbModul)
  vi.doMock('@overleaf/settings', () => ({ default: { siteUrl: 'https://spur.example.org', i18n: { defaultLng: 'de' } } }))
  schalter = schalterAttrappe()
  vi.doMock('../../app/src/schalter.mjs', () => schalter.modul)
  UploadLink = await import('../../app/src/hochladen/UploadLink.mjs')
})

describe('Einmal-Link', () => {
  it('liefert Link, Gültigkeit und Höchstzahl und speichert nur einen Hash', async () => {
    const link = await UploadLink.erzeugen({ projectId: projekt, menschId: anna, botId: bot })
    expect(link).toMatchObject({ gueltig_minuten: 15, max_dateien: 50 })
    expect(link.link).toMatch(/^https:\/\/spur\.example\.org\/spur\/hochladen\/[0-9a-f]{64}$/)
    const token = link.link.split('/').pop()
    const gespeichert = await datenbank.db.collection('spurUploadLinks').findOne({})
    expect(JSON.stringify(gespeichert)).not.toContain(token)
    expect(await UploadLink.pruefen(token)).toMatchObject({ projectId: projekt, menschId: anna, botId: bot })
  })

  it('lehnt unbekannte Tokens mit 401 ab', async () => {
    expect(await fehlerVon(UploadLink.pruefen('f'.repeat(64)))).toMatchObject({ status: 401 })
    expect(await fehlerVon(UploadLink.pruefen(undefined))).toMatchObject({ status: 401 })
  })

  it('meldet nach 15 Minuten „abgelaufen“', async () => {
    const token = (await UploadLink.erzeugen({ projectId: projekt, menschId: anna, botId: bot })).link.split('/').pop()
    schalter.zeit = new Date(schalter.zeit.getTime() + 15 * 60 * 1000 + 1000)
    const fehler = await fehlerVon(UploadLink.verbrauchen(token))
    expect(fehler).toMatchObject({ status: 410, typ: 'link_abgelaufen' })
  })

  it('erlaubt 50 Uploads, der 51. ist „verbraucht“, auch gleichzeitig', async () => {
    const token = (await UploadLink.erzeugen({ projectId: projekt, menschId: anna, botId: bot })).link.split('/').pop()
    const ergebnisse = await Promise.allSettled(Array.from({ length: 51 }, () => UploadLink.verbrauchen(token)))
    expect(ergebnisse.filter(e => e.status === 'fulfilled')).toHaveLength(50)
    expect(ergebnisse.find(e => e.status === 'rejected').reason).toMatchObject({ status: 410, typ: 'link_verbraucht' })
  })
})
