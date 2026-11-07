import fs from 'node:fs/promises'
import Path from 'node:path'
import archiver from 'archiver'
import logger from '@overleaf/logger'
import Settings from '@overleaf/settings'
import { db, ObjectId } from '../../../../app/src/infrastructure/mongodb.mjs'
import { Problem } from './probleme.mjs'
import { bearbeitungen, einstellungen, ereignisse, klone, laeufe, nachrichten, pruefCache, quellen, quellenSeiten, quotes } from './sammlungen.mjs'
import { jetzt } from './schalter.mjs'
import * as Crossref from './Crossref.mjs'
import { seitenBild, seitenTexte, versatzAusLabels, vttSeiten } from './pdf.mjs'

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

export async function aufnehmen({ projectId, userId, dateiname, tempPfad, groesse }) {
  pruefeDateityp(dateiname)
  const sammlung = await quellen()
  const key = schluesselAus(dateiname)
  const vorhanden = () =>
    new Problem(
      409,
      'quelle_vorhanden',
      `„${dateiname}“ ist schon vorhanden. Bitte die Datei umbenennen oder die alte Quelle löschen.`
    )
  if (await sammlung.findOne({ projectId, key })) throw vorhanden()
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
    doi: inhalt.doi,
    meta: inhalt.meta,
    versatz: inhalt.versatz,
    versatzQuelle: inhalt.versatzQuelle,
    fassung: '',
    angelegtVon: userId,
    angelegtAm: jetzt(),
  }
  // Der eindeutige Index auf (projectId, key) entscheidet bei gleichzeitigen Uploads.
  try {
    await sammlung.insertOne(quelle)
  } catch (error) {
    if (error.code === 11000) throw vorhanden()
    throw error
  }
  try {
    const ziel = dateiPfad(quelle)
    await fs.mkdir(Path.dirname(ziel), { recursive: true })
    await fs.copyFile(tempPfad, ziel)
    if (inhalt.seiten.length) {
      await (await quellenSeiten()).insertMany(
        inhalt.seiten.map(s => ({ quelleId: quelle._id, projectId, ...s }))
      )
    }
  } catch (error) {
    await loeschen(quelle)
    throw error
  }
  return quelle
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

export async function aendern(quelle, { fassung, versatz }) {
  const felder = {}
  if (fassung !== undefined) felder.fassung = fassung
  if (versatz !== undefined) {
    felder.versatz = versatz
    felder.versatzQuelle = versatz === null ? null : 'bestaetigt'
    await (await quellenSeiten()).updateMany({ quelleId: quelle._id }, [
      {
        $set: {
          label:
            versatz === null
              ? null
              : { $toString: { $add: ['$seite', versatz] } },
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
    // Aufträge, Antworten, Läufe samt Kontextauszügen und Einstellungen gehören zum Projekt.
    (await nachrichten()).deleteMany({ projectId: id }),
    (await ereignisse()).deleteMany({ projectId: id }),
    (await laeufe()).deleteMany({ projectId: id }),
    (await bearbeitungen()).deleteMany({ projectId: id }),
    (await einstellungen()).deleteMany({ projectId: id }),
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
      marken.map(({ _id, ...q }) => ({
        ...q,
        quelleId: neu._id,
        projectId: zielProjekt,
      }))
    )
  }
  await (await quellen()).insertOne(neu)
}

export async function uebernehmen(zielProjekt, vonProjekt, userId) {
  const vorhanden = new Set((await alle(zielProjekt)).map(q => q.key))
  const neu = (await alle(vonProjekt)).filter(q => !vorhanden.has(q.key))
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
