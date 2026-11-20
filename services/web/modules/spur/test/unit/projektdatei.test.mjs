// Bilddateien im Projekt: eigene Bilder (file_upload_link) und Ausschnitte aus Quellen (source_figure_add).
import fs from 'node:fs/promises'
import os from 'node:os'
import Path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { ObjectId } from './hilfen/datenbank.mjs'
import { fehlerVon } from './hilfen/fehler.mjs'
import { meldung } from '../../app/src/meldungen.mjs'

const FIXTURES = fileURLToPath(new URL('../fixtures/', import.meta.url))
const projectId = new ObjectId()
const menschId = new ObjectId()
const botId = new ObjectId()
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13])
const JPG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16])

let ordner
let projektOrdner
let baum
let lauf
let eintraege
let D

beforeAll(async () => {
  ordner = await fs.mkdtemp(Path.join(os.tmpdir(), 'spur-unit-projektdatei-'))
})
afterAll(async () => await fs.rm(ordner, { recursive: true, force: true }))

beforeEach(async () => {
  baum = new Map()
  projektOrdner = ['/']
  lauf = { _id: new ObjectId(), angelegt: [] }
  eintraege = 0
  vi.resetModules()
  vi.doMock('../../../../app/src/Features/Editor/EditorController.mjs', () => ({
    default: {
      promises: {
        upsertFileWithPath: vi.fn(async (_p, pfad, datei) => baum.set(pfad, await fs.readFile(datei))),
      },
    },
  }))
  vi.doMock('../../../../app/src/Features/Project/ProjectEntityHandler.mjs', () => ({
    default: {
      promises: {
        getAllEntities: async () => ({ docs: [{ path: '/main.tex' }], files: [...baum.keys()].map(path => ({ path })), folders: projektOrdner.map(path => ({ path })) }),
      },
    },
  }))
  vi.doMock('../../app/src/projektEintraege.mjs', () => ({ anzahlEintraege: async () => eintraege, maxEintraege: () => 2000 }))
  vi.doMock('../../app/src/Speicher.mjs', () => ({ reservieren: vi.fn(async () => async () => {}) }))
  vi.doMock('../../app/src/QuellenManager.mjs', () => ({
    dateiPfad: () => Path.join(FIXTURES, 'smith2024.pdf'),
    seitePruefen: vi.fn(),
  }))
  vi.doMock('../../app/src/schreiben/LaufManager.mjs', () => ({
    laufFuerSchreiben: async () => lauf,
    angelegtMerken: async (l, neu) => l.angelegt.push(...neu),
  }))
  D = await import('../../app/src/hochladen/Projektdatei.mjs')
})

async function datei(name, inhalt) {
  const pfad = Path.join(ordner, name)
  await fs.writeFile(pfad, inhalt)
  return pfad
}

const anlegen = async (pfad, inhalt, groesse = inhalt.length) =>
  D.anlegen({ projectId, menschId, botId, pfad, datei: await datei(`up-${Math.random()}`, inhalt), groesse })

describe('dateityp', () => {
  it('erkennt PNG, JPEG und PDF am Dateianfang, nicht an der Endung', async () => {
    expect(await D.dateityp(await datei('a.bin', PNG))).toBe('png')
    expect(await D.dateityp(await datei('b.bin', JPG))).toBe('jpg')
    expect(await D.dateityp(await datei('c.png', '%PDF-1.4\n'))).toBe('pdf')
    expect(await D.dateityp(await datei('bild.png', 'Nur Text, umbenannt.\n'))).toBe(null)
    expect(await D.dateityp(await datei('leer.png', ''))).toBe(null)
  })
})

describe('anlegen', () => {
  it('legt die Datei an und verbucht sie samt neuem Ordner im Lauf', async () => {
    expect(await anlegen('abbildungen/diagramm.png', PNG)).toEqual({ pfad: 'abbildungen/diagramm.png' })
    expect([...baum.keys()]).toEqual(['/abbildungen/diagramm.png'])
    expect(lauf.angelegt).toEqual([{ art: 'datei', pfad: 'abbildungen/diagramm.png', ordner: 'abbildungen' }])
  })

  it('merkt die Datei am Lauf vor dem Schreiben, damit „Lauf rückgängig“ sie auch nach einem Fehler findet', async () => {
    const reihenfolge = []
    const { default: EditorController } = await import('../../../../app/src/Features/Editor/EditorController.mjs')
    EditorController.promises.upsertFileWithPath.mockImplementationOnce(async () => reihenfolge.push('schreiben'))
    lauf.angelegt = { push: () => reihenfolge.push('merken') }
    await anlegen('a.png', PNG)
    expect(reihenfolge).toEqual(['merken', 'schreiben'])
  })

  it('verbucht einen vorhandenen Ordner nicht', async () => {
    await anlegen('abbildungen/a.png', PNG)
    await anlegen('abbildungen/b.jpg', JPG)
    expect(lauf.angelegt[1]).toEqual({ art: 'datei', pfad: 'abbildungen/b.jpg' })
  })

  it('verbucht einen vorhandenen leeren Ordner nicht als neu (Code-Review)', async () => {
    projektOrdner = ['/', '/abbildungen']
    await anlegen('abbildungen/a.png', PNG)
    expect(lauf.angelegt).toEqual([{ art: 'datei', pfad: 'abbildungen/a.png' }])
  })

  it('legt nichts unter tex-pakete/ an, dort liegen Pakete aus tex_package_add', async () => {
    expect(await fehlerVon(anlegen('tex-pakete/foo/a.png', PNG))).toMatchObject({ status: 422, typ: 'eingabe_ungueltig' })
  })

  it('lehnt einen vorhandenen Pfad mit konflikt ab', async () => {
    await anlegen('abbildungen/a.png', PNG)
    expect(await fehlerVon(anlegen('abbildungen/a.png', PNG))).toMatchObject({ status: 409, typ: 'konflikt' })
    expect(await fehlerVon(anlegen('main.tex.png', PNG).then(() => anlegen('main.tex.png', PNG)))).toMatchObject({ typ: 'konflikt' })
  })

  it('lehnt Inhalte ab, die nicht zur Endung passen oder kein Bild sind', async () => {
    expect(await fehlerVon(anlegen('bild.png', 'Nur Text.\n'))).toMatchObject({ status: 422, typ: 'dateityp_nicht_erlaubt' })
    expect(await fehlerVon(anlegen('bild.jpg', PNG))).toMatchObject({ status: 422, typ: 'dateityp_nicht_erlaubt' })
    expect(baum.size).toBe(0)
  })

  it('lehnt Dateien über 10 MB mit zu_gross ab', async () => {
    expect(await fehlerVon(anlegen('gross.png', PNG, 10 * 1024 * 1024 + 1))).toMatchObject({ status: 413, typ: 'zu_gross' })
  })

  it('prüft die Zahl der Einträge im Projekt', async () => {
    eintraege = 1999
    expect(await fehlerVon(anlegen('neu/a.png', PNG))).toMatchObject({ typ: 'projekt_zu_viele_dateien' })
    expect(await anlegen('a.png', PNG)).toEqual({ pfad: 'a.png' })
  })

  it.each(['../x.png', '/x.png', 'a/../b.png', 'a//b.png', 'x.exe', 'x', 'a\\b.png', ' .png', `${'a'.repeat(300)}.png`])(
    'lehnt den Pfad %s mit eingabe_ungueltig ab',
    async pfad => {
      expect(await fehlerVon(anlegen(pfad, PNG))).toMatchObject({ status: 422, typ: 'eingabe_ungueltig', zusatz: { feld: 'projektdatei' } })
    }
  )
})

describe('Lizenzen', () => {
  it.each([
    ['cc-by', 'cc-by'],
    ['CC-BY-4.0', 'cc-by'],
    ['cc-by-sa', 'cc-by-sa'],
    ['cc-by-nc', 'cc-by-nc'],
    ['cc-by-nc-sa', 'cc-by-nc-sa'],
    ['cc0', 'cc0'],
    ['pd', 'public-domain'],
    ['public-domain', 'public-domain'],
    ['cc-by-nd', null],
    ['cc-by-nc-nd', null],
    ['implied-oa', null],
    ['publisher-specific-oa', null],
    [null, null],
  ])('%s gilt als %s', (lizenz, offen) => {
    expect(D.offeneLizenz(lizenz)).toBe(offen)
  })
})

describe('abbildungAusQuelle', () => {
  const quelle = (lizenz, extra = {}) => ({ _id: new ObjectId(), projectId, key: 'offen2023', art: 'pdf', seitenzahl: 8, lizenz, ...extra })
  const ausschnitt = { x: 0.1, y: 0.2, breite: 0.8, hoehe: 0.4 }
  const holen = (q, args = {}) =>
    D.abbildungAusQuelle({ projectId, menschId, botId, quelle: q, seite: 4, ausschnitt, pfad: 'abbildungen/offen2023-abb2.png', ...args })

  it('legt den Ausschnitt mit 300 dpi als PNG an und liefert Lizenz und Quellenangabe', async () => {
    const antwort = await holen(quelle('cc-by'))
    expect(antwort).toMatchObject({ pfad: 'abbildungen/offen2023-abb2.png', lizenz: 'cc-by' })
    expect(antwort.quellenangabe).toContain('\\textcite{offen2023}')
    expect(antwort.quellenangabe).toContain('S. 4')
    expect(antwort.quellenangabe).toContain('CC BY')
    const png = baum.get('/abbildungen/offen2023-abb2.png')
    // 0,8 × 612 pt und 0,4 × 792 pt bei 300 dpi.
    expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([2040, 1320])
    expect(lauf.angelegt).toEqual([{ art: 'datei', pfad: 'abbildungen/offen2023-abb2.png', ordner: 'abbildungen' }])
  })

  it.each([null, 'cc-by-nd', 'implied-oa'])('lehnt die Lizenz %s mit lizenz_fehlt ab und legt nichts an', async lizenz => {
    const fehler = await fehlerVon(holen(quelle(lizenz)))
    expect(fehler).toMatchObject({ status: 409, typ: 'lizenz_fehlt' })
    expect(fehler.message).toBe(meldung('spur_fehler_lizenz_fehlt', { key: 'offen2023' }))
    expect(baum.size).toBe(0)
  })

  it.each([
    { x: 0.1, y: 0.2, breite: 0, hoehe: 0.4 },
    { x: 0.1, y: 0.2, breite: 1.2, hoehe: 0.4 },
    { x: -0.1, y: 0.2, breite: 0.5, hoehe: 0.4 },
    { x: 0.5, y: 0.2, breite: 0.6, hoehe: 0.4 },
    { x: 0.1, y: 0.2, breite: 0.5 },
  ])('lehnt den Ausschnitt %o mit eingabe_ungueltig ab', async falsch => {
    expect(await fehlerVon(holen(quelle('cc-by'), { ausschnitt: falsch }))).toMatchObject({ status: 422, typ: 'eingabe_ungueltig', zusatz: { feld: 'ausschnitt' } })
  })

  it('verlangt einen Pfad mit .png', async () => {
    expect(await fehlerVon(holen(quelle('cc-by'), { pfad: 'abbildungen/a.jpg' }))).toMatchObject({ status: 422, typ: 'eingabe_ungueltig', zusatz: { feld: 'pfad' } })
  })

  it('meldet einen vorhandenen Pfad als konflikt, ohne zu rendern', async () => {
    baum.set('/abbildungen/offen2023-abb2.png', PNG)
    expect(await fehlerVon(holen(quelle('cc-by')))).toMatchObject({ status: 409, typ: 'konflikt' })
  })

  it('prüft die Seite wie source_page_image', async () => {
    const q = quelle('cc-by')
    await holen(q)
    const { seitePruefen } = await import('../../app/src/QuellenManager.mjs')
    expect(seitePruefen).toHaveBeenCalledWith(q, 4)
  })
})
