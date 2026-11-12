// TexPakete.hinzufuegen gegen einen lokalen Spiegel-Server mit echten tar.xz-Archiven und einen Dateibaum im Speicher.
import { execFile as echtesExecFile } from 'node:child_process'
import fs from 'node:fs/promises'
import http from 'node:http'
import os from 'node:os'
import Path from 'node:path'
import { promisify } from 'node:util'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { ObjectId, testDatenbank } from './hilfen/datenbank.mjs'
import { fehlerVon } from './hilfen/fehler.mjs'

const tar = promisify(echtesExecFile)
const MB = 1024 * 1024
const projectId = new ObjectId()
const menschId = new ObjectId()
const botId = new ObjectId()

let datenbank
let server
let basis
let texRoot
let archive
let T
let baum
let antworten
let abrufe
let uploadFehlerBei
let lauf

async function archivBauen(name, dateien) {
  const ordner = await fs.mkdtemp(Path.join(os.tmpdir(), 'spur-unit-paket-'))
  for (const [pfad, inhalt] of Object.entries(dateien)) {
    await fs.mkdir(Path.dirname(Path.join(ordner, pfad)), { recursive: true })
    await fs.writeFile(Path.join(ordner, pfad), inhalt)
  }
  const ziel = Path.join(ordner, '..', `${Path.basename(ordner)}.tar.xz`)
  await tar('tar', ['-cJf', ziel, '-C', ordner, ...new Set(Object.keys(dateien).map(p => p.split('/')[0]))])
  return await fs.readFile(ziel)
}

const FUENF = {
  'tex/latex/spurtestfuenf/spurtestfuenf.sty': '\\ProvidesPackage{spurtestfuenf}\n',
  'tex/latex/spurtestfuenf/a.sty': 'a',
  'tex/latex/spurtestfuenf/b.sty': 'b',
  'tex/latex/spurtestfuenf/t1spurtestfuenf.fd': 'c',
  'tex/latex/spurtestfuenf/ot1spurtestfuenf.fd': 'd',
  'tlpkg/tlpobj/spurtestfuenf.tlpobj': 'name spurtestfuenf\ndepend xcolor\ndepend spurtestfehlt\n',
}

beforeAll(async () => {
  datenbank = await testDatenbank()
  texRoot = await fs.mkdtemp(Path.join(os.tmpdir(), 'spur-unit-texlive-'))
  await fs.mkdir(Path.join(texRoot, 'tlpkg'))
  await fs.writeFile(Path.join(texRoot, 'tlpkg', 'texlive.tlpdb'), 'name xcolor\nname beamer\n')
  archive = { spurtestfuenf: await archivBauen('spurtestfuenf', FUENF) }
  server = http.createServer((req, res) => {
    const [, spiegel, paket] = /\/(texlive|texlive-b)\/archive\/([^/]+)\.tar\.xz$/.exec(req.url) ?? []
    abrufe.push(`${spiegel}:${paket}`)
    const liste = antworten[spiegel] ?? []
    const status = liste.length ? liste.shift() : 200
    if (status === 'trennen') return req.socket.destroy()
    if (status !== 200) return res.writeHead(status).end('Fehler')
    if (!archive[paket]) return res.writeHead(404).end()
    res.writeHead(200, { 'Content-Type': 'application/x-xz' }).end(archive[paket])
  })
  await new Promise(fertig => server.listen(0, '127.0.0.1', fertig))
  basis = `http://127.0.0.1:${server.address().port}/spur/dev/crossref`
})

afterAll(async () => {
  await datenbank.schliessen()
  server.close()
  await fs.rm(texRoot, { recursive: true, force: true })
})

beforeEach(async () => {
  await datenbank.leeren()
  baum = new Map()
  antworten = {}
  abrufe = []
  uploadFehlerBei = null
  lauf = { _id: new ObjectId(), angelegt: [] }
  vi.resetModules()
  vi.doMock('../../../../app/src/infrastructure/mongodb.mjs', () => datenbank.mongodbModul)
  vi.doMock('node:child_process', async () => {
    const echt = await vi.importActual('node:child_process')
    return {
      ...echt,
      execFile: (befehl, argumente, optionen, fertig) => {
        if (typeof optionen === 'function') [fertig, optionen] = [optionen, {}]
        if (befehl === 'kpsewhich') return fertig(null, { stdout: `${texRoot}\n` })
        return echt.execFile(befehl, argumente, optionen, (fehler, stdout, stderr) => fertig(fehler, { stdout, stderr }))
      },
    }
  })
  vi.doMock('../../../../app/src/Features/Editor/EditorController.mjs', async () => {
    const { default: Errors } = await vi.importActual('../../../../app/src/Features/Errors/Errors.js')
    return {
      default: {
        promises: {
          upsertFileWithPath: vi.fn(async (_p, pfad, datei) => {
            if (uploadFehlerBei !== null && [...baum.keys()].filter(p => p.startsWith('/tex-pakete/')).length + 1 === uploadFehlerBei) {
              throw new Error('Filestore weg')
            }
            baum.set(pfad, (await fs.readFile(datei)).length)
          }),
          deleteEntityWithPath: vi.fn(async (_p, pfad) => {
            const treffer = [...baum.keys()].filter(p => p === pfad || p.startsWith(`${pfad}/`))
            if (!treffer.length) throw new Errors.NotFoundError('fehlt')
            for (const p of treffer) baum.delete(p)
          }),
        },
      },
    }
  })
  vi.doMock('../../../../app/src/Features/Project/ProjectEntityHandler.mjs', () => ({
    default: {
      promises: {
        getAllEntities: async () => ({ docs: [], files: [...baum.keys()].map(path => ({ path })) }),
        getAllDocs: async () => ({}),
      },
    },
  }))
  vi.doMock('../../app/src/projektEintraege.mjs', () => ({ anzahlEintraege: async () => baum.size, maxEintraege: () => 2000 }))
  vi.doMock('../../app/src/Speicher.mjs', () => ({ nichtVollPruefen: vi.fn(async () => {}), reservieren: vi.fn(async () => async () => {}) }))
  vi.doMock('../../app/src/schreiben/LaufManager.mjs', () => ({
    laufFuerSchreiben: async () => lauf,
    angelegtMerken: async (_l, eintraege) => lauf.angelegt.push(...eintraege),
  }))
  vi.doMock('../../app/src/schreiben/SchreibManager.mjs', () => ({ docEdit: vi.fn() }))
  vi.doMock('../../app/src/schalter.mjs', async () => ({
    ...(await vi.importActual('../../app/src/schalter.mjs')),
    paperApiBasis: () => `${basis}/`,
    umgebung: () => undefined,
  }))
  T = await import('../../app/src/kompilieren/TexPakete.mjs')
})

const holen = (paket = 'spurtestfuenf') => T.hinzufuegen({ projectId, menschId, botId, paket })
const paketDateien = () => [...baum.keys()].filter(p => p.startsWith('/tex-pakete/')).sort()
const eintrag = async () => await datenbank.db.collection('spurTexPackages').findOne({ projectId, paket: 'spurtestfuenf' })

describe('TexPakete.hinzufuegen', () => {
  it('legt die Laufzeitdateien an, bucht das Paket und nennt fehlende Abhängigkeiten', async () => {
    const ergebnis = await holen()
    expect(ergebnis.dateien).toHaveLength(5)
    expect(ergebnis.fehlende_abhaengigkeiten).toEqual(['spurtestfehlt'])
    expect(paketDateien()).toHaveLength(5)
    expect(baum.has('/latexmkrc')).toBe(true)
    const bytes = Object.entries(FUENF).filter(([p]) => p.startsWith('tex/')).reduce((s, [, inhalt]) => s + inhalt.length, 0)
    expect(await eintrag()).toMatchObject({ bytes })
    expect(lauf.angelegt).toEqual([{ art: 'ordner', pfad: 'tex-pakete/spurtestfuenf', paket: 'spurtestfuenf', bytes }])
  })

  it('meldet ein unbekanntes Paket ohne Wiederholung und ohne zweiten Spiegel', async () => {
    expect(await fehlerVon(holen('spurtestgibtsnicht'))).toMatchObject({ code: 'paket_unbekannt' })
    expect(abrufe).toEqual(['texlive:spurtestgibtsnicht'])
  })

  it('wiederholt bei 5xx und Verbindungsabbruch und nimmt den dritten Versuch', async () => {
    antworten.texlive = [502, 'trennen']
    expect((await holen()).dateien).toHaveLength(5)
    expect(abrufe).toEqual(['texlive:spurtestfuenf', 'texlive:spurtestfuenf', 'texlive:spurtestfuenf'])
  })

  it('wechselt nach drei Fehlern zum zweiten Spiegel', async () => {
    antworten.texlive = [502, 502, 502]
    expect((await holen()).dateien).toHaveLength(5)
    expect(abrufe.filter(a => a.startsWith('texlive-b:'))).toHaveLength(1)
  })

  it('meldet den Status, wenn beide Spiegel scheitern, und legt nichts an', async () => {
    antworten.texlive = [502, 502, 502]
    antworten['texlive-b'] = [502, 502, 502]
    const fehler = await fehlerVon(holen())
    expect(fehler).toMatchObject({ code: 'spiegel_nicht_erreichbar' })
    expect(fehler.message).toContain('502')
    expect(abrufe).toHaveLength(6)
    expect(paketDateien()).toEqual([])
    expect(lauf.angelegt).toEqual([])
  })

  it('rollt zurück, wenn der Upload der dritten Datei scheitert', async () => {
    uploadFehlerBei = 3
    expect(await fehlerVon(holen())).toMatchObject({ code: 'paket_abgebrochen' })
    expect(paketDateien()).toEqual([])
    expect(await eintrag()).toBe(null)
    expect(lauf.angelegt).toEqual([])
    uploadFehlerBei = null
    expect((await holen()).dateien).toHaveLength(5)
  })

  it('räumt einen Rest-Ordner ohne Eintrag ab und installiert vollständig', async () => {
    baum.set('/tex-pakete/spurtestfuenf/alt.sty', 1)
    expect((await holen()).dateien).toHaveLength(5)
    expect(paketDateien()).not.toContain('/tex-pakete/spurtestfuenf/alt.sty')
    expect(paketDateien()).toHaveLength(5)
  })

  it('meldet ein vollständiges Paket als schon im Projekt und ändert nichts', async () => {
    await holen()
    const vorher = paketDateien()
    expect(await holen()).toMatchObject({ hinweis: 'schon im Projekt', dateien: [] })
    expect(paketDateien()).toEqual(vorher)
  })

  it('installiert neu, wenn der Ordner eines gebuchten Pakets von Hand gelöscht wurde', async () => {
    await holen()
    for (const p of paketDateien()) baum.delete(p)
    expect((await holen()).dateien).toHaveLength(5)
  })

  it('lässt einen zweiten gleichzeitigen Aufruf warten, bis der erste fertig ist', async () => {
    const [erster, zweiter] = await Promise.all([holen(), holen()])
    expect(erster.dateien).toHaveLength(5)
    expect(zweiter.hinweis).toBe('schon im Projekt')
    expect(paketDateien()).toHaveLength(5)
  })

  it('zählt nur gelungene Installationen gegen die eingestellte Drossel', async () => {
    await datenbank.db.collection('spurLimits').insertOne({ _id: '_standard', texProStunde: 1 })
    expect((await holen('beamer')).hinweis).toBe('schon im Image')
    await fehlerVon(holen('spurtestgibtsnicht'))
    await holen()
    const fehler = await fehlerVon(holen('spurtestzwei'))
    expect(fehler).toMatchObject({ code: 'zu_viele_anfragen' })
    expect(fehler.message).toContain('1 installations per hour')
    expect((await holen()).hinweis).toBe('schon im Projekt')
  })

  it('prüft die eingestellte Größe je Paket entpackt', async () => {
    await datenbank.db.collection('spurLimits').insertOne({ _id: '_standard', texPaketMb: 1 })
    archive.spurtestgross = await archivBauen('spurtestgross', { 'fonts/opentype/x/gross.otf': Buffer.alloc(2 * MB) })
    const fehler = await fehlerVon(holen('spurtestgross'))
    expect(fehler).toMatchObject({ code: 'paket_zu_gross' })
    expect(fehler.message).toContain('is 2 MB unpacked; the limit is 1 MB.')
  })

  it('meldet zu viele Einträge, bevor etwas angelegt wird', async () => {
    for (let i = 0; i < 1996; i++) baum.set(`/d${i}.tex`, 1)
    const fehler = await fehlerVon(holen())
    expect(fehler).toMatchObject({ code: 'projekt_zu_viele_dateien' })
    expect(paketDateien()).toEqual([])
  })
})
