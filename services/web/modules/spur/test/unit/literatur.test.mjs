import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { ObjectId, schalterAttrappe, testDatenbank } from './hilfen/datenbank.mjs'
import { fehlerVon } from './hilfen/fehler.mjs'

let Literatur
let datenbank

const projectId = new ObjectId()
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
  vi.doMock('../../app/src/schalter.mjs', () => schalterAttrappe().modul)
  Literatur = await import('../../app/src/literatur/Literatur.mjs')
})

async function quellen(anzahl, pid = projectId) {
  const liste = Array.from({ length: anzahl }, (_, i) => ({
    _id: new ObjectId(),
    projectId: pid,
    dateiname: `quelle-${String(i).padStart(3, '0')}.pdf`,
    key: `q${i}`,
  }))
  await datenbank.db.collection('spurSources').insertMany(liste)
  return liste
}

describe('Notizen', () => {
  it('speichert je Quelle und je Zitat eine Notiz und liest sie wieder', async () => {
    const [q] = await quellen(1)
    const zitat = new ObjectId()
    await Literatur.notizSetzen(projectId, q, { text: 'Gute Methodik', userId: anna })
    await Literatur.notizSetzen(projectId, q, { zitatId: String(zitat), text: 'Kernzitat', userId: anna })
    await Literatur.notizSetzen(projectId, q, { text: 'Gute Methodik, kleine Stichprobe', userId: anna })
    expect(await Literatur.notizen(q)).toEqual([
      { zitatId: null, text: 'Gute Methodik, kleine Stichprobe' },
      { zitatId: String(zitat), text: 'Kernzitat' },
    ])
  })

  it('löscht eine leere Notiz und begrenzt die Länge', async () => {
    const [q] = await quellen(1)
    await Literatur.notizSetzen(projectId, q, { text: 'x', userId: anna })
    await Literatur.notizSetzen(projectId, q, { text: '  ', userId: anna })
    expect(await Literatur.notizen(q)).toEqual([])
    expect(await fehlerVon(Literatur.notizSetzen(projectId, q, { text: 'x'.repeat(20001), userId: anna }))).toMatchObject({ status: 413 })
  })
})

describe('Literaturmatrix', () => {
  it('zeigt Quellen als Zeilen und frei angelegte Spalten, 50 Zeilen je Seite', async () => {
    await quellen(120)
    await Literatur.spalteAnlegen(projectId, 'Methode')
    await Literatur.spalteAnlegen(projectId, 'Stichprobe')
    const erste = await Literatur.matrix(projectId)
    expect(erste.spalten.map(s => s.name)).toEqual(['Methode', 'Stichprobe'])
    expect(erste.zeilen).toHaveLength(50)
    expect(erste.gesamt).toBe(120)
    expect(erste.zeilen[0].quelle.dateiname).toBe('quelle-000.pdf')
    expect((await Literatur.matrix(projectId, { seite: 3 })).zeilen).toHaveLength(20)
  })

  it('lehnt doppelte oder leere Spaltennamen ab', async () => {
    await Literatur.spalteAnlegen(projectId, 'Methode')
    expect(await fehlerVon(Literatur.spalteAnlegen(projectId, ' methode '))).toMatchObject({ status: 409 })
    expect(await fehlerVon(Literatur.spalteAnlegen(projectId, ''))).toMatchObject({ status: 400 })
  })

  it('schreibt Zellen und übernimmt einen Vorschlag erst nach Bestätigung', async () => {
    const [q] = await quellen(1)
    const spalte = await Literatur.spalteAnlegen(projectId, 'Methode')
    await Literatur.zelleSetzen(projectId, { quelleId: String(q._id), spalteId: spalte.id, text: 'Umfrage' })
    await Literatur.vorschlagen(projectId, { quelleId: String(q._id), spalte: 'Methode', text: 'Längsschnitt', botId: bot })
    let zelle = (await Literatur.matrix(projectId)).zeilen[0].zellen[spalte.id]
    expect(zelle).toMatchObject({ text: 'Umfrage', vorschlag: { text: 'Längsschnitt' } })
    await Literatur.vorschlagBestaetigen(projectId, { quelleId: String(q._id), spalteId: spalte.id })
    zelle = (await Literatur.matrix(projectId)).zeilen[0].zellen[spalte.id]
    expect(zelle).toEqual({ text: 'Längsschnitt', vorschlag: null })
    expect(await fehlerVon(Literatur.vorschlagBestaetigen(projectId, { quelleId: String(q._id), spalteId: spalte.id }))).toMatchObject({
      status: 409,
      typ: 'kein_vorschlag',
    })
  })

  it('verwirft einen Vorschlag', async () => {
    const [q] = await quellen(1)
    const spalte = await Literatur.spalteAnlegen(projectId, 'Methode')
    await Literatur.vorschlagen(projectId, { quelleId: String(q._id), spalte: 'Methode', text: 'X', botId: bot })
    await Literatur.vorschlagVerwerfen(projectId, { quelleId: String(q._id), spalteId: spalte.id })
    expect((await Literatur.matrix(projectId)).zeilen[0].zellen[spalte.id]).toEqual({ text: '', vorschlag: null })
  })

  it('meldet unbekannte Spalten und fremde Quellen', async () => {
    const [q] = await quellen(1)
    const [fremd] = await quellen(1, new ObjectId())
    await Literatur.spalteAnlegen(projectId, 'Methode')
    expect(await fehlerVon(Literatur.vorschlagen(projectId, { quelleId: String(q._id), spalte: 'Gibtsnicht', text: 'x', botId: bot }))).toMatchObject({
      typ: 'spalte_fehlt',
    })
    expect(await fehlerVon(Literatur.vorschlagen(projectId, { quelleId: String(fremd._id), spalte: 'Methode', text: 'x', botId: bot }))).toMatchObject({
      typ: 'quelle_fehlt',
    })
  })

  it('exportiert alle Zeilen als CSV mit Quelle und Spalten', async () => {
    const liste = await quellen(300)
    const spalte = await Literatur.spalteAnlegen(projectId, 'Methode')
    await Literatur.zelleSetzen(projectId, { quelleId: String(liste[1]._id), spalteId: spalte.id, text: '=Formel' })
    const zeilen = (await Literatur.matrixCsv(projectId)).trim().split('\n')
    expect(zeilen).toHaveLength(301)
    expect(zeilen[0]).toBe('Quelle,Key,Methode')
    expect(zeilen[2]).toBe("quelle-001.pdf,q1,'=Formel")
  })
})
