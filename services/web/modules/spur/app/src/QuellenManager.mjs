import { createHash } from 'node:crypto'
import _ from 'lodash'
import fs from 'node:fs/promises'
import Path from 'node:path'
import archiver from 'archiver'
import logger from '@overleaf/logger'
import Settings from '@overleaf/settings'
import { db, ObjectId } from '../../../../app/src/infrastructure/mongodb.mjs'
import { Problem } from './probleme.mjs'
import { bearbeitungen, beschaffungen, einstellungen, ereignisse, jobs, klone, laeufe, matrixSpalten, matrixZellen, nachrichten, notizen, pruefCache, quellen, quellenSeiten, quotes, suchprotokoll, vorschlaege } from './sammlungen.mjs'
import { IST_DEV, jetzt } from './schalter.mjs'
import * as Crossref from './Crossref.mjs'
import { ocrSeite, seitenBild, seitenTexte, versatzAusLabels, vttSeiten } from './pdf.mjs'
import { abrufen } from './WebSchnappschuss.mjs'
import { quelleGeaendert } from './live.mjs'

export const MAX_BYTES = 50 * 1024 * 1024
const SEITE_LISTE = 100
const SUCH_TREFFER = 50
const DOI = /\b10\.\d{4,9}\/[^\s"<>]+?(?=[.,;:)\]]*(?:\s|$))/

export const ablageWurzel = () =>
  Path.join(Path.dirname(Settings.path.compilesDir), 'spur')

export const dateiPfad = quelle =>
  Path.join(
    ablageWurzel(),
    String(quelle.projectId),
    `${quelle._id}${Path.extname(quelle.dateiname).toLowerCase()}`
  )

function schluesselAus(dateiname) {
  return Path.basename(dateiname, Path.extname(dateiname)).replace(
    /[^\p{L}\p{N}_:-]/gu,
    '-'
  )
}

function versatzInSpanne(versatz, seitenzahl, spanne) {
  const m = /^(\d+)\D+(\d+)$/.exec(spanne ?? '')
  if (versatz == null || !m) return false
  return versatz + 1 >= Number(m[1]) && versatz + seitenzahl <= Number(m[2])
}

async function pdfAuslesen(pfad) {
  const texte = await seitenTexte(pfad).catch(error => {
    logger.warn({ err: error }, 'PDF nicht lesbar')
    throw new Problem(
      422,
      'datei_unlesbar',
      'Die PDF-Datei lässt sich nicht lesen. Bitte eine andere Fassung hochladen.'
    )
  })
  const seiten = texte.map((text, i) => ({ seite: i + 1, label: null, text }))
  const hatText = texte.some(t => t.trim())
  const doi = hatText ? DOI.exec(texte.slice(0, 2).join('\n'))?.[0] : null
  const meta = doi ? await Crossref.werk(doi) : null
  const versatz = await versatzAusLabels(pfad).catch(() => null)
  const belegt =
    meta?.gefunden && versatzInSpanne(versatz, seiten.length, meta.seiten)
  // Vorspannseiten (römisch) ergäben Labels unter 1: dort lieber keine Seitenzahl.
  for (const s of seiten) s.label = belegt && s.seite + versatz >= 1 ? String(s.seite + versatz) : null
  return {
    seiten,
    hatText,
    doi: doi ?? null,
    meta,
    versatz: belegt ? versatz : null,
    versatzQuelle: belegt ? 'pagelabels' : null,
  }
}

async function vttAuslesen(pfad) {
  const abschnitte = vttSeiten(await fs.readFile(pfad, 'utf8'))
  return {
    seiten: abschnitte.map((a, i) => ({ seite: i + 1, ...a })),
    hatText: abschnitte.length > 0,
    doi: null,
    meta: null,
    versatz: null,
    versatzQuelle: null,
  }
}

const AUSLESER = { '.pdf': pdfAuslesen, '.vtt': vttAuslesen }

function pruefeDateityp(dateiname) {
  if (!AUSLESER[Path.extname(dateiname).toLowerCase()]) {
    throw new Problem(
      415,
      'dateityp',
      'Dieser Dateityp wird nicht unterstützt. Bitte eine PDF- oder VTT-Datei hochladen.'
    )
  }
}

const vorhandenFehler = name =>
  new Problem(
    409,
    'quelle_vorhanden',
    `„${name}“ ist schon vorhanden. Bitte die Datei umbenennen oder die alte Quelle löschen.`
  )

// Legt Quelle, Datei und Seiten an. Der eindeutige Index auf (projectId, key) entscheidet bei
// gleichzeitigen Aufnahmen; scheitert danach etwas, bleibt nichts zurück.
async function speichern(quelle, seitenListe, schreibeDatei) {
  try {
    await (await quellen()).insertOne(quelle)
  } catch (error) {
    if (error.code === 11000) throw vorhandenFehler(quelle.dateiname)
    throw error
  }
  try {
    const ziel = dateiPfad(quelle)
    await fs.mkdir(Path.dirname(ziel), { recursive: true })
    await schreibeDatei(ziel)
    if (seitenListe.length) {
      await (await quellenSeiten()).insertMany(
        seitenListe.map(s => ({ quelleId: quelle._id, projectId: quelle.projectId, ...s }))
      )
    }
  } catch (error) {
    await loeschen(quelle)
    throw error
  }
  return quelle
}

// key, doi und meta gibt die Aufnahme per DOI vor; sonst stammen sie aus Dateiname und PDF.
export async function aufnehmen({ projectId, userId, dateiname, tempPfad, groesse, key: vorgabe, doi, meta, nurProjekt = false }) {
  pruefeDateityp(dateiname)
  const key = vorgabe ?? schluesselAus(dateiname)
  if (await (await quellen()).findOne({ projectId, key })) throw vorhandenFehler(dateiname)
  const inhalt = await AUSLESER[Path.extname(dateiname).toLowerCase()](tempPfad)
  const quelle = {
    _id: new ObjectId(),
    projectId,
    dateiname,
    key,
    groesse,
    art: Path.extname(dateiname).slice(1).toLowerCase(),
    seitenzahl: inhalt.seiten.length,
    status: inhalt.hatText ? 'text' : 'kein_text',
    doi: doi ?? inhalt.doi,
    meta: meta ?? inhalt.meta,
    nurProjekt,
    versatz: inhalt.versatz,
    versatzQuelle: inhalt.versatzQuelle,
    fassung: '',
    angelegtVon: userId,
    angelegtAm: jetzt(),
  }
  return await speichern(quelle, inhalt.seiten, ziel => fs.copyFile(tempPfad, ziel))
}

const slug = text =>
  text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/, '')

// Ein datierter Schnappschuss: Text, Adresse, Abrufzeit und Hash des Textes; die HTML-Datei bleibt.
export async function webAufnehmen({ projectId, userId, url }) {
  // Im Dev-Stack liegt die Testseite im lokalen Netz.
  const seite = await abrufen(url, IST_DEV ? { gesperrt: () => false } : {})
  const adresse = new URL(seite.url)
  const sammlung = await quellen()
  // Viele Seiten heißen gleich („Startseite“): dann mit Zähler, statt zum Umbenennen aufzufordern.
  const basis = slug(seite.titel ?? '') || slug(`${adresse.hostname}${adresse.pathname}`) || 'webseite'
  const [gleich, belegteKeys] = await Promise.all([
    sammlung.findOne({ projectId, 'web.url': seite.url }),
    sammlung.distinct('key', { projectId, key: new RegExp(`^${_.escapeRegExp(basis)}(-\\d+)?$`) }),
  ])
  if (gleich) {
    throw new Problem(
      409,
      'quelle_vorhanden',
      `Diese Webseite ist schon als Quelle vorhanden („${gleich.meta?.titel ?? gleich.dateiname}“).`
    )
  }
  const belegt = new Set(belegteKeys)
  let key = basis
  for (let n = 2; belegt.has(key); n++) key = `${basis}-${n}`
  const html = Buffer.from(seite.html)
  const quelle = {
    _id: new ObjectId(),
    projectId,
    dateiname: `${key}.html`,
    key,
    groesse: html.length,
    art: 'web',
    seitenzahl: 1,
    status: seite.text ? 'text' : 'kein_text',
    doi: null,
    meta: { titel: seite.titel },
    web: {
      url: seite.url,
      abgerufenAm: jetzt(),
      hash: createHash('sha256').update(seite.text).digest('hex'),
    },
    versatz: null,
    versatzQuelle: null,
    fassung: '',
    angelegtVon: userId,
    angelegtAm: jetzt(),
  }
  return await speichern(quelle, [{ seite: 1, label: null, text: seite.text }], ziel =>
    fs.writeFile(ziel, html)
  )
}

// Schreibt die Seite nach jeder Seite fort; steht sie länger still, ist der Prozess weg (Neustart).
const OCR_VERWAIST_MS = 10 * 60 * 1000

export function ocrZustand(quelle) {
  if (!quelle.ocr) return null
  const { status, fertig, gesamt, konfidenz = null, aktualisiert } = quelle.ocr
  const verwaist = status === 'laeuft' && jetzt() - aktualisiert > OCR_VERWAIST_MS
  return { status: verwaist ? 'abgebrochen' : status, fertig, gesamt, konfidenz }
}

// Rastern und Tesseract brauchen viel Rechenzeit im Web-Prozess: höchstens zwei Läufe zugleich.
const OCR_PARALLEL = 2
let ocrLaeufe = 0

export async function ocrStarten(quelle) {
  // Auch eine fertige OCR-Quelle nicht neu erkennen: Bestätigte Stellen bezögen sich sonst auf
  // einen Text, den es nicht mehr gibt.
  if (quelle.art !== 'pdf' || quelle.status !== 'kein_text') {
    throw new Problem(
      409,
      'ocr_unnoetig',
      'Diese Quelle hat schon Text. Texterkennung gibt es nur für gescannte PDFs ohne Text.'
    )
  }
  if (ocrLaeufe >= OCR_PARALLEL) {
    throw new Problem(
      429,
      'ocr_ausgelastet',
      'Gerade laufen schon zwei Texterkennungen. Bitte in einigen Minuten erneut starten.'
    )
  }
  const nun = jetzt()
  const neu = await (await quellen()).findOneAndUpdate(
    {
      _id: quelle._id,
      $or: [
        { 'ocr.status': { $ne: 'laeuft' } },
        { 'ocr.aktualisiert': { $lt: new Date(nun - OCR_VERWAIST_MS) } },
      ],
    },
    {
      $set: {
        ocr: { status: 'laeuft', fertig: 0, gesamt: quelle.seitenzahl, aktualisiert: nun },
      },
    },
    { returnDocument: 'after' }
  )
  if (!neu) {
    throw new Problem(409, 'ocr_laeuft', 'Die Texterkennung läuft schon. Bitte kurz warten.')
  }
  quelleGeaendert(neu)
  ocrLaeufe++
  const lauf = ocrAusfuehren(neu)
    .catch(error => logger.error({ err: error, quelleId: neu._id }, 'spur: Texterkennung ohne Abschluss'))
    .finally(() => ocrLaeufe--)
  return { quelle: neu, lauf }
}

async function ocrAusfuehren(quelle) {
  const sammlung = await quellen()
  const seiten = await quellenSeiten()
  const ergebnisse = []
  try {
    for (let nr = 1; nr <= quelle.seitenzahl; nr++) {
      const ergebnis = await ocrSeite(dateiPfad(quelle), nr)
      ergebnisse.push(ergebnis)
      await seiten.updateOne(
        { quelleId: quelle._id, seite: nr },
        { $set: { text: ergebnis.text, ocrKonfidenz: ergebnis.konfidenz } }
      )
      const { matchedCount } = await sammlung.updateOne(
        { _id: quelle._id },
        { $set: { 'ocr.fertig': nr, 'ocr.aktualisiert': jetzt() } }
      )
      // Quelle inzwischen gelöscht: nicht weiter rechnen.
      if (!matchedCount) return
      quelleGeaendert(quelle)
    }
    const werte = ergebnisse.map(e => e.konfidenz).filter(k => k !== null)
    await sammlung.updateOne(
      { _id: quelle._id },
      {
        $set: {
          status: ergebnisse.some(e => e.text.trim()) ? 'ocr' : 'kein_text',
          'ocr.status': 'fertig',
          'ocr.konfidenz': werte.length ? Math.round(_.mean(werte)) : null,
          'ocr.aktualisiert': jetzt(),
        },
      }
    )
  } catch (error) {
    logger.warn({ err: error, quelleId: quelle._id }, 'spur: Texterkennung fehlgeschlagen')
    await sammlung.updateOne(
      { _id: quelle._id },
      { $set: { 'ocr.status': 'fehler', 'ocr.aktualisiert': jetzt() } }
    )
  }
  quelleGeaendert(quelle)
}

export async function liste(projectId, { seite = 0 } = {}) {
  const sammlung = await quellen()
  const [eintraege, gesamt] = await Promise.all([
    sammlung
      .find({ projectId })
      .sort({ dateiname: 1 })
      .skip(seite * SEITE_LISTE)
      .limit(SEITE_LISTE)
      .toArray(),
    sammlung.countDocuments({ projectId }),
  ])
  return { quellen: eintraege, gesamt, seitengroesse: SEITE_LISTE }
}

export async function alle(projectId) {
  return await (await quellen()).find({ projectId }).toArray()
}

export async function vonIds(projectId, ids) {
  return await (await quellen()).find({ _id: { $in: ids }, projectId }).toArray()
}

export async function holen(projectId, quelleId) {
  if (!ObjectId.isValid(quelleId)) throw quelleFehlt()
  const quelle = await (await quellen()).findOne({
    _id: new ObjectId(quelleId),
    projectId,
  })
  if (!quelle) throw quelleFehlt()
  return quelle
}

function quelleFehlt() {
  return new Problem(
    404,
    'quelle_fehlt',
    'Diese Quelle gibt es nicht mehr. Bitte die Liste neu laden.'
  )
}

export async function seitenVon(quelleIds) {
  const seiten = await (await quellenSeiten())
    .find({ quelleId: { $in: quelleIds } })
    .sort({ seite: 1 })
    .toArray()
  const nachQuelle = new Map()
  for (const s of seiten) {
    const key = String(s.quelleId)
    if (!nachQuelle.has(key)) nachQuelle.set(key, [])
    nachQuelle.get(key).push(s)
  }
  return nachQuelle
}

export async function seite(quelle, nummer) {
  const eintrag = await (await quellenSeiten()).findOne({
    quelleId: quelle._id,
    seite: nummer,
  })
  if (!eintrag) {
    throw new Problem(404, 'seite_fehlt', 'Diese Seite gibt es in der Quelle nicht.')
  }
  return eintrag
}

export async function bild(quelle, nummer) {
  const ziel = Path.join(Path.dirname(dateiPfad(quelle)), `${quelle._id}-${nummer}`)
  const pfad = `${ziel}.png`
  try {
    await fs.access(pfad)
    return pfad
  } catch {
    return await seitenBild(dateiPfad(quelle), nummer, ziel)
  }
}

function auszug(text, begriff) {
  const flach = text.replace(/\s+/g, ' ')
  const pos = flach.toLowerCase().indexOf(begriff.toLowerCase())
  const von = Math.max(0, pos - 60)
  return flach.slice(von, von + 160).trim()
}

export async function suchen(projectId, begriff) {
  const seiten = await quellenSeiten()
  const phrase = `"${begriff.replace(/"/g, ' ')}"`
  const treffer = await seiten
    .find({ projectId, $text: { $search: phrase } })
    .sort({ quelleId: 1, seite: 1 })
    .limit(SUCH_TREFFER)
    .toArray()
  const ids = [...new Set(treffer.map(t => String(t.quelleId)))].map(
    id => new ObjectId(id)
  )
  const namen = new Map(
    (
      await (await quellen())
        .find({ _id: { $in: ids }, projectId }, { projection: { dateiname: 1, art: 1 } })
        .toArray()
    ).map(q => [String(q._id), q])
  )
  return treffer.map(t => ({
    quelleId: t.quelleId,
    dateiname: namen.get(String(t.quelleId))?.dateiname,
    art: namen.get(String(t.quelleId))?.art,
    seite: t.seite,
    label: t.label,
    position: t.text.toLowerCase().indexOf(begriff.toLowerCase()),
    auszug: auszug(t.text, begriff),
  }))
}

// Quellen, deren Dateiname den Begriff enthält (ohne Groß-/Kleinschreibung).
export async function dateinamenSuchen(projectId, begriff, grenze = 20) {
  const muster = new RegExp(_.escapeRegExp(begriff), 'i')
  return await (await quellen())
    .find({ projectId, dateiname: muster })
    .sort({ dateiname: 1 })
    .limit(grenze)
    .toArray()
}

export async function aendern(quelle, { fassung, versatz }) {
  const felder = {}
  if (fassung !== undefined) felder.fassung = fassung
  if (versatz !== undefined) {
    felder.versatz = versatz
    felder.versatzQuelle = versatz === null ? null : 'bestaetigt'
    await (await quellenSeiten()).updateMany({ quelleId: quelle._id }, [
      {
        $set: {
          // Wie beim Einlesen: Vorspannseiten ergäben Labels unter 1, dort keine Seitenzahl.
          label:
            versatz === null
              ? null
              : {
                  $cond: [
                    { $gte: [{ $add: ['$seite', versatz] }, 1] },
                    { $toString: { $add: ['$seite', versatz] } },
                    null,
                  ],
                },
        },
      },
    ])
  }
  await (await quellen()).updateOne({ _id: quelle._id }, { $set: felder })
  return { ...quelle, ...felder }
}

export async function loeschen(quelle) {
  await (await quotes()).deleteMany({ quelleId: quelle._id })
  await (await quellenSeiten()).deleteMany({ quelleId: quelle._id })
  const zuQuelle = { projectId: quelle.projectId, quelleId: quelle._id }
  await (await notizen()).deleteMany(zuQuelle)
  await (await matrixZellen()).deleteMany(zuQuelle)
  // Ohne PDF ist der Eintrag wieder offen und lässt sich neu beschaffen.
  await (await beschaffungen()).updateMany(
    zuQuelle,
    { $set: { status: 'offen' }, $unset: { quelleId: '', beschafftAm: '' } }
  )
  await (await quellen()).deleteOne({ _id: quelle._id })
  const ordner = Path.dirname(dateiPfad(quelle))
  for (const name of await fs.readdir(ordner).catch(() => [])) {
    if (name.startsWith(String(quelle._id))) {
      await fs.rm(Path.join(ordner, name), { force: true })
    }
  }
}

export async function projektAufraeumen(projectId) {
  const id = new ObjectId(projectId)
  await Promise.all([
    (await quotes()).deleteMany({ projectId: id }),
    (await quellenSeiten()).deleteMany({ projectId: id }),
    (await quellen()).deleteMany({ projectId: id }),
    (await pruefCache()).deleteMany({ projectId: id }),
    (await klone()).deleteOne({ _id: id }),
    // Aufträge, Antworten, Läufe samt Kontextauszügen, Vorschläge und Einstellungen gehören zum Projekt.
    (await nachrichten()).deleteMany({ projectId: id }),
    (await ereignisse()).deleteMany({ projectId: id }),
    (await laeufe()).deleteMany({ projectId: id }),
    (await bearbeitungen()).deleteMany({ projectId: id }),
    (await einstellungen()).deleteMany({ projectId: id }),
    (await suchprotokoll()).deleteMany({ projectId: id }),
    (await beschaffungen()).deleteMany({ projectId: id }),
    (await notizen()).deleteMany({ projectId: id }),
    (await matrixSpalten()).deleteOne({ _id: id }),
    (await matrixZellen()).deleteMany({ projectId: id }),
    (await jobs()).deleteMany({ projectId: id }),
    (await vorschlaege()).deleteMany({ projectId: id }),
  ])
  await fs.rm(Path.join(ablageWurzel(), String(id)), { recursive: true, force: true })
}

export async function klonMerken(originalProjectId, neuesProjekt) {
  const hatQuellen = await (await quellen()).findOne({
    projectId: new ObjectId(originalProjectId),
  })
  if (hatQuellen) {
    await (await klone()).insertOne({
      _id: neuesProjekt,
      vonProjekt: new ObjectId(originalProjectId),
    })
  }
}

export async function klonHinweis(projectId) {
  const klon = await (await klone()).findOne({ _id: projectId })
  if (!klon) return null
  const projekt = await db.projects.findOne(
    { _id: klon.vonProjekt },
    { projection: { name: 1 } }
  )
  return projekt && { id: projekt._id, name: projekt.name }
}

async function quelleKopieren(quelle, zielProjekt, userId) {
  const neu = {
    ...quelle,
    _id: new ObjectId(),
    projectId: zielProjekt,
    angelegtVon: userId,
    angelegtAm: jetzt(),
    // Eine laufende Texterkennung gehört zum alten Projekt; dort läuft sie weiter.
    ocr: quelle.ocr?.status === 'laeuft' ? null : (quelle.ocr ?? null),
  }
  try {
    await kopieAnlegen(quelle, neu, zielProjekt)
  } catch (error) {
    // Keine Seiten, Zitate oder Dateien ohne Quellen-Dokument zurücklassen.
    await Promise.all([
      (await quellenSeiten()).deleteMany({ quelleId: neu._id }),
      (await quotes()).deleteMany({ quelleId: neu._id }),
      fs.rm(dateiPfad(neu), { force: true }),
    ])
    throw error
  }
}

async function kopieAnlegen(quelle, neu, zielProjekt) {
  const ziel = dateiPfad(neu)
  await fs.mkdir(Path.dirname(ziel), { recursive: true })
  await fs.copyFile(dateiPfad(quelle), ziel)
  const seiten = await (await quellenSeiten())
    .find({ quelleId: quelle._id })
    .toArray()
  if (seiten.length) {
    await (await quellenSeiten()).insertMany(
      seiten.map(({ _id, ...s }) => ({
        ...s,
        quelleId: neu._id,
        projectId: zielProjekt,
      }))
    )
  }
  const marken = await (await quotes()).find({ quelleId: quelle._id }).toArray()
  if (marken.length) {
    await (await quotes()).insertMany(
      // Kommentare und Zuweisungen gehören zum Team des alten Projekts. Die Bestätigung einer Stelle
      // betrifft den Quelltext und gilt weiter.
      marken.map(({ _id, ...q }) => ({
        ...q,
        quelleId: neu._id,
        projectId: zielProjekt,
        kommentare: [],
        zugewiesen: null,
      }))
    )
  }
  await (await quellen()).insertOne(neu)
}

export async function uebernehmen(zielProjekt, vonProjekt, userId) {
  const vorhanden = new Set((await alle(zielProjekt)).map(q => q.key))
  const neu = (await alle(vonProjekt)).filter(q => !vorhanden.has(q.key) && !q.nurProjekt)
  for (const quelle of neu) await quelleKopieren(quelle, zielProjekt, userId)
  await (await klone()).deleteOne({ _id: zielProjekt })
  return neu.length
}

export async function projekteMitQuellen(userId, ohneProjekt) {
  const projekte = await db.projects
    .find(
      {
        _id: { $ne: ohneProjekt },
        $or: [
          { owner_ref: userId },
          { collaberator_refs: userId },
          { reviewer_refs: userId },
          { readOnly_refs: userId },
        ],
      },
      { projection: { name: 1 } }
    )
    .toArray()
  const mitQuellen = await (await quellen()).distinct('projectId', {
    projectId: { $in: projekte.map(p => p._id) },
    nurProjekt: { $ne: true },
  })
  const ids = new Set(mitQuellen.map(String))
  return projekte
    .filter(p => ids.has(String(p._id)))
    .map(p => ({ id: p._id, name: p.name }))
}

export async function zipSchreiben(projectId, ausgabe) {
  const archiv = archiver('zip')
  archiv.on('error', error => ausgabe.destroy(error))
  archiv.pipe(ausgabe)
  for (const quelle of await alle(projectId)) {
    archiv.file(dateiPfad(quelle), { name: quelle.dateiname })
  }
  await archiv.finalize()
}
