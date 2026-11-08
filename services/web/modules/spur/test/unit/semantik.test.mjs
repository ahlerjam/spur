import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { ObjectId, schalterAttrappe, testDatenbank } from './hilfen/datenbank.mjs'
import { fehlerVon } from './hilfen/fehler.mjs'

let Semantik
let Einbetten
let datenbank
let schalter

const projectId = new ObjectId()
const quelleId = new ObjectId()
const FUELLER = 'Journal of Sleep Research. Participants completed the task over two consecutive nights.'
const SEITEN = [
  FUELLER,
  `Sleep supports the consolidation of declarative memory. Memory traces are strengthened during slow-wave sleep. ${FUELLER}`,
  `During rest the hippocampus replays recent experience. ${FUELLER}`,
  '',
]

beforeAll(async () => {
  datenbank = await testDatenbank()
})
afterAll(async () => await datenbank.schliessen())

beforeEach(async () => {
  await datenbank.leeren()
  schalter = schalterAttrappe()
  schalter.semantik = true
  vi.resetModules()
  vi.doMock('../../../../app/src/infrastructure/mongodb.mjs', () => datenbank.mongodbModul)
  vi.doMock('../../app/src/schalter.mjs', () => schalter.modul)
  vi.doMock('../../app/src/QuellenManager.mjs', () => ({ ablageWurzel: () => '/tmp/spur-test/data/spur' }))
  Semantik = await import('../../app/src/semantik/Semantik.mjs')
  Einbetten = await import('../../app/src/semantik/einbetten.mjs')
  Einbetten.fakePause.ms = 0
  await datenbank.db.collection('spurSources').insertOne({ _id: quelleId, projectId, dateiname: 'smith2024.pdf' })
  await datenbank.db.collection('spurSourcePages').insertMany(
    SEITEN.map((text, i) => ({ quelleId, projectId, seite: i + 1, label: String(345 + i), text }))
  )
})

describe('Semantische Suche', () => {
  it('zählt Seiten mit Text und indexiert sie als Job', async () => {
    expect(await Semantik.stand(projectId)).toEqual({ an: true, gesamt: 3, indexiert: 0, laeuft: false })
    const { ende } = await Semantik.indexieren(projectId)
    await ende
    expect(await Semantik.stand(projectId)).toEqual({ an: true, gesamt: 3, indexiert: 3, laeuft: false })
    const seite = await datenbank.db.collection('spurSourcePages').findOne({ seite: 2 })
    expect(seite.vektor.buffer.byteLength).toBe(384 * 4)
  })

  it('findet die sinngemäß passende Passage zuerst', async () => {
    await (await Semantik.indexieren(projectId)).ende
    const [erster] = await Semantik.suchen(projectId, 'memories get stronger in deep slow wave sleep')
    expect(erster).toMatchObject({ dateiname: 'smith2024.pdf', seite: 2, label: '346' })
    expect(erster.auszug).toContain('Sleep supports the consolidation')
  })

  it('ist ohne Schalter aus und verrät dann nichts', async () => {
    schalter.semantik = false
    expect(await Semantik.stand(projectId)).toEqual({ an: false })
    expect(await fehlerVon(Semantik.suchen(projectId, 'x'))).toMatchObject({ status: 404, typ: 'semantik_aus' })
    expect(await fehlerVon(Semantik.indexieren(projectId))).toMatchObject({ status: 404 })
  })

  it('startet keinen zweiten Indexlauf, solange einer läuft', async () => {
    Einbetten.fakePause.ms = 50
    const erster = await Semantik.indexieren(projectId)
    const zweiter = await Semantik.indexieren(projectId)
    expect(zweiter.job_id).toEqual(erster.job_id)
    expect((await Semantik.stand(projectId)).laeuft).toBe(true)
    await erster.ende
  })
})
