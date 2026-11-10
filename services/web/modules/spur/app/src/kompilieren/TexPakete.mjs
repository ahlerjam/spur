// tex_package_add: holt ein Paket aus dem TeX-Live-Archiv des Spiegels, den das Image nutzt, und legt seine
// Laufzeitdateien unter tex-pakete/<paket>/ ins Projekt. Eine latexmkrc im Projekt nimmt den Ordner in die Suchpfade.
import { execFile } from 'node:child_process'
import { createWriteStream } from 'node:fs'
import fs from 'node:fs/promises'
import os from 'node:os'
import Path from 'node:path'
import { promisify } from 'node:util'
import EditorController from '../../../../../app/src/Features/Editor/EditorController.mjs'
import ProjectEntityHandler from '../../../../../app/src/Features/Project/ProjectEntityHandler.mjs'
import { RateLimiter } from '../../../../../app/src/infrastructure/RateLimiter.mjs'
import { WerkzeugFehler } from '../mcp/fehler.mjs'
import {
  abhaengigkeiten,
  datenbankLesen,
  eintraegePruefen,
  LATEXMKRC_BLOCK,
  latexmkrcErgaenzen,
  laufzeitDateien,
  ORDNER,
  paketNamePruefen,
} from './texArchiv.mjs'
import { texPakete } from '../sammlungen.mjs'
import { paperApiBasis, umgebung } from '../schalter.mjs'
import * as LaufManager from '../schreiben/LaufManager.mjs'
import * as SchreibManager from '../schreiben/SchreibManager.mjs'
import * as Speicher from '../Speicher.mjs'

const ausfuehren = promisify(execFile)

const MB = 1024 * 1024
export const MAX_PAKET = 20 * MB
export const MAX_PROJEKT = 50 * MB

export const begrenzer = new RateLimiter('spur-tex-pakete', { points: 20, duration: 3600 })

let datenbank = null

async function lokaleDatenbank() {
  if (!datenbank) {
    const { stdout } = await ausfuehren('kpsewhich', ['-var-value', 'SELFAUTOPARENT'])
    datenbank = datenbankLesen(await fs.readFile(Path.join(stdout.trim(), 'tlpkg', 'texlive.tlpdb'), 'utf8'))
  }
  return datenbank
}

async function spiegel() {
  // Im Dev-Stack mit dem Paper-Fake liefert derselbe Fake auch das TeX-Live-Archiv.
  const fake = paperApiBasis()
  if (fake) return `${new URL(fake).origin}/spur/dev/texlive`
  return (await lokaleDatenbank()).spiegel
}

async function herunterladen(url, ziel) {
  const antwort = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(120000) })
  if (antwort.status === 404) throw new WerkzeugFehler('paket_unbekannt', 'spur_fehler_tex_paket_unbekannt')
  if (!antwort.ok) throw new WerkzeugFehler('spiegel_nicht_erreichbar', 'spur_fehler_tex_spiegel')
  const zuGross = () => new WerkzeugFehler('paket_zu_gross', 'spur_fehler_tex_paket_gross', { mb: MAX_PAKET / MB })
  if (Number(antwort.headers.get('content-length')) > MAX_PAKET) {
    await antwort.body?.cancel()
    throw zuGross()
  }
  const datei = createWriteStream(ziel)
  let gelesen = 0
  try {
    for await (const stueck of antwort.body) {
      gelesen += stueck.length
      if (gelesen > MAX_PAKET) throw zuGross()
      if (!datei.write(stueck)) await new Promise(weiter => datei.once('drain', weiter))
    }
  } finally {
    await new Promise(fertig => datei.end(fertig))
  }
}

async function projektStand(projectId) {
  const { docs, files } = await ProjectEntityHandler.promises.getAllEntities(projectId)
  const pfade = [...docs, ...files].map(e => e.path.replace(/^\//, ''))
  const pakete = new Set(pfade.filter(p => p.startsWith(`${ORDNER}/`)).map(p => p.split('/')[1]))
  const rc = docs.find(d => d.path === '/latexmkrc')
  return { pakete, rcDoc: rc, rcDatei: files.some(f => f.path === '/latexmkrc') }
}

async function belegtImProjekt(projectId, vorhanden) {
  const eintraege = await (await texPakete()).find({ projectId }).toArray()
  return eintraege.filter(e => vorhanden.has(e.paket)).reduce((summe, e) => summe + e.bytes, 0)
}

async function latexmkrcSichern({ projectId, menschId, botId, stand, ordner, lauf }) {
  if (stand.rcDatei) return
  if (stand.rcDoc) {
    const doc = (await ProjectEntityHandler.promises.getAllDocs(projectId))['/latexmkrc']
    const text = doc.lines.join('\n')
    if (latexmkrcErgaenzen(text) === null) return
    await SchreibManager.docEdit({
      projectId,
      botId,
      pfad: 'latexmkrc',
      alt: '',
      neu: `${text.endsWith('\n') || !text ? '' : '\n'}${LATEXMKRC_BLOCK}`,
      schluessel: `tex-pakete-rc-${lauf._id}`,
    })
    return
  }
  const datei = Path.join(ordner, 'latexmkrc')
  await fs.writeFile(datei, LATEXMKRC_BLOCK)
  await EditorController.promises.upsertFileWithPath(projectId, '/latexmkrc', datei, null, 'spur', menschId)
  await LaufManager.angelegtMerken(lauf, [{ art: 'datei', pfad: 'latexmkrc' }])
}

export async function abgeschaltet() {
  return umgebung('SPUR_TEX_PAKETE') === 'aus'
}

export async function hinzufuegen({ projectId, menschId, botId, paket }) {
  if (await abgeschaltet()) throw new WerkzeugFehler('abgeschaltet', 'spur_fehler_tex_pakete_aus')
  paketNamePruefen(paket)
  try {
    await begrenzer.consume(String(menschId), 1, { method: 'userId' })
  } catch (error) {
    if (error instanceof Error) throw error
    throw new WerkzeugFehler('zu_viele_anfragen', 'spur_fehler_tex_pakete_drossel')
  }
  const lokal = await lokaleDatenbank()
  if (lokal.namen.has(paket)) {
    return { paket, im_image: true, dateien: [], fehlende_abhaengigkeiten: [], hinweis: 'schon im Image' }
  }
  const stand = await projektStand(projectId)
  if (stand.pakete.has(paket)) {
    return { paket, im_image: false, dateien: [], fehlende_abhaengigkeiten: [], hinweis: 'schon im Projekt' }
  }

  const ordner = await fs.mkdtemp(Path.join(os.tmpdir(), 'spur-tex-'))
  try {
    const archiv = Path.join(ordner, 'paket.tar.xz')
    await herunterladen(`${await spiegel()}/archive/${paket}.tar.xz`, archiv)
    const { stdout } = await ausfuehren('tar', ['-tvJf', archiv], { maxBuffer: 16 * MB })
    const eintraege = eintraegePruefen(stdout)
    const entpackt = eintraege.reduce((summe, e) => summe + e.groesse, 0)
    if (entpackt > MAX_PAKET) {
      throw new WerkzeugFehler('paket_zu_gross', 'spur_fehler_tex_paket_gross', { mb: MAX_PAKET / MB })
    }
    const dateien = laufzeitDateien(eintraege)
    const bytes = dateien.reduce((summe, d) => summe + d.groesse, 0)
    if ((await belegtImProjekt(projectId, stand.pakete)) + bytes > MAX_PROJEKT) {
      throw new WerkzeugFehler('projekt_voll', 'spur_fehler_tex_pakete_voll', { mb: MAX_PROJEKT / MB })
    }
    const ziel = Path.join(ordner, 'x')
    await fs.mkdir(ziel)
    await ausfuehren('tar', ['-xJf', archiv, '-C', ziel, '--no-same-owner', '--no-same-permissions'])
    const tlpobj = await fs.readFile(Path.join(ziel, 'tlpkg', 'tlpobj', `${paket}.tlpobj`), 'utf8').catch(() => '')

    await Speicher.reservieren(projectId, bytes)
    const lauf = await LaufManager.laufFuerSchreiben(projectId, botId)
    const angelegt = []
    try {
      for (const d of dateien) {
        const pfad = `${ORDNER}/${paket}/${d.name}`
        await EditorController.promises.upsertFileWithPath(projectId, `/${pfad}`, Path.join(ziel, d.pfad), null, 'spur', menschId)
        angelegt.push(pfad)
      }
    } catch (error) {
      await Speicher.freigeben(projectId, bytes)
      throw error
    }
    await (await texPakete()).updateOne({ projectId, paket }, { $set: { bytes } }, { upsert: true })
    await LaufManager.angelegtMerken(lauf, [{ art: 'ordner', pfad: `${ORDNER}/${paket}`, paket, bytes }])
    await latexmkrcSichern({ projectId, menschId, botId, stand, ordner, lauf })

    const imProjekt = new Set([...stand.pakete, paket])
    return {
      paket,
      im_image: false,
      dateien: angelegt,
      fehlende_abhaengigkeiten: abhaengigkeiten(tlpobj).filter(n => !lokal.namen.has(n) && !imProjekt.has(n)),
    }
  } finally {
    await fs.rm(ordner, { recursive: true, force: true })
  }
}

// Für „Lauf rückgängig“: Ordner eines Pakets samt Buchung entfernen.
export async function paketEntfernt(projectId, paket) {
  const eintrag = await (await texPakete()).findOneAndDelete({ projectId, paket })
  if (eintrag) await Speicher.freigeben(projectId, eintrag.bytes)
}
