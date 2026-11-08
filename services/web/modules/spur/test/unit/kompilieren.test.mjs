import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { ObjectId, schalterAttrappe, testDatenbank } from './hilfen/datenbank.mjs'
import { fehlerVon } from './hilfen/fehler.mjs'

let Kompilieren
let datenbank
let m
let dateien

const projectId = new ObjectId()
const mensch = new ObjectId()
const bot = new ObjectId()

const LOG = `This is pdfTeX, Version 3.141592653
(./main.tex
LaTeX2e <2025-06-01>
! Undefined control sequence.
l.5 \\kaputtesmakro
                {}
The control sequence at the end of the top line
! Missing $ inserted.
<inserted text>
l.9 x^
       2
)
Output written on output.pdf (2 pages, 1234 bytes).`

beforeAll(async () => {
  datenbank = await testDatenbank()
})
afterAll(async () => await datenbank.schliessen())

beforeEach(async () => {
  await datenbank.leeren()
  dateien = { 'output.log': Buffer.from(LOG), 'output.pdf': Buffer.from('%PDF-1.5') }
  m = {
    CompileManager: {
      promises: {
        compile: vi.fn(async () => ({
          status: 'success',
          buildId: '19a0b-1c2d',
          clsiServerId: undefined,
          outputFiles: [{ path: 'output.pdf' }, { path: 'output.log' }],
        })),
      },
    },
    pdf: {
      seitenBild: vi.fn(async (pfad, seite, ziel) => {
        const fs = await import('node:fs/promises')
        await fs.writeFile(`${ziel}.png`, Buffer.from(`PNG-${seite}`))
        return `${ziel}.png`
      }),
      seitenzahl: vi.fn(async () => 2),
    },
  }
  vi.resetModules()
  vi.doMock('../../../../app/src/infrastructure/mongodb.mjs', () => datenbank.mongodbModul)
  vi.doMock('../../app/src/schalter.mjs', () => schalterAttrappe().modul)
  vi.doMock('../../../../app/src/Features/Compile/CompileManager.mjs', () => ({ default: m.CompileManager }))
  vi.doMock('../../../../app/src/Features/Compile/ClsiURLHelpers.mjs', () => ({
    getOutputFileURL: (pid, uid, build, datei) => new URL(`http://clsi.test/project/${pid}/build/${build}/output/${datei}`),
  }))
  vi.doMock('@overleaf/settings', () => ({ default: { disablePerUserCompiles: true } }))
  vi.doMock('../../app/src/pdf.mjs', () => m.pdf)
  vi.stubGlobal(
    'fetch',
    vi.fn(async url => {
      const datei = String(url).split('/').pop()
      return dateien[datei] ? new Response(dateien[datei]) : new Response('nicht da', { status: 404 })
    })
  )
  Kompilieren = await import('../../app/src/kompilieren/Kompilieren.mjs')
})

const fertig = async jobId => {
  for (let i = 0; i < 50; i++) {
    const job = await Kompilieren.status(String(jobId), bot)
    if (job.status !== 'laeuft') return job
    await new Promise(r => setTimeout(r, 10))
  }
  throw new Error('Job wurde nicht fertig')
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('fehlerAusLog', () => {
  it('liest Meldung und Zeile aus dem LaTeX-Log', () => {
    expect(Kompilieren.fehlerAusLog(LOG)).toEqual([
      { datei: null, zeile: 5, meldung: 'Undefined control sequence.', kontext: '\\kaputtesmakro' },
      { datei: null, zeile: 9, meldung: 'Missing $ inserted.', kontext: 'x^' },
    ])
  })

  it('versteht auch das Format mit -file-line-error', () => {
    expect(Kompilieren.fehlerAusLog('./kapitel/a.tex:12: Undefined control sequence.\nl.12 \\foo')).toEqual([
      { datei: 'kapitel/a.tex', zeile: 12, meldung: 'Undefined control sequence.', kontext: '\\foo' },
    ])
  })
})

describe('Compile-Jobs', () => {
  it('liefert sofort ein Job-Handle und meldet danach „fertig“', async () => {
    const { job_id: jobId, status } = await Kompilieren.starten({ projectId, menschId: mensch, botId: bot })
    expect(status).toBe('laeuft')
    const job = await fertig(jobId)
    expect(job).toMatchObject({ status: 'fertig', ergebnis: { compile: 'success', dateien: ['output.pdf', 'output.log'] } })
    expect(m.CompileManager.promises.compile).toHaveBeenCalledWith(projectId, mensch, { isAutoCompile: false })
  })

  it('meldet einen gescheiterten Compile als „fehlgeschlagen“', async () => {
    m.CompileManager.promises.compile.mockRejectedValue(new Error('clsi weg'))
    const { job_id: jobId } = await Kompilieren.starten({ projectId, menschId: mensch, botId: bot })
    expect(await fertig(jobId)).toMatchObject({ status: 'fehlgeschlagen' })
  })

  it('kennt Jobs nur für den eigenen Bot', async () => {
    const { job_id: jobId } = await Kompilieren.starten({ projectId, menschId: mensch, botId: bot })
    expect(await fehlerVon(Kompilieren.status(String(jobId), new ObjectId()))).toMatchObject({ code: 'job_fehlt' })
    expect(await fehlerVon(Kompilieren.status('kaputt', bot))).toMatchObject({ code: 'job_fehlt' })
  })

  it('liest Fehlerzeilen aus dem Log des letzten Compiles', async () => {
    await fertig((await Kompilieren.starten({ projectId, menschId: mensch, botId: bot })).job_id)
    const log = await Kompilieren.log({ projectId, botId: bot })
    expect(log.fehler[0]).toMatchObject({ zeile: 5, meldung: 'Undefined control sequence.' })
    expect(log.compile).toBe('success')
  })

  it('rendert eine Seite des letzten PDFs als PNG', async () => {
    await fertig((await Kompilieren.starten({ projectId, menschId: mensch, botId: bot })).job_id)
    const bild = await Kompilieren.seitenBild({ projectId, botId: bot, seite: 2 })
    expect(bild.toString()).toBe('PNG-2')
    expect(await fehlerVon(Kompilieren.seitenBild({ projectId, botId: bot, seite: 3 }))).toMatchObject({ code: 'seite_fehlt' })
  })

  it('verlangt vor Log und Bild einen fertigen Compile', async () => {
    expect(await fehlerVon(Kompilieren.log({ projectId, botId: bot }))).toMatchObject({ code: 'kein_compile' })
  })
})
