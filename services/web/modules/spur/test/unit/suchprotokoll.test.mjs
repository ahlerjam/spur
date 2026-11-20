import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { ObjectId, schalterAttrappe, testDatenbank } from './hilfen/datenbank.mjs'
import { fehlerVon } from './hilfen/fehler.mjs'
import { meldung } from '../../app/src/meldungen.mjs'

let Protokoll
let datenbank
let schalter

const projectId = new ObjectId()
const userId = new ObjectId()

beforeAll(async () => {
  datenbank = await testDatenbank()
})
afterAll(async () => await datenbank.schliessen())

beforeEach(async () => {
  await datenbank.leeren()
  schalter = schalterAttrappe()
  vi.resetModules()
  vi.doMock('../../../../app/src/infrastructure/mongodb.mjs', () => datenbank.mongodbModul)
  vi.doMock('../../app/src/schalter.mjs', () => schalter.modul)
  Protokoll = await import('../../app/src/recherche/Suchprotokoll.mjs')
})

const treffer = (doi, titel = `Titel ${doi}`, jahr = 2020) => ({ doi, titel, jahr })
const dienst = (name, anzahl, antwort = 'geantwortet') => ({ dienst: name, antwort, versuche: 1, treffer: anzahl, gesamt: anzahl })
// Die Dienste liefern zusammen `je` Treffer; `liste` sind sie nach dem Zusammenführen.
const anfrage = (text, seite, je, liste, pid = projectId) =>
  Protokoll.festhalten({ projectId: pid, userId, anfrage: text, seite, dienste: Object.entries(je).map(([n, a]) => dienst(n, a)), treffer: liste })
const quelle = doi => datenbank.db.collection('spurSources').insertOne({ projectId, doi, key: doi })
const aufListe = (doi, felder = {}) => datenbank.db.collection('spurAcquisitions').insertOne({ projectId, doi, status: 'offen', ...felder })
const ausschliessen = (felder, grund) => Protokoll.ausschliessen({ projectId, userId, grund, ...felder })

// Drei Anfragen: 3 + 2 Treffer mit einer gemeinsamen DOI, eine Folgeseite mit 2 neuen, eine zweite Suche mit 2 Treffern,
// davon einer schon bekannt.
async function dreiAnfragen() {
  await anfrage('sleep memory', 0, { OpenAlex: 3, 'Semantic Scholar': 2 }, ['10.1/a', '10.1/b', '10.1/c', '10.1/d'].map(d => treffer(d)))
  await anfrage('sleep memory', 1, { OpenAlex: 2, 'Semantic Scholar': 0 }, ['10.1/e', '10.1/f'].map(d => treffer(d)))
  await anfrage('slow-wave sleep', 0, { OpenAlex: 2, 'Semantic Scholar': 0 }, ['10.1/g', '10.1/a'].map(d => treffer(d)))
}

describe('festhalten und liste', () => {
  it('liefert die Anfragen in zeitlicher Folge mit Seite, Status und Trefferzahl je Dienst', async () => {
    await dreiAnfragen()
    const { eintraege, gesamt, weiter } = await Protokoll.liste(projectId, { aufsteigend: true })
    expect([gesamt, weiter]).toEqual([3, false])
    expect(eintraege.map(e => [e.anfrage, e.seite, e.treffer, e.dubletten])).toEqual([
      ['sleep memory', 0, 5, 1],
      ['sleep memory', 1, 2, 0],
      ['slow-wave sleep', 0, 2, 1],
    ])
    expect(eintraege[0]).toEqual({
      zeit: expect.any(Date),
      anfrage: 'sleep memory',
      seite: 0,
      filter: null,
      dienste: [
        { dienst: 'OpenAlex', status: 'geantwortet', treffer: 3, versuche: 1 },
        { dienst: 'Semantic Scholar', status: 'geantwortet', treffer: 2, versuche: 1 },
      ],
      treffer: 5,
      dubletten: 1,
    })
  })

  it('zeigt im Web die neuesten zuerst und blättert in Seiten zu 50', async () => {
    for (let i = 0; i < 52; i++) {
      schalter.zeit = new Date(Date.UTC(2026, 10, 1, 8, i)).toISOString()
      await anfrage(`suche ${i}`, 0, { OpenAlex: 0 }, [])
    }
    const erste = await Protokoll.liste(projectId)
    expect(erste.eintraege).toHaveLength(50)
    expect([erste.eintraege[0].anfrage, erste.weiter]).toEqual(['suche 51', true])
    const zweite = await Protokoll.liste(projectId, { ab: 50 })
    expect(zweite.eintraege.map(e => e.anfrage)).toEqual(['suche 1', 'suche 0'])
    expect(zweite.weiter).toBe(false)
  })

  it('verträgt gleichzeitige Suchen mit denselben Treffern und zählt jeden Treffer einmal', async () => {
    const liste = Array.from({ length: 40 }, (_, i) => treffer(`10.1/p${i}`))
    await Promise.all(Array.from({ length: 8 }, (_, i) => anfrage(`parallel ${i}`, 0, { OpenAlex: 40 }, liste)))
    const eintraege = await datenbank.db.collection('spurSearchLog').find({ projectId }).toArray()
    expect(eintraege).toHaveLength(8)
    expect(eintraege.reduce((summe, e) => summe + e.neu, 0)).toBe(40)
    expect(await Protokoll.prisma(projectId)).toMatchObject({ identifiziert: 320, gesichtet: 40, dubletten: 280 })
  })

  it('kennt nur das eigene Projekt', async () => {
    await anfrage('fremd', 0, { OpenAlex: 1 }, [treffer('10.1/a')], new ObjectId())
    expect((await Protokoll.liste(projectId)).eintraege).toEqual([])
    expect(await Protokoll.prisma(projectId)).toMatchObject({ identifiziert: 0, gesichtet: 0, offen: 0 })
  })
})

describe('prisma', () => {
  it('zählt identifiziert, Dubletten und gesichtet; es gilt identifiziert − dubletten = gesichtet', async () => {
    await dreiAnfragen()
    const prisma = await Protokoll.prisma(projectId)
    expect(prisma).toEqual({
      identifiziert: 9,
      identifiziert_nach_dienst: { OpenAlex: 7, 'Semantic Scholar': 2 },
      dubletten: 2,
      gesichtet: 7,
      aufgenommen: 0,
      ausgeschlossen: { gesamt: 0, nach_grund: {} },
      nicht_beschaffbar: {},
      offen: 7,
    })
    expect(prisma.identifiziert - prisma.dubletten).toBe(prisma.gesichtet)
  })

  it('ordnet jedem Treffer eine Entscheidung zu: aufgenommen, ausgeschlossen, nicht beschaffbar oder offen', async () => {
    await dreiAnfragen()
    await quelle('10.1/a')
    await quelle('10.1/B')
    await ausschliessen({ doi: '10.1/c' }, 'falsche Population')
    await ausschliessen({ doi: '10.1/d' }, 'falsche Population')
    await ausschliessen({ doi: '10.1/e' }, 'kein empirischer Beitrag')
    await aufListe('10.1/f', { grund: 'nicht_frei' })
    const prisma = await Protokoll.prisma(projectId)
    expect(prisma).toMatchObject({
      aufgenommen: 2,
      ausgeschlossen: { gesamt: 3, nach_grund: { 'falsche Population': 2, 'kein empirischer Beitrag': 1 } },
      nicht_beschaffbar: { nicht_frei: 1 },
      offen: 1,
    })
    expect(prisma.aufgenommen + prisma.ausgeschlossen.gesamt + 1 + prisma.offen).toBe(prisma.gesichtet)
  })

  it('nennt bei nicht beschaffbaren Treffern den Grund des Listeneintrags, sonst den des gescheiterten Downloads', async () => {
    await dreiAnfragen()
    await aufListe('10.1/a', { grund: 'bot_schutz' })
    await aufListe('10.1/b')
    await Protokoll.aufnahmeFehlerMerken(projectId, '10.1/C', 'pdf_fehlt')
    await aufListe('10.1/c')
    // Beschaffte Einträge und DOIs, die in keiner Suche vorkamen, zählen nicht.
    await datenbank.db.collection('spurAcquisitions').insertOne({ projectId, doi: '10.1/d', status: 'beschafft' })
    await aufListe('10.9/nie-gesucht', { grund: 'nicht_frei' })
    expect((await Protokoll.prisma(projectId)).nicht_beschaffbar).toEqual({ bot_schutz: 1, nicht_frei: 1, pdf_fehlt: 1 })
  })

  it('zählt eine Quelle als aufgenommen, auch wenn der Treffer ausgeschlossen war oder auf der Liste steht', async () => {
    await dreiAnfragen()
    await ausschliessen({ doi: '10.1/a' }, 'Dublette')
    await aufListe('10.1/a', { grund: 'nicht_frei' })
    await quelle('10.1/a')
    expect(await Protokoll.prisma(projectId)).toMatchObject({ aufgenommen: 1, ausgeschlossen: { gesamt: 0 }, nicht_beschaffbar: {}, offen: 6 })
  })

  it('erkennt Dubletten ohne DOI über Titel und Jahr, ohne Groß- und Kleinschreibung und Satzzeichen', async () => {
    await anfrage('thesis', 0, { OpenAlex: 2, Crossref: 2 }, [
      { doi: null, titel: 'Generative AI: Adoption in a Large Enterprise', jahr: 2024 },
      { doi: null, titel: 'Generative AI adoption in a large enterprise', jahr: 2023 },
      { doi: null, titel: null, jahr: null },
    ])
    await anfrage('thesis again', 0, { OpenAlex: 3 }, [
      { doi: null, titel: 'generative ai adoption in a large enterprise!', jahr: 2024 },
      { doi: null, titel: null, jahr: null },
    ])
    // Gleicher Titel und gleiches Jahr ist eine Dublette, ein anderes Jahr nicht; ohne DOI und Titel zählt jeder Treffer für sich.
    expect(await Protokoll.prisma(projectId)).toMatchObject({ identifiziert: 7, gesichtet: 4, dubletten: 3 })
  })

  it('zählt Einträge von vor P12 mit dem, was sie haben: als identifiziert, gesichtet und offen', async () => {
    await datenbank.db.collection('spurSearchLog').insertMany([
      { projectId, userId, datum: new Date('2026-11-01T10:00:00Z'), dienst: 'OpenAlex', anfrage: 'sleep', treffer: 25 },
      { projectId, userId, datum: new Date('2026-11-01T10:00:00Z'), dienst: 'Crossref', anfrage: 'sleep', treffer: 1 },
    ])
    await anfrage('sleep memory', 0, { OpenAlex: 2 }, [treffer('10.1/a')])
    const prisma = await Protokoll.prisma(projectId)
    expect(prisma).toMatchObject({ identifiziert: 28, identifiziert_nach_dienst: { OpenAlex: 27, Crossref: 1 }, dubletten: 1, gesichtet: 27, offen: 27 })
    const { eintraege } = await Protokoll.liste(projectId, { aufsteigend: true })
    expect(eintraege[0]).toEqual({
      zeit: new Date('2026-11-01T10:00:00Z'),
      anfrage: 'sleep',
      seite: 0,
      filter: null,
      dienste: [{ dienst: 'OpenAlex', status: 'geantwortet', treffer: 25 }],
      treffer: 25,
      dubletten: null,
    })
  })
})

describe('ausschliessen', () => {
  beforeEach(dreiAnfragen)

  it('schließt einen Treffer per DOI mit Grund aus und ersetzt den Grund beim zweiten Mal', async () => {
    expect(await ausschliessen({ doi: '10.1/C' }, 'falsche Population')).toEqual({ doi: '10.1/c', titel: 'Titel 10.1/c', grund: 'falsche Population' })
    await ausschliessen({ doi: '10.1/c' }, 'kein empirischer Beitrag')
    expect((await Protokoll.prisma(projectId)).ausgeschlossen).toEqual({ gesamt: 1, nach_grund: { 'kein empirischer Beitrag': 1 } })
  })

  it('findet einen Treffer ohne DOI über den Titel', async () => {
    await anfrage('thesis', 0, { OpenAlex: 1 }, [{ doi: null, titel: 'Generative AI adoption', jahr: 2024 }])
    expect(await ausschliessen({ titel: 'generative AI Adoption.' }, 'Abschlussarbeit')).toMatchObject({ doi: null, titel: 'Generative AI adoption' })
    expect((await Protokoll.prisma(projectId)).ausgeschlossen.nach_grund).toEqual({ Abschlussarbeit: 1 })
  })

  it('meldet 404 treffer_nicht_gefunden für eine DOI oder einen Titel, die in keiner Suche vorkamen', async () => {
    for (const felder of [{ doi: '10.9/nie-gesucht' }, { titel: 'Nie gesehen' }, { titel: '…' }]) {
      expect(await fehlerVon(ausschliessen(felder, 'egal'))).toMatchObject({
        status: 404,
        typ: 'treffer_nicht_gefunden',
        message: meldung('spur_fehler_treffer_nicht_gefunden'),
      })
    }
    expect((await Protokoll.prisma(projectId)).ausgeschlossen.gesamt).toBe(0)
  })

  it('schließt keinen Treffer eines anderen Projekts aus', async () => {
    const fehler = await fehlerVon(Protokoll.ausschliessen({ projectId: new ObjectId(), userId, doi: '10.1/a', grund: 'x' }))
    expect(fehler).toMatchObject({ typ: 'treffer_nicht_gefunden' })
  })
})

describe('alsCsv', () => {
  it('schreibt je Anfrage eine Zeile mit Seite, Status und Treffern je Dienst und am Ende die Summen', async () => {
    schalter.zeit = '2026-11-16T10:00:00Z'
    await dreiAnfragen()
    await quelle('10.1/a')
    await ausschliessen({ doi: '10.1/c' }, 'falsche Population')
    await aufListe('10.1/f', { grund: 'bot_schutz' })
    const zeilen = (await Protokoll.alsCsv(projectId)).trim().split('\n')
    expect(zeilen[0]).toBe(
      'Datum,Anfrage,Seite,Filter,arXiv: Status,arXiv: Treffer,OpenAlex: Status,OpenAlex: Treffer,Crossref: Status,Crossref: Treffer,Semantic Scholar: Status,Semantic Scholar: Treffer,Treffer,Dubletten'
    )
    expect(zeilen.slice(1, 4)).toContain('2026-11-16T10:00:00.000Z,sleep memory,0,,,,geantwortet,3,,,geantwortet,2,5,1')
    expect(zeilen.slice(4)).toEqual([
      'Summe: identifiziert,9',
      'Summe: Dubletten,2',
      'Summe: gesichtet,7',
      'Summe: aufgenommen,1',
      'Summe: ausgeschlossen,1',
      'Summe: ausgeschlossen (falsche Population),1',
      'Summe: nicht beschaffbar,1',
      '"Summe: nicht beschaffbar (frei, Download blockiert)",1',
      'Summe: offen,4',
    ])
  })

  it('entschärft Formeln in Anfrage und Grund', async () => {
    await anfrage('=HYPERLINK("x")', 0, { OpenAlex: 1 }, [treffer('10.1/a')])
    await ausschliessen({ doi: '10.1/a' }, '=1+1')
    const csv = await Protokoll.alsCsv(projectId)
    expect(csv).toContain(`"'=HYPERLINK(""x"")"`)
    expect(csv).toContain('Summe: ausgeschlossen (=1+1)')
  })
})
