import { mkdtempSync, existsSync, rmSync } from 'node:fs'
import { readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'
import Settings from '@overleaf/settings'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { ObjectId, schalterAttrappe, testDatenbank } from './hilfen/datenbank.mjs'
import { fehlerVon } from './hilfen/fehler.mjs'
import { crossrefAttrappe, fixture } from './hilfen/quellen.mjs'

let datenbank
let Quellen
let crossref
const wurzel = mkdtempSync(join(tmpdir(), 'spur-quellen-'))
const compilesVorher = Settings.path.compilesDir
const projekt = new ObjectId()
const anna = new ObjectId()

beforeAll(async () => {
  datenbank = await testDatenbank()
})
afterAll(async () => {
  await datenbank.schliessen()
  rmSync(wurzel, { recursive: true, force: true })
})

beforeEach(async () => {
  await datenbank.leeren()
  Settings.path.compilesDir = join(wurzel, 'compiles')
  crossref = crossrefAttrappe()
  vi.resetModules()
  vi.doMock('../../../../app/src/infrastructure/mongodb.mjs', () => datenbank.mongodbModul)
  vi.doMock('../../app/src/schalter.mjs', () => schalterAttrappe().modul)
  vi.doMock('../../app/src/live.mjs', () => ({ quelleGeaendert: () => {}, zitateGeaendert: () => {} }))
  vi.doMock('../../app/src/Crossref.mjs', () => crossref.modul)
  Quellen = await import('../../app/src/QuellenManager.mjs')
})
afterEach(() => {
  Settings.path.compilesDir = compilesVorher
  rmSync(join(wurzel, 'spur'), { recursive: true, force: true })
})

const aufnehmen = (dateiname, fixtureName, extra = {}) =>
  Quellen.aufnehmen({ projectId: projekt, userId: anna, dateiname, tempPfad: fixture(fixtureName), groesse: 1234, ...extra })

describe('aufnehmen', () => {
  it('übernimmt Key, DOI und Metadaten der Aufnahme per DOI', async () => {
    const meta = { gefunden: true, titel: 'Vorgabe', autoren: [], jahr: 2014 }
    const quelle = await aufnehmen('keller2014.pdf', 'smith2024.pdf', { key: 'keller2014', doi: '10.1/vorgabe', meta, nurProjekt: true })
    expect(quelle).toMatchObject({ key: 'keller2014', doi: '10.1/vorgabe', meta, nurProjekt: true })
  })

  it('liest ein PDF mit Text, DOI, Crossref-Daten und gedruckten Seitenzahlen ein', async () => {
    const quelle = await aufnehmen('smith2024.pdf', 'smith2024.pdf')
    expect(quelle).toMatchObject({
      key: 'smith2024',
      art: 'pdf',
      status: 'text',
      seitenzahl: 8,
      doi: '10.5555/spur.2024.001',
      versatz: 344,
      versatzQuelle: 'pagelabels',
      fassung: '',
    })
    expect(quelle.meta.titel).toBe('Sleep and Memory')
    const seiten = await Quellen.seitenVon([quelle._id])
    const liste = seiten.get(String(quelle._id))
    expect(liste.map(s => s.label)).toEqual(['345', '346', '347', '348', '349', '350', '351', '352'])
    expect(liste[2].text).toContain('Sleep supports the consolidation')
    expect(existsSync(Quellen.dateiPfad(quelle))).toBe(true)
  })

  it('übernimmt gedruckte Seitenzahlen nur, wenn Crossref den Seitenbereich bestätigt', async () => {
    crossref.modul.werk = async () => ({ gefunden: true, seiten: '10-12', titel: 'Anderes' })
    const quelle = await aufnehmen('smith2024.pdf', 'smith2024.pdf')
    expect(quelle.versatz).toBeNull()
    expect((await Quellen.seite(quelle, 1)).label).toBeNull()
  })

  it('markiert einen Scan ohne Text als kein_text und fragt Crossref nicht', async () => {
    const quelle = await aufnehmen('scan.pdf', 'scan.pdf')
    expect(quelle).toMatchObject({ status: 'kein_text', doi: null, meta: null, seitenzahl: 2 })
    expect(crossref.abfragen).toEqual([])
  })

  it('liest ein VTT-Transkript mit Zeitmarken als Seiten', async () => {
    const quelle = await aufnehmen('interview.vtt', 'interview.vtt')
    expect(quelle).toMatchObject({ art: 'vtt', status: 'text', seitenzahl: 3, versatz: null })
    expect((await Quellen.seite(quelle, 2)).label).toBe('00:00:06')
  })

  it('weist andere Dateitypen mit 415 ab', async () => {
    const fehler = await fehlerVon(aufnehmen('notizen.docx', 'smith2024.pdf'))
    expect(fehler).toMatchObject({ status: 415, typ: 'dateityp' })
  })

  it('weist ein kaputtes PDF mit 422 ab und legt nichts an', async () => {
    const fehler = await fehlerVon(aufnehmen('kaputt.pdf', 'interview.vtt'))
    expect(fehler).toMatchObject({ status: 422, typ: 'datei_unlesbar' })
    expect(await datenbank.db.collection('spurSources').countDocuments()).toBe(0)
  })

  it('weist denselben Dateinamen im selben Projekt mit 409 ab, in einem anderen Projekt nicht', async () => {
    await aufnehmen('smith2024.pdf', 'smith2024.pdf')
    const fehler = await fehlerVon(aufnehmen('smith2024.pdf', 'smith2024.pdf'))
    expect(fehler).toMatchObject({ status: 409, typ: 'quelle_vorhanden' })
    await aufnehmen('smith2024.pdf', 'smith2024.pdf', { projectId: new ObjectId() })
  })

  it('bildet den Schlüssel aus dem Dateinamen und ersetzt Sonderzeichen', async () => {
    const quelle = await aufnehmen('Müller & Co (2020).pdf', 'scan.pdf')
    expect(quelle.key).toBe('Müller---Co--2020-')
  })
})

describe('Abfragen', () => {
  let smith
  let interview
  beforeEach(async () => {
    smith = await aufnehmen('smith2024.pdf', 'smith2024.pdf')
    interview = await aufnehmen('interview.vtt', 'interview.vtt')
  })

  it('liste liefert die Quellen des Projekts nach Dateiname, seitenweise', async () => {
    await aufnehmen('scan.pdf', 'scan.pdf', { projectId: new ObjectId() })
    const ergebnis = await Quellen.liste(projekt)
    expect(ergebnis.quellen.map(q => q.dateiname)).toEqual(['interview.vtt', 'smith2024.pdf'])
    expect(ergebnis).toMatchObject({ gesamt: 2, seitengroesse: 100 })
    expect((await Quellen.liste(projekt, { seite: 1 })).quellen).toEqual([])
    expect((await Quellen.alle(projekt)).length).toBe(2)
  })

  it('holen findet nur Quellen des eigenen Projekts und gültige IDs', async () => {
    expect((await Quellen.holen(projekt, String(smith._id)))._id).toEqual(smith._id)
    for (const [p, id] of [[new ObjectId(), String(smith._id)], [projekt, 'quatsch'], [projekt, String(new ObjectId())]]) {
      expect(await fehlerVon(Quellen.holen(p, id))).toMatchObject({ status: 404, typ: 'quelle_fehlt' })
    }
  })

  it('seite liefert eine Seite oder 404', async () => {
    expect((await Quellen.seite(smith, 3)).text).toContain('Sleep supports')
    expect(await fehlerVon(Quellen.seite(smith, 99))).toMatchObject({ status: 404, typ: 'seite_fehlt' })
  })

  it('suchen findet die Phrase mit PDF-Seite, gedruckter Seite und Position', async () => {
    const treffer = await Quellen.suchen(projekt, 'consolidation of declarative memory')
    expect(treffer).toHaveLength(1)
    expect(treffer[0]).toMatchObject({ dateiname: 'smith2024.pdf', art: 'pdf', seite: 3, label: '347' })
    expect(treffer[0].position).toBe(19)
    expect(treffer[0].auszug).toContain('Sleep supports the consolidation')
    expect(treffer[0].quelle).toMatchObject({ _id: smith._id, dateiname: 'smith2024.pdf' })
  })

  it('suchen sucht wörtlich, auch mit Anführungszeichen, und findet in Transkripten', async () => {
    expect(await Quellen.suchen(projekt, '"memory" "traces"')).toEqual([])
    const treffer = await Quellen.suchen(projekt, 'night shifts')
    expect(treffer.map(t => t.dateiname)).toEqual(['interview.vtt'])
    expect(treffer[0].label).toBe('00:00:01')
  })

  it('suchen bleibt im Projekt', async () => {
    expect(await Quellen.suchen(new ObjectId(), 'night shifts')).toEqual([])
  })

  it('dateinamenSuchen ignoriert Groß-/Kleinschreibung und behandelt Sonderzeichen wörtlich', async () => {
    expect((await Quellen.dateinamenSuchen(projekt, 'SMITH')).map(q => q.dateiname)).toEqual(['smith2024.pdf'])
    expect(await Quellen.dateinamenSuchen(projekt, '.*')).toEqual([])
    expect(await Quellen.dateinamenSuchen(projekt, 'i', 1)).toHaveLength(1)
  })

  it('bild rendert eine PDF-Seite einmal und nimmt sie danach aus dem Ablageordner', async () => {
    const pfad = await Quellen.bild(smith, 2)
    expect(pfad).toMatch(/\.png$/)
    expect(existsSync(pfad)).toBe(true)
    expect(await Quellen.bild(smith, 2)).toBe(pfad)
  })

  it('bild legt je Breite ein eigenes Bild ab', async () => {
    const schmal = await Quellen.bild(smith, 2)
    const breit = await Quellen.bild(smith, 2, 1600)
    expect(breit).not.toBe(schmal)
    expect(breit).toMatch(/-w1600\.png$/)
  })

  it('textEbene gibt es nur bei erkanntem Text', async () => {
    expect((await Quellen.textEbene(smith, 1)).zeilen.length).toBeGreaterThan(5)
    expect(await Quellen.textEbene({ ...smith, status: 'ocr' }, 1)).toEqual({ breite: null, hoehe: null, zeilen: [] })
  })

  it('projekteMitQuellen nennt Projekte des Nutzers, die Quellen haben', async () => {
    const projekte = datenbank.db.collection('projects')
    const mitQuellen = { _id: projekt, name: 'Mit Quellen', owner_ref: anna }
    const ohne = { _id: new ObjectId(), name: 'Ohne', collaberator_refs: [anna] }
    const fremd = { _id: new ObjectId(), name: 'Fremd', owner_ref: new ObjectId() }
    await projekte.insertMany([mitQuellen, ohne, fremd])
    await aufnehmen('scan.pdf', 'scan.pdf', { projectId: fremd._id })
    expect(await Quellen.projekteMitQuellen(anna, new ObjectId())).toEqual([{ id: projekt, name: 'Mit Quellen' }])
    expect(await Quellen.projekteMitQuellen(anna, projekt)).toEqual([])
  })

  it('zipSchreiben packt alle Quelldateien unter ihrem Dateinamen', async () => {
    const ausgabe = new PassThrough()
    const stuecke = []
    ausgabe.on('data', s => stuecke.push(s))
    const ende = new Promise(fertig => ausgabe.on('end', fertig))
    await Quellen.zipSchreiben(projekt, ausgabe)
    await ende
    const zip = Buffer.concat(stuecke)
    expect(zip.subarray(0, 2).toString()).toBe('PK')
    expect(zip.toString('latin1')).toContain('smith2024.pdf')
    expect(zip.toString('latin1')).toContain('interview.vtt')
    expect(interview.dateiname).toBe('interview.vtt')
  })
})

describe('aendern', () => {
  it('speichert die Fassung', async () => {
    const quelle = await aufnehmen('smith2024.pdf', 'smith2024.pdf')
    const neu = await Quellen.aendern(quelle, { fassung: 'Preprint' })
    expect(neu.fassung).toBe('Preprint')
    expect((await Quellen.holen(projekt, String(quelle._id))).fassung).toBe('Preprint')
  })

  it('setzt einen bestätigten Versatz und lässt Vorspannseiten ohne Label', async () => {
    const quelle = await aufnehmen('scan.pdf', 'scan.pdf')
    const neu = await Quellen.aendern(quelle, { versatz: -1 })
    expect(neu).toMatchObject({ versatz: -1, versatzQuelle: 'bestaetigt' })
    expect([(await Quellen.seite(quelle, 1)).label, (await Quellen.seite(quelle, 2)).label]).toEqual([null, '1'])
  })

  it('entfernt den Versatz samt Labels mit null', async () => {
    const quelle = await aufnehmen('smith2024.pdf', 'smith2024.pdf')
    const neu = await Quellen.aendern(quelle, { versatz: null })
    expect(neu).toMatchObject({ versatz: null, versatzQuelle: null })
    expect((await Quellen.seite(quelle, 3)).label).toBeNull()
  })
})

describe('Löschen und Aufräumen', () => {
  it('loeschen entfernt Dokument, Seiten, Zitate und Dateien, aber keine fremden', async () => {
    const eins = await aufnehmen('smith2024.pdf', 'smith2024.pdf')
    const zwei = await aufnehmen('scan.pdf', 'scan.pdf')
    await datenbank.db.collection('spurQuotes').insertMany([{ quelleId: eins._id }, { quelleId: zwei._id }])
    await Quellen.bild(eins, 1)
    await Quellen.loeschen(eins)
    expect(await datenbank.db.collection('spurSources').countDocuments()).toBe(1)
    expect(await datenbank.db.collection('spurSourcePages').countDocuments({ quelleId: eins._id })).toBe(0)
    expect(await datenbank.db.collection('spurQuotes').countDocuments()).toBe(1)
    expect(await readdir(join(wurzel, 'spur', String(projekt)))).toEqual([`${zwei._id}.pdf`])
  })

  it('projektAufraeumen entfernt alles zum Projekt und lässt andere Projekte in Ruhe', async () => {
    const fremd = new ObjectId()
    const quelle = await aufnehmen('smith2024.pdf', 'smith2024.pdf')
    await aufnehmen('scan.pdf', 'scan.pdf', { projectId: fremd })
    for (const name of ['spurQuotes', 'spurCheckSections', 'spurMessages', 'spurEvents', 'spurRuns', 'spurEdits', 'spurSettings', 'spurSuggestions']) {
      await datenbank.db.collection(name).insertMany([
        { projectId: projekt, hash: 'a', quelleId: quelle._id, botId: 'a', schluessel: 'a', status: 'fertig' },
        { projectId: fremd, hash: 'b', botId: 'b', schluessel: 'b', status: 'fertig' },
      ])
    }
    await datenbank.db.collection('spurClones').insertOne({ _id: projekt, vonProjekt: fremd })
    await Quellen.projektAufraeumen(String(projekt))
    for (const name of ['spurSources', 'spurSourcePages', 'spurQuotes', 'spurCheckSections', 'spurMessages', 'spurEvents', 'spurRuns', 'spurEdits', 'spurSettings', 'spurSuggestions']) {
      expect(await datenbank.db.collection(name).countDocuments({ projectId: projekt }), name).toBe(0)
      expect(await datenbank.db.collection(name).countDocuments({ projectId: fremd }), name).toBeGreaterThan(0)
    }
    expect(await datenbank.db.collection('spurClones').countDocuments()).toBe(0)
    expect(existsSync(join(wurzel, 'spur', String(projekt)))).toBe(false)
  })
})

describe('Klone und Übernehmen', () => {
  it('klonMerken vermerkt nur Klone von Projekten mit Quellen, klonHinweis nennt das Original', async () => {
    const original = { _id: projekt, name: 'Original' }
    await datenbank.db.collection('projects').insertOne(original)
    const leer = new ObjectId()
    await Quellen.klonMerken(String(leer), new ObjectId())
    expect(await datenbank.db.collection('spurClones').countDocuments()).toBe(0)

    await aufnehmen('scan.pdf', 'scan.pdf')
    const klon = new ObjectId()
    await Quellen.klonMerken(String(projekt), klon)
    expect(await Quellen.klonHinweis(klon)).toEqual({ id: projekt, name: 'Original' })
    expect(await Quellen.klonHinweis(new ObjectId())).toBeNull()
  })

  it('uebernehmen kopiert Quellen samt Seiten, Zitaten und Datei, ohne Dubletten', async () => {
    const quelle = await aufnehmen('smith2024.pdf', 'smith2024.pdf')
    await aufnehmen('scan.pdf', 'scan.pdf')
    await datenbank.db.collection('spurQuotes').insertOne({ projectId: projekt, quelleId: quelle._id, text: 'Zitat', seite: 3 })
    const ziel = new ObjectId()
    await aufnehmen('scan.pdf', 'scan.pdf', { projectId: ziel })
    await datenbank.db.collection('spurClones').insertOne({ _id: ziel, vonProjekt: projekt })

    expect(await Quellen.uebernehmen(ziel, projekt, anna)).toBe(1)

    const kopie = (await Quellen.alle(ziel)).find(q => q.key === 'smith2024')
    expect(kopie._id).not.toEqual(quelle._id)
    expect(kopie.projectId).toEqual(ziel)
    expect((await Quellen.seite(kopie, 3)).text).toContain('Sleep supports')
    expect(await datenbank.db.collection('spurQuotes').countDocuments({ projectId: ziel, quelleId: kopie._id })).toBe(1)
    expect(existsSync(Quellen.dateiPfad(kopie))).toBe(true)
    expect(await datenbank.db.collection('spurClones').countDocuments()).toBe(0)
    expect(await Quellen.uebernehmen(ziel, projekt, anna)).toBe(0)
  })

  it('loeschen öffnet einen damit beschafften Eintrag der Beschaffungsliste wieder', async () => {
    const quelle = await aufnehmen('smith2024.pdf', 'smith2024.pdf')
    await datenbank.db.collection('spurAcquisitions').insertOne({ projectId: projekt, doi: '10.5555/x', status: 'beschafft', quelleId: quelle._id })
    await Quellen.loeschen(quelle)
    const eintrag = await datenbank.db.collection('spurAcquisitions').findOne({ doi: '10.5555/x' })
    expect(eintrag.status).toBe('offen')
    expect(eintrag.quelleId).toBeUndefined()
  })

  it('uebernehmen lässt Volltexte ohne Lizenz zur Weitergabe im Projekt', async () => {
    await aufnehmen('smith2024.pdf', 'smith2024.pdf', { nurProjekt: true })
    const ziel = new ObjectId()
    expect(await Quellen.uebernehmen(ziel, projekt, anna)).toBe(0)
    expect(await Quellen.alle(ziel)).toEqual([])
    expect(await Quellen.projekteMitQuellen(anna, ziel)).toEqual([])
  })

  it('uebernehmen lässt Kommentare, Zuweisungen und eine laufende Texterkennung des alten Projekts zurück', async () => {
    const quelle = await aufnehmen('smith2024.pdf', 'smith2024.pdf')
    const scan = await aufnehmen('scan.pdf', 'scan.pdf')
    await datenbank.db.collection('spurSources').updateOne({ _id: scan._id }, { $set: { ocr: { status: 'laeuft', fertig: 0, gesamt: 2 } } })
    const bestaetigt = { von: anna, am: new Date(0) }
    await datenbank.db.collection('spurQuotes').insertOne({
      projectId: projekt, quelleId: quelle._id, text: 'Zitat', seite: 3, angelegtVon: anna,
      kommentare: [{ von: anna, text: 'intern' }], zugewiesen: { an: anna, von: anna }, bestaetigt,
    })
    const ziel = new ObjectId()
    expect(await Quellen.uebernehmen(ziel, projekt, anna)).toBe(2)
    const [kopie] = await datenbank.db.collection('spurQuotes').find({ projectId: ziel }).toArray()
    expect(kopie).toMatchObject({ text: 'Zitat', kommentare: [], zugewiesen: null, bestaetigt })
    const scanKopie = (await Quellen.alle(ziel)).find(q => q.key === 'scan')
    expect(scanKopie.ocr).toBeNull()
  })
})
