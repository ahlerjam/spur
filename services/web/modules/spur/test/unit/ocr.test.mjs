import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Settings from '@overleaf/settings'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { ObjectId, schalterAttrappe, testDatenbank } from './hilfen/datenbank.mjs'
import { fehlerVon } from './hilfen/fehler.mjs'
import { crossrefAttrappe, fixture } from './hilfen/quellen.mjs'

let datenbank
let Quellen
let schalter
let meldungen
let ocrSeite
const wurzel = mkdtempSync(join(tmpdir(), 'spur-ocr-'))
const compilesVorher = Settings.path.compilesDir
const projekt = new ObjectId()
const anna = new ObjectId()
const SATZ = 'Short naps restore attention in night shift workers.'

beforeAll(async () => {
  datenbank = await testDatenbank()
})
afterAll(async () => {
  await datenbank.schliessen()
  rmSync(wurzel, { recursive: true, force: true })
})
afterEach(() => {
  Settings.path.compilesDir = compilesVorher
  rmSync(join(wurzel, 'spur'), { recursive: true, force: true })
})

beforeEach(async () => {
  await datenbank.leeren()
  Settings.path.compilesDir = join(wurzel, 'compiles')
  schalter = schalterAttrappe()
  meldungen = []
  ocrSeite = undefined
  vi.resetModules()
  vi.doMock('../../../../app/src/infrastructure/mongodb.mjs', () => datenbank.mongodbModul)
  vi.doMock('../../app/src/schalter.mjs', () => schalter.modul)
  vi.doMock('../../app/src/Crossref.mjs', () => crossrefAttrappe().modul)
  vi.doMock('../../app/src/live.mjs', () => ({
    quelleGeaendert: q => meldungen.push(String(q._id)),
    zitateGeaendert: () => {},
  }))
  vi.doMock('../../app/src/pdf.mjs', async original => {
    const echt = await original()
    return { ...echt, ocrSeite: (...args) => (ocrSeite ?? echt.ocrSeite)(...args) }
  })
  Quellen = await import('../../app/src/QuellenManager.mjs')
})

const aufnehmen = (dateiname, fixtureName) =>
  Quellen.aufnehmen({ projectId: projekt, userId: anna, dateiname, tempPfad: fixture(fixtureName), groesse: 1 })

// Echte Texterkennung mit 300 dpi: allein einige Sekunden je Seite, unter der Last der ganzen
// web-Suite (spur-dev upstream web) über eine Minute.
const OCR_ZEIT = 180000

describe('ocrStarten', () => {
  it('erkennt den Text eines Scans, meldet jede Seite und markiert die Quelle als OCR', async () => {
    const scan = await aufnehmen('scan.pdf', 'scan.pdf')
    const { quelle, lauf } = await Quellen.ocrStarten(scan)
    expect(quelle.ocr).toMatchObject({ status: 'laeuft', fertig: 0, gesamt: 2 })
    await lauf
    const fertig = await Quellen.holen(projekt, String(scan._id))
    expect(fertig.status).toBe('ocr')
    expect(fertig.ocr).toMatchObject({ status: 'fertig', fertig: 2, gesamt: 2 })
    expect(fertig.ocr.konfidenz).toBeGreaterThan(80)
    const seite1 = await Quellen.seite(fertig, 1)
    expect(seite1.text.replace(/\s+/g, ' ')).toContain(SATZ)
    expect(seite1.ocrKonfidenz).toBeGreaterThan(80)
    expect((await Quellen.seite(fertig, 2)).ocrKonfidenz).toBeNull()
    expect(meldungen.length).toBeGreaterThanOrEqual(3)
    expect(meldungen.every(id => id === String(scan._id))).toBe(true)
  }, OCR_ZEIT)

  it('macht den erkannten Text durchsuchbar', async () => {
    ocrSeite = async (_pfad, nr) => (nr === 1 ? { text: SATZ, konfidenz: 90 } : { text: '', konfidenz: null })
    const scan = await aufnehmen('scan.pdf', 'scan.pdf')
    await (await Quellen.ocrStarten(scan)).lauf
    const treffer = await Quellen.suchen(projekt, 'restore attention')
    expect(treffer).toHaveLength(1)
    expect(treffer[0]).toMatchObject({ quelleId: scan._id, seite: 1 })
  }, OCR_ZEIT)

  it('lässt eine Quelle ohne erkannten Text bei kein_text', async () => {
    ocrSeite = async () => ({ text: '', konfidenz: null })
    const scan = await aufnehmen('scan.pdf', 'scan.pdf')
    await (await Quellen.ocrStarten(scan)).lauf
    const fertig = await Quellen.holen(projekt, String(scan._id))
    expect(fertig.status).toBe('kein_text')
    expect(fertig.ocr).toMatchObject({ status: 'fertig', konfidenz: null })
  })

  it('merkt sich einen Fehler, statt hängen zu bleiben', async () => {
    ocrSeite = async () => {
      throw new Error('tesseract fehlt')
    }
    const scan = await aufnehmen('scan.pdf', 'scan.pdf')
    await (await Quellen.ocrStarten(scan)).lauf
    const fertig = await Quellen.holen(projekt, String(scan._id))
    expect(fertig.ocr.status).toBe('fehler')
    expect(fertig.status).toBe('kein_text')
    expect(Quellen.ocrZustand(fertig)).toMatchObject({ status: 'fehler' })
  })

  it('startet nicht doppelt, aber nach zehn Minuten Stillstand neu', async () => {
    let freigeben
    ocrSeite = () => new Promise(r => (freigeben = () => r({ text: 'x', konfidenz: 50 })))
    const scan = await aufnehmen('scan.pdf', 'scan.pdf')
    const erster = await Quellen.ocrStarten(scan)
    expect(await fehlerVon(Quellen.ocrStarten(scan))).toMatchObject({ status: 409, typ: 'ocr_laeuft' })
    schalter.zeit = new Date(schalter.zeit.getTime() + 11 * 60 * 1000)
    const haengend = await Quellen.holen(projekt, String(scan._id))
    expect(Quellen.ocrZustand(haengend).status).toBe('abgebrochen')
    ocrSeite = async () => ({ text: 'y', konfidenz: 60 })
    await (await Quellen.ocrStarten(scan)).lauf
    freigeben()
    await erster.lauf
  })

  it('lehnt Quellen ab, die schon Text haben, schon erkannt sind oder Transkripte sind', async () => {
    const pdf = await aufnehmen('smith2024.pdf', 'smith2024.pdf')
    const vtt = await aufnehmen('interview.vtt', 'interview.vtt')
    const scan = await aufnehmen('scan.pdf', 'scan.pdf')
    for (const q of [pdf, vtt, { ...scan, status: 'ocr' }]) {
      expect(await fehlerVon(Quellen.ocrStarten(q))).toMatchObject({ status: 409, typ: 'ocr_unnoetig' })
    }
  })
})

describe('Grenzen', () => {
  it('lässt höchstens zwei Texterkennungen zugleich laufen', async () => {
    const offen = []
    ocrSeite = () => new Promise(r => offen.push(() => r({ text: 'x', konfidenz: 90 })))
    const a = await aufnehmen('a.pdf', 'scan.pdf')
    const b = await aufnehmen('b.pdf', 'scan.pdf')
    const c = await aufnehmen('c.pdf', 'scan.pdf')
    const laeufe = [(await Quellen.ocrStarten(a)).lauf, (await Quellen.ocrStarten(b)).lauf]
    expect(await fehlerVon(Quellen.ocrStarten(c))).toMatchObject({ status: 429, typ: 'ocr_ausgelastet' })
    ocrSeite = async () => ({ text: 'y', konfidenz: 90 })
    for (const weiter of offen) weiter()
    await Promise.all(laeufe)
    await (await Quellen.ocrStarten(c)).lauf
  })

  it('hört auf, wenn die Quelle während der Erkennung gelöscht wird', async () => {
    let aufrufe = 0
    const scan = await aufnehmen('scan.pdf', 'scan.pdf')
    ocrSeite = async () => {
      aufrufe++
      await Quellen.loeschen(scan)
      return { text: 'x', konfidenz: 90 }
    }
    await (await Quellen.ocrStarten(scan)).lauf
    expect(aufrufe).toBe(1)
  })
})

describe('ocrZustand', () => {
  it('ist null ohne OCR und gibt nur die Felder für den Client heraus', () => {
    expect(Quellen.ocrZustand({})).toBeNull()
    const am = schalter.zeit
    expect(Quellen.ocrZustand({ ocr: { status: 'fertig', fertig: 2, gesamt: 2, konfidenz: 91, aktualisiert: am } })).toEqual({ status: 'fertig', fertig: 2, gesamt: 2, konfidenz: 91 })
  })
})
