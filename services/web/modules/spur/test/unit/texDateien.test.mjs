// tex_file_read: Dateien der TeX-Installation und aus tex-pakete/ des Projekts lesen (P15).
// Echter Fall: Claude wollte apa7.cls von CTAN laden, um „Note.“ und einen Fehler bei leeren Deckblattfeldern zu verstehen.
import fs from 'node:fs/promises'
import os from 'node:os'
import Path from 'node:path'
import { Readable } from 'node:stream'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { ObjectId } from './hilfen/datenbank.mjs'
import { fehlerVon } from './hilfen/fehler.mjs'

const projectId = new ObjectId()
let texRoot
let ausserhalb
let kpsewhich
let dateien
let blobs
let T

const KLASSE = Array.from({ length: 300 }, (_, i) => (i === 0 ? '\\ProvidesClass{article}' : `% Zeile ${i + 1}`)).join('\n')

beforeAll(async () => {
  texRoot = await fs.mkdtemp(Path.join(os.tmpdir(), 'spur-unit-texroot-'))
  await fs.mkdir(Path.join(texRoot, 'texmf-dist', 'tex', 'latex', 'base'), { recursive: true })
  await fs.writeFile(Path.join(texRoot, 'texmf-dist', 'tex', 'latex', 'base', 'article.cls'), KLASSE)
  ausserhalb = await fs.mkdtemp(Path.join(os.tmpdir(), 'spur-unit-ausserhalb-'))
  await fs.writeFile(Path.join(ausserhalb, 'fremd.sty'), 'geheim')
})
afterAll(async () => {
  await fs.rm(texRoot, { recursive: true, force: true })
  await fs.rm(ausserhalb, { recursive: true, force: true })
})

beforeEach(async () => {
  dateien = []
  blobs = new Map()
  kpsewhich = vi.fn(name => (name === 'article.cls' ? Path.join(texRoot, 'texmf-dist', 'tex', 'latex', 'base', 'article.cls') : name === 'fremd.sty' ? Path.join(ausserhalb, 'fremd.sty') : ''))
  vi.resetModules()
  vi.doMock('node:child_process', async () => {
    const echt = await vi.importActual('node:child_process')
    return {
      ...echt,
      execFile: (befehl, argumente, optionen, fertig) => {
        if (typeof optionen === 'function') [fertig, optionen] = [optionen, {}]
        if (befehl !== 'kpsewhich') return echt.execFile(befehl, argumente, optionen, fertig)
        if (argumente[0] === '-var-value') return fertig(null, { stdout: argumente[1] === 'SELFAUTOPARENT' ? `${texRoot}\n` : `${texRoot}/../texmf-local\n` })
        const pfad = kpsewhich(argumente.at(-1), optionen)
        if (!pfad) return fertig(Object.assign(new Error('nicht gefunden'), { code: 1 }), { stdout: '' })
        fertig(null, { stdout: `${pfad}\n` })
      },
    }
  })
  vi.doMock('../../../../app/src/Features/Project/ProjectEntityHandler.mjs', () => ({
    default: { promises: { getAllEntities: async () => ({ docs: [], files: dateien }) } },
  }))
  vi.doMock('../../../../app/src/Features/History/HistoryManager.mjs', () => ({
    default: { promises: { requestBlobWithProjectId: vi.fn(async (_p, hash) => ({ stream: Readable.from([Buffer.from(blobs.get(hash))]) })) } },
  }))
  T = await import('../../app/src/kompilieren/TexDateien.mjs')
})

describe('TexDateien.lesen', () => {
  it('liefert Pfad, Zeilenzahl und Text einer Klasse der Installation', async () => {
    const r = await T.lesen({ projectId, name: 'article.cls' })
    expect(r).toMatchObject({ name: 'article.cls', pfad: expect.stringMatching(/texmf-dist\/tex\/latex\/base\/article\.cls$/), herkunft: 'installation', zeilen: 300, ab_zeile: 1, gekuerzt: false })
    expect(r.text).toContain('\\ProvidesClass{article}')
  })

  it('beginnt mit ab_zeile bei dieser Zeile', async () => {
    const r = await T.lesen({ projectId, name: 'article.cls', abZeile: 200 })
    expect(r.text.split('\n')[0]).toBe('% Zeile 200')
    expect(r.ab_zeile).toBe(200)
  })

  it('kürzt auf 40.000 Zeichen', async () => {
    dateien = [{ path: '/tex-pakete/lang/tex/latex/lang/lang.sty', file: { hash: 'h1' } }]
    blobs.set('h1', 'x'.repeat(50000))
    const r = await T.lesen({ projectId, name: 'lang.sty' })
    expect(r.text).toHaveLength(40000)
    expect(r.gekuerzt).toBe(true)
  })

  it('findet Dateien aus tex-pakete/ des Projekts zuerst', async () => {
    dateien = [
      // Wie ProjectEntityHandler.getAllEntities: der Hash steckt im Dateieintrag.
      { path: '/main.tex', file: { hash: 'h0' } },
      { path: '/tex-pakete/spurdemo/tex/latex/spurdemo/spurdemo.sty', file: { hash: 'h2' } },
    ]
    blobs.set('h2', '\\ProvidesPackage{spurdemo}\n')
    const r = await T.lesen({ projectId, name: 'spurdemo.sty' })
    expect(r).toMatchObject({ pfad: 'tex-pakete/spurdemo/tex/latex/spurdemo/spurdemo.sty', herkunft: 'projekt', zeilen: 1 })
    expect(r.text).toContain('\\ProvidesPackage{spurdemo}')
    expect(kpsewhich).not.toHaveBeenCalled()
  })

  it('meldet eine unbekannte Datei mit dem Hinweis auf tex_package_add', async () => {
    const fehler = await fehlerVon(T.lesen({ projectId, name: 'gibtesnicht.sty' }))
    expect(fehler).toMatchObject({ status: 404, typ: 'tex_datei_nicht_gefunden' })
    expect(fehler.message).toContain('tex_package_add')
  })

  it.each(['../../etc/passwd', '/etc/passwd', 'geheim.env', 'a/b.sty', '.sty', 'x.sty\n', '', 'passwd'])('lehnt %j ab, ohne kpsewhich zu fragen', async name => {
    expect(await fehlerVon(T.lesen({ projectId, name }))).toMatchObject({ status: 422, typ: 'eingabe_ungueltig', zusatz: { feld: 'name' } })
    expect(kpsewhich).not.toHaveBeenCalled()
  })

  it('liest nichts außerhalb des TeX-Baums, auch wenn kpsewhich dorthin zeigt', async () => {
    expect(await fehlerVon(T.lesen({ projectId, name: 'fremd.sty' }))).toMatchObject({ status: 404, typ: 'tex_datei_nicht_gefunden' })
  })

  it('sucht nicht im Arbeitsordner des Servers', async () => {
    await T.lesen({ projectId, name: 'article.cls' })
    const [, optionen] = kpsewhich.mock.calls[0]
    expect(optionen.cwd).toBeTruthy()
    expect(optionen.cwd).not.toBe(process.cwd())
  })
})
