// tex_package_add: holt ein Paket aus dem TeX-Live-Archiv des Spiegels, den das Image nutzt, und legt seine
// Laufzeitdateien unter tex-pakete/<paket>/ ins Projekt. Eine latexmkrc im Projekt nimmt den Ordner in die Suchpfade.
import { execFile, spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import os from 'node:os'
import Path from 'node:path'
import readline from 'node:readline'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { setTimeout as warten } from 'node:timers/promises'
import { promisify } from 'node:util'
import EditorController from '../../../../../app/src/Features/Editor/EditorController.mjs'
import ProjectEntityHandler from '../../../../../app/src/Features/Project/ProjectEntityHandler.mjs'
import Errors from '../../../../../app/src/Features/Errors/Errors.js'
import logger from '@overleaf/logger'
import { WerkzeugFehler } from '../mcp/fehler.mjs'
import {
  abhaengigkeiten,
  datenbankLesen,
  dateiIndexSammler,
  dateiNamePruefen,
  eintraegePruefen,
  LATEXMKRC_BLOCK,
  latexmkrcErgaenzen,
  laufzeitDateien,
  ORDNER,
  paketNamePruefen,
  ZWEITER_SPIEGEL,
} from './texArchiv.mjs'
import { standard, texGrenzen } from '../grenzen/Grenzen.mjs'
import { Problem } from '../probleme.mjs'
import { anzahlEintraege, maxEintraege } from '../projektEintraege.mjs'
import { drossel, texPakete } from '../sammlungen.mjs'
import { paperApiBasis, testSchalter, umgebung } from '../schalter.mjs'
import * as LaufManager from '../schreiben/LaufManager.mjs'
import * as SchreibManager from '../schreiben/SchreibManager.mjs'
import * as Speicher from '../Speicher.mjs'

const ausfuehren = promisify(execFile)

const MB = 1024 * 1024
const VERSUCHE_JE_SPIEGEL = 3
const PAUSE_MS = 300
const SPERRE_VERALTET_MS = 10 * 60 * 1000
const STUNDE_MS = 60 * 60 * 1000
const TAG_MS = 24 * STUNDE_MS

let datenbank = null

async function lokaleDatenbank() {
  if (!datenbank) {
    const { stdout } = await ausfuehren('kpsewhich', ['-var-value', 'SELFAUTOPARENT'])
    datenbank = datenbankLesen(await fs.readFile(Path.join(stdout.trim(), 'tlpkg', 'texlive.tlpdb'), 'utf8'))
  }
  return datenbank
}

// Der Spiegel des Images, danach mirror.ctan.org. Im Dev-Stack mit dem Paper-Fake zwei Fake-Spiegel.
async function spiegelListe() {
  const fake = paperApiBasis()
  if (fake) return ['texlive', 'texlive-b'].map(name => `${new URL(fake).origin}/spur/dev/crossref/${name}`)
  return [...new Set([(await lokaleDatenbank()).spiegel, ZWEITER_SPIEGEL])]
}

const mb = bytes => Math.ceil(bytes / MB)
const zuGross = (paket, bytes, grenze) =>
  new WerkzeugFehler('paket_zu_gross', 'spur_fehler_tex_paket_gross', { paket, groesse: mb(bytes), mb: grenze / MB })

class Wiederholen extends Error {
  constructor(status) {
    super(`Paketquelle: ${status ?? 'nicht erreichbar'}`)
    this.status = status
  }
}

// Ein Spiegel kennt das Paket nicht; ein anderer kann neuer sein.
class NichtGefunden extends Error {}

async function einmalHerunterladen(url, ziel, paket, grenze) {
  let antwort
  try {
    antwort = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(120000) })
  } catch {
    throw new Wiederholen(null)
  }
  if (antwort.status === 404) {
    await antwort.body?.cancel()
    throw new NichtGefunden()
  }
  if (antwort.status >= 500) {
    await antwort.body?.cancel()
    throw new Wiederholen(antwort.status)
  }
  if (!antwort.ok) {
    await antwort.body?.cancel()
    throw new WerkzeugFehler('spiegel_nicht_erreichbar', 'spur_fehler_tex_spiegel_status', { status: antwort.status })
  }
  const laenge = Number(antwort.headers.get('content-length'))
  if (laenge > grenze) {
    await antwort.body?.cancel()
    throw new WerkzeugFehler('paket_zu_gross', 'spur_fehler_tex_archiv_gross', { paket, mb: grenze / MB })
  }
  const datei = await fs.open(ziel, 'w')
  let gelesen = 0
  try {
    for await (const stueck of antwort.body) {
      gelesen += stueck.length
      if (gelesen > grenze) throw new WerkzeugFehler('paket_zu_gross', 'spur_fehler_tex_archiv_gross', { paket, mb: grenze / MB })
      await datei.write(stueck)
    }
  } catch (error) {
    if (error instanceof WerkzeugFehler) throw error
    throw new Wiederholen(null)
  } finally {
    await datei.close()
  }
}

// Je Spiegel drei Versuche bei 5xx und Netzfehlern, dann der nächste Spiegel; bei 404 sofort der nächste. Unbekannt
// ist ein Paket erst, wenn alle Spiegel 404 melden. Größe bricht sofort ab.
async function herunterladen(paket, ziel, grenze) {
  let letzter
  let nichtGefunden = 0
  const spiegel = await spiegelListe()
  for (const basis of spiegel) {
    for (let versuch = 1; versuch <= VERSUCHE_JE_SPIEGEL; versuch++) {
      try {
        return await einmalHerunterladen(`${basis}/archive/${paket}.tar.xz`, ziel, paket, grenze)
      } catch (error) {
        if (error instanceof NichtGefunden) {
          nichtGefunden++
          break
        }
        if (!(error instanceof Wiederholen)) throw error
        letzter = error
        logger.warn({ spiegel: basis, paket, versuch, status: error.status }, 'TeX-Paketquelle antwortet nicht')
        if (versuch < VERSUCHE_JE_SPIEGEL) await warten(PAUSE_MS * versuch)
      }
    }
  }
  if (nichtGefunden === spiegel.length) throw new WerkzeugFehler('paket_unbekannt', 'spur_fehler_tex_paket_unbekannt')
  if (letzter.status) {
    throw new WerkzeugFehler('spiegel_nicht_erreichbar', 'spur_fehler_tex_spiegel_status', { status: letzter.status })
  }
  throw new WerkzeugFehler('spiegel_nicht_erreichbar', 'spur_fehler_tex_spiegel')
}

// Datei → Paket aus der texlive.tlpdb des Spiegels, je Installation einen Tag vorgehalten. Ein Ausfall wird nicht
// vorgehalten: Der nächste Aufruf fragt neu.
let dateiIndex = null
let indexLaden = null
let generation = 0

async function indexVon(url) {
  // Ein gescheiterter Compile wartet auf die Zuordnung; 2,8 MB brauchen keine zwei Minuten.
  const antwort = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(30000) })
  if (!antwort.ok) {
    await antwort.body?.cancel()
    throw new Error(`Status ${antwort.status}`)
  }
  const xz = spawn('xz', ['-dc'], { stdio: ['pipe', 'pipe', 'ignore'] })
  const beendet = new Promise((fertig, fehler) => {
    xz.on('error', fehler)
    xz.on('close', code => (code === 0 ? fertig() : fehler(new Error(`xz: ${code}`))))
  })
  const sammler = dateiIndexSammler()
  const lesen = async () => {
    for await (const zeile of readline.createInterface({ input: xz.stdout, crlfDelay: Infinity })) sammler.zeile(zeile)
  }
  await Promise.all([pipeline(Readable.fromWeb(antwort.body), xz.stdin), lesen(), beendet])
  return sammler.index
}

async function indexHolen() {
  for (const spiegel of await spiegelListe()) {
    try {
      return await indexVon(`${spiegel}/tlpkg/texlive.tlpdb.xz`)
    } catch (error) {
      logger.warn({ err: error, spiegel }, 'TeX-Paketdatenbank des Spiegels nicht lesbar')
    }
  }
  return null
}

async function aktuellerIndex() {
  if (dateiIndex && dateiIndex.bis > Date.now()) return dateiIndex.index
  if (!indexLaden) {
    const stand = generation
    indexLaden = indexHolen()
      .then(index => {
        if (index && stand === generation) dateiIndex = { index, bis: Date.now() + TAG_MS }
        return index
      })
      .finally(() => {
        if (stand === generation) indexLaden = null
      })
  }
  return await indexLaden
}

// Für Tests im Dev-Stack: Der nächste Aufruf lädt die Datenbank neu, auch wenn gerade ein Abruf läuft.
export function dateiIndexVergessen() {
  generation++
  dateiIndex = null
  indexLaden = null
}

export async function fehlendePakete(dateien) {
  if (!dateien.length) return []
  if (await abgeschaltet()) return dateien.map(datei => ({ datei, paket: null, im_image: false, grund: 'abgeschaltet' }))
  const index = await aktuellerIndex()
  return dateien.map(datei => ({
    datei,
    paket: index?.get(datei) ?? null,
    im_image: false,
    ...(index ? {} : { grund: 'spiegel_nicht_erreichbar' }),
  }))
}

async function paketFuerDatei(datei) {
  dateiNamePruefen(datei)
  const index = await aktuellerIndex()
  if (!index) throw new WerkzeugFehler('spiegel_nicht_erreichbar', 'spur_fehler_tex_spiegel')
  const paket = index.get(datei)
  if (!paket) throw new WerkzeugFehler('paket_unbekannt', 'spur_fehler_tex_datei_unbekannt', { datei })
  return paket
}

// Ein Paket gilt als installiert, wenn es einen Eintrag hat (der entsteht erst nach dem letzten Upload) und sein
// Ordner Dateien enthält. Ein Eintrag ohne Dateien (Ordner von Hand gelöscht) zählt nicht; eine neue Installation
// überschreibt ihn.
async function projektStand(projectId) {
  const { docs, files } = await ProjectEntityHandler.promises.getAllEntities(projectId)
  const pfade = [...docs, ...files].map(e => e.path.replace(/^\//, ''))
  const mitDateien = new Set(pfade.filter(p => p.startsWith(`${ORDNER}/`)).map(p => p.split('/')[1]))
  const alle = await (await texPakete()).find({ projectId }).toArray()
  const rc = docs.find(d => d.path === '/latexmkrc')
  return {
    pfade,
    installiert: alle.filter(e => mitDateien.has(e.paket)),
    rcDoc: rc,
    rcDatei: files.some(f => f.path === '/latexmkrc'),
  }
}

async function latexmkrcSichern({ projectId, menschId, botId, stand, ordner, lauf }) {
  if (stand.rcDatei) return
  if (stand.rcDoc) {
    const doc = (await ProjectEntityHandler.promises.getAllDocs(projectId))['/latexmkrc']
    const text = doc.lines.join('\n')
    const ergaenzt = latexmkrcErgaenzen(text)
    if (ergaenzt === null) return
    await SchreibManager.docEdit({
      projectId,
      botId,
      pfad: 'latexmkrc',
      alt: '',
      neu: ergaenzt.slice(text.length),
      schluessel: `tex-pakete-rc-${lauf._id}`,
    })
    return
  }
  const datei = Path.join(ordner, 'latexmkrc')
  await fs.writeFile(datei, LATEXMKRC_BLOCK)
  // Nicht als Teil des Laufs verbucht: Pakete späterer Läufe brauchen dieselbe Datei.
  await EditorController.promises.upsertFileWithPath(projectId, '/latexmkrc', datei, null, 'spur', menschId)
}

// Abschalten per `SPUR_TEX_PAKETE=aus` oder in den spur-Einstellungen (Admin → Grenzen).
export async function abgeschaltet(einstellung) {
  return umgebung('SPUR_TEX_PAKETE') === 'aus' || (einstellung ?? (await standard())).texPaketeAus
}

// Gezählt werden nur gelungene Installationen der letzten Stunde.
const drosselId = menschId => `tex-pakete:${menschId}`

async function drosselPruefen(menschId, grenze) {
  const eintrag = await (await drossel()).findOne({ _id: drosselId(menschId) })
  const seit = Date.now() - STUNDE_MS
  if ((eintrag?.zeiten ?? []).filter(z => z.getTime() > seit).length >= grenze) {
    throw new WerkzeugFehler('zu_viele_anfragen', 'spur_fehler_tex_pakete_drossel', { anzahl: grenze })
  }
}

async function installationZaehlen(menschId) {
  await (await drossel()).updateOne(
    { _id: drosselId(menschId) },
    [{ $set: { zeiten: { $filter: { input: { $concatArrays: [{ $ifNull: ['$zeiten', []] }, ['$$NOW']] }, cond: { $gt: ['$$this', { $subtract: ['$$NOW', STUNDE_MS] }] } } } } }],
    { upsert: true }
  )
}

export async function drosselZuruecksetzen(menschId) {
  await (await drossel()).deleteOne({ _id: drosselId(menschId) })
}

// Ein Aufruf je Projekt und Paket: Ein zweiter (etwa nach einem Abbruch beim Client) wartet, bis der erste fertig
// oder zurückgerollt ist, und sieht dann dessen Ergebnis. Eine Sperre älter als zehn Minuten gilt als Rest.
async function gesperrt(projectId, paket, arbeit) {
  const sammlung = await drossel()
  const _id = `tex-sperre:${projectId}:${paket}`
  // Der Besitzer gibt nur die eigene Sperre frei, nicht die eines Aufrufs, der eine veraltete übernommen hat.
  const besitzer = randomUUID()
  for (;;) {
    const veraltet = new Date(Date.now() - SPERRE_VERALTET_MS)
    try {
      await sammlung.updateOne({ _id, seit: { $lt: veraltet } }, { $set: { seit: new Date(), besitzer } }, { upsert: true })
      break
    } catch (error) {
      if (error.code !== 11000) throw error
      await warten(500)
    }
  }
  try {
    return await arbeit()
  } finally {
    await sammlung.deleteOne({ _id, besitzer })
  }
}

async function ordnerEntfernen(projectId, menschId, pfad) {
  try {
    await EditorController.promises.deleteEntityWithPath(projectId, `/${pfad}`, 'spur', menschId)
  } catch (error) {
    if (!(error instanceof Errors.NotFoundError)) throw error
  }
}

// Nach einem Abbruch: der Paket-Ordner und tex-pakete/ selbst, wenn darin sonst nichts liegt.
async function zurueckrollen(projectId, menschId, paket) {
  await ordnerEntfernen(projectId, menschId, `${ORDNER}/${paket}`)
  const { pfade } = await projektStand(projectId)
  if (!pfade.some(p => p.startsWith(`${ORDNER}/`))) await ordnerEntfernen(projectId, menschId, ORDNER)
}

function hochladenFehler(error) {
  if (error instanceof WerkzeugFehler || error instanceof Problem) return error
  if (error instanceof Errors.TooManyFilesError) return zuVieleDateien(maxEintraege() + 1)
  return new WerkzeugFehler('paket_abgebrochen', 'spur_fehler_tex_paket_abgebrochen')
}

const zuVieleDateien = anzahl =>
  new WerkzeugFehler('projekt_zu_viele_dateien', 'spur_fehler_tex_zu_viele_dateien', { anzahl, grenze: maxEintraege() })

async function dateienHochladen({ projectId, menschId, paket, dateien, ziel }) {
  const angelegt = []
  for (const [i, d] of dateien.entries()) {
    const pause = Number(testSchalter('SPUR_TEX_UPLOAD_PAUSE_MS'))
    if (pause > 0) await warten(pause)
    if (Number(testSchalter('SPUR_TEX_UPLOAD_FEHLER')) === i + 1) throw new Error(`Testschalter: Upload ${i + 1} scheitert`)
    const pfad = `${ORDNER}/${paket}/${d.name}`
    await EditorController.promises.upsertFileWithPath(projectId, `/${pfad}`, Path.join(ziel, d.pfad), null, 'spur', menschId)
    angelegt.push(pfad)
  }
  return angelegt
}

export async function hinzufuegen({ projectId, menschId, botId, paket, datei }) {
  const einstellung = await standard()
  if (await abgeschaltet(einstellung)) throw new WerkzeugFehler('abgeschaltet', 'spur_fehler_tex_pakete_aus')
  if (Boolean(paket) === Boolean(datei)) throw new WerkzeugFehler('eingabe_ungueltig', 'spur_fehler_tex_paket_oder_datei')
  if (datei) paket = await paketFuerDatei(datei)
  paketNamePruefen(paket)
  const grenzen = texGrenzen(einstellung)
  const lokal = await lokaleDatenbank()
  if (lokal.namen.has(paket)) {
    return { paket, im_image: true, dateien: [], fehlende_abhaengigkeiten: [], hinweis: 'schon im Image' }
  }
  return await gesperrt(projectId, paket, async () => {
    const stand = await projektStand(projectId)
    const vorhanden = stand.installiert
    if (vorhanden.some(e => e.paket === paket)) {
      return { paket, im_image: false, dateien: [], fehlende_abhaengigkeiten: [], hinweis: 'schon im Projekt' }
    }
    await drosselPruefen(menschId, grenzen.texProStunde)
    await Speicher.nichtVollPruefen(projectId)
    const ordner = await fs.mkdtemp(Path.join(os.tmpdir(), 'spur-tex-'))
    try {
      const paketGrenze = grenzen.texPaketMb * MB
      const archiv = Path.join(ordner, 'paket.tar.xz')
      await herunterladen(paket, archiv, paketGrenze)
      const { stdout } = await ausfuehren('tar', ['-tvJf', archiv], { maxBuffer: 16 * MB })
      const imArchiv = eintraegePruefen(stdout)
      const entpackt = imArchiv.reduce((summe, e) => summe + e.groesse, 0)
      if (entpackt > paketGrenze) throw zuGross(paket, entpackt, paketGrenze)
      const dateien = laufzeitDateien(imArchiv)
      const bytes = dateien.reduce((summe, d) => summe + d.groesse, 0)
      const belegt = vorhanden.reduce((summe, e) => summe + e.bytes, 0)
      if (belegt + bytes > grenzen.texProjektMb * MB) {
        throw new WerkzeugFehler('projekt_voll', 'spur_fehler_tex_pakete_voll', { mb: grenzen.texProjektMb })
      }
      // Ein Ordner ohne Eintrag ist der Rest eines abgebrochenen Versuchs oder von Hand angelegt.
      const rest = stand.pfade.filter(p => p.startsWith(`${ORDNER}/${paket}/`)).length
      const danach = (await anzahlEintraege(projectId)) - rest + dateien.length + 1
      if (danach > maxEintraege()) throw zuVieleDateien(danach)
      const ziel = Path.join(ordner, 'x')
      await fs.mkdir(ziel)
      await ausfuehren('tar', ['-xJf', archiv, '-C', ziel, '--no-same-owner', '--no-same-permissions'])
      const tlpobj = await fs.readFile(Path.join(ziel, 'tlpkg', 'tlpobj', `${paket}.tlpobj`), 'utf8').catch(() => '')

      await ordnerEntfernen(projectId, menschId, `${ORDNER}/${paket}`)
      const freigeben = await Speicher.reservieren(projectId, bytes)
      let angelegt
      // Scheitert ein Schritt bis zum Eintrag, wird alles Angelegte entfernt; ein Fehler dabei wird geloggt, die
      // Antwort bleibt der erste Fehler. Der Eintrag kommt zuletzt: Erst er macht das Paket vollständig.
      try {
        try {
          angelegt = await dateienHochladen({ projectId, menschId, paket, dateien, ziel })
        } finally {
          await freigeben()
        }
        const lauf = await LaufManager.laufFuerSchreiben(projectId, botId)
        await latexmkrcSichern({ projectId, menschId, botId, stand, ordner, lauf })
        await LaufManager.angelegtMerken(lauf, [{ art: 'ordner', pfad: `${ORDNER}/${paket}`, paket, bytes }])
        await (await texPakete()).updateOne({ projectId, paket }, { $set: { bytes } }, { upsert: true })
      } catch (error) {
        logger.warn({ err: error, projectId, paket }, 'TeX-Paket: Installation gescheitert, rolle zurück')
        await zurueckrollen(projectId, menschId, paket).catch(fehler =>
          logger.error({ err: fehler, projectId, paket }, 'TeX-Paket: Zurückrollen gescheitert')
        )
        throw hochladenFehler(error)
      }
      await installationZaehlen(menschId).catch(error => logger.error({ err: error, menschId }, 'TeX-Paket: Drossel nicht gezählt'))

      const imProjekt = new Set([...vorhanden.map(e => e.paket), paket])
      return {
        paket,
        im_image: false,
        dateien: angelegt,
        fehlende_abhaengigkeiten: abhaengigkeiten(tlpobj).filter(n => !lokal.namen.has(n) && !imProjekt.has(n)),
      }
    } finally {
      await fs.rm(ordner, { recursive: true, force: true })
    }
  })
}

// Für „Lauf rückgängig“: die Buchung des entfernten Paket-Ordners löschen.
export async function paketEntfernt(projectId, paket) {
  await (await texPakete()).deleteOne({ projectId, paket })
}
