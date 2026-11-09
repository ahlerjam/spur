import fs from 'node:fs/promises'
import os from 'node:os'
import Path from 'node:path'
import logger from '@overleaf/logger'
import Settings from '@overleaf/settings'
import CompileManager from '../../../../../app/src/Features/Compile/CompileManager.mjs'
import { getOutputFileURL } from '../../../../../app/src/Features/Compile/ClsiURLHelpers.mjs'
import { ObjectId } from '../../../../../app/src/infrastructure/mongodb.mjs'
import { WerkzeugFehler } from '../mcp/fehler.mjs'
import { seitenBild as bildRendern, seitenzahl } from '../pdf.mjs'
import { jobs } from '../sammlungen.mjs'
import { jetzt } from '../schalter.mjs'

const MAX_FEHLER = 20
const MAX_LOG = 4000

// Fehler aus dem LaTeX-Log: „! Meldung“ mit der folgenden Zeile „l.<n> Kontext“, oder Datei:Zeile: Meldung.
export function fehlerAusLog(log) {
  const zeilen = log.split('\n')
  const fehler = []
  for (let i = 0; i < zeilen.length && fehler.length < MAX_FEHLER; i++) {
    const mitDatei = /^(?:\.\/)?([^:\s][^:]*\.(?:tex|sty|cls|bib|bbl)):(\d+): (.*)$/.exec(zeilen[i])
    const ohneDatei = /^! (.*)$/.exec(zeilen[i])
    if (!mitDatei && !ohneDatei) continue
    const eintrag = mitDatei
      ? { datei: mitDatei[1], zeile: Number(mitDatei[2]), meldung: mitDatei[3], kontext: null }
      : { datei: null, zeile: null, meldung: ohneDatei[1], kontext: null }
    for (let j = i + 1; j < Math.min(zeilen.length, i + 12); j++) {
      const ort = /^l\.(\d+) (.*)$/.exec(zeilen[j])
      if (ort) {
        eintrag.zeile = Number(ort[1])
        eintrag.kontext = ort[2].trim()
        break
      }
      if (/^! /.test(zeilen[j])) break
    }
    fehler.push(eintrag)
  }
  return fehler
}

const jobFehlt = () => new WerkzeugFehler('job_fehlt', 'Diesen Job gibt es nicht.')

function jobFuerClient(job) {
  return { job_id: job._id, art: job.art, status: job.status, ergebnis: job.ergebnis ?? null, fehler: job.fehler ?? null }
}

export async function starten({ projectId, menschId, botId }) {
  const job = { _id: new ObjectId(), art: 'compile', projectId, menschId, botId, status: 'laeuft', angelegtAm: jetzt() }
  const sammlung = await jobs()
  await sammlung.insertOne(job)
  // Der Compile läuft im Hintergrund weiter; job_status fragt den Stand ab.
  CompileManager.promises
    .compile(projectId, menschId, { isAutoCompile: false })
    .then(ergebnis =>
      sammlung.updateOne(
        { _id: job._id },
        {
          $set: {
            status: 'fertig',
            fertigAm: jetzt(),
            ergebnis: { compile: ergebnis.status, dateien: (ergebnis.outputFiles ?? []).map(f => f.path) },
            buildId: ergebnis.buildId ?? null,
            clsiServerId: ergebnis.clsiServerId ?? null,
          },
        }
      )
    )
    .catch(error => {
      logger.warn({ err: error, projectId }, 'spur: Compile fehlgeschlagen')
      return sammlung.updateOne(
        { _id: job._id },
        { $set: { status: 'fehlgeschlagen', fertigAm: jetzt(), fehler: 'Der Compile ist fehlgeschlagen. Bitte erneut starten.' } }
      )
    })
    .catch(error => logger.error({ err: error }, 'spur: Job-Stand nicht gespeichert'))
  return jobFuerClient(job)
}

export async function status(jobId, botId) {
  if (!ObjectId.isValid(jobId)) throw jobFehlt()
  const job = await (await jobs()).findOne({ _id: new ObjectId(jobId), botId })
  if (!job) throw jobFehlt()
  return jobFuerClient(job)
}

async function letzterCompile(projectId, botId) {
  const [job] = await (await jobs())
    .find({ projectId, botId, art: 'compile', status: 'fertig', buildId: { $ne: null } })
    .sort({ fertigAm: -1 })
    .limit(1)
    .toArray()
  if (!job) throw new WerkzeugFehler('kein_compile', 'Es gibt noch keinen fertigen Compile. Bitte zuerst compile aufrufen.')
  return job
}

async function ausgabe({ projectId, menschId, buildId, clsiServerId }, datei) {
  const compileUser = Settings.disablePerUserCompiles ? null : menschId
  const url = getOutputFileURL(projectId, compileUser, buildId, datei, clsiServerId ?? undefined)
  const antwort = await fetch(url, { signal: AbortSignal.timeout(30000) })
  if (!antwort.ok) {
    throw new WerkzeugFehler('ausgabe_fehlt', `${datei} fehlt im letzten Compile. Bitte neu kompilieren.`)
  }
  return Buffer.from(await antwort.arrayBuffer())
}

export async function log({ projectId, botId }) {
  const job = await letzterCompile(projectId, botId)
  const text = (await ausgabe(job, 'output.log')).toString('utf8')
  return { job_id: job._id, compile: job.ergebnis.compile, fehler: fehlerAusLog(text), ende: text.slice(-MAX_LOG) }
}

// Für Compiles per Knopf im Editor: Build-ID und Server kommen aus deren Antwort.
export async function fehlerDesCompiles(compile) {
  return fehlerAusLog((await ausgabe(compile, 'output.log')).toString('utf8'))
}

export async function seitenBild({ projectId, botId, seite }) {
  const job = await letzterCompile(projectId, botId)
  const ordner = await fs.mkdtemp(Path.join(os.tmpdir(), 'spur-seite-'))
  try {
    const pdf = Path.join(ordner, 'output.pdf')
    await fs.writeFile(pdf, await ausgabe(job, 'output.pdf'))
    const anzahl = await seitenzahl(pdf)
    if (seite > anzahl) {
      throw new WerkzeugFehler('seite_fehlt', `Das PDF hat ${anzahl} Seiten.`)
    }
    return await fs.readFile(await bildRendern(pdf, seite, Path.join(ordner, 'seite')))
  } finally {
    await fs.rm(ordner, { recursive: true, force: true })
  }
}
