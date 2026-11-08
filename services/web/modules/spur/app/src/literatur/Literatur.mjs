import { ObjectId } from '../../../../../app/src/infrastructure/mongodb.mjs'
import { csv } from '../csv.mjs'
import { Problem } from '../probleme.mjs'
import { matrixSpalten, matrixZellen, notizen as notizSammlung, quellen } from '../sammlungen.mjs'
import { jetzt } from '../schalter.mjs'

const MAX_NOTIZ = 20000
const MAX_ZELLE = 2000
const MAX_SPALTEN = 30
const ZEILEN_SEITE = 50

const zuLang = max => new Problem(413, 'zu_lang', `Höchstens ${max} Zeichen. Bitte kürzen.`)
const quelleFehlt = () => new Problem(404, 'quelle_fehlt', 'Diese Quelle gibt es nicht mehr. Bitte die Liste neu laden.')
const spalteFehlt = () => new Problem(404, 'spalte_fehlt', 'Diese Spalte gibt es nicht. Bitte zuerst in der Matrix anlegen.')

export async function notizen(quelle) {
  const liste = await (await notizSammlung()).find({ projectId: quelle.projectId, quelleId: quelle._id }).sort({ zitatId: 1 }).toArray()
  return liste.map(n => ({ zitatId: n.zitatId ? String(n.zitatId) : null, text: n.text }))
}

// Eine Notiz je Quelle und eine je Zitat. Leerer Text löscht sie.
export async function notizSetzen(projectId, quelle, { zitatId, text, userId }) {
  const wert = String(text ?? '').trim()
  if (wert.length > MAX_NOTIZ) throw zuLang(MAX_NOTIZ)
  if (zitatId && !ObjectId.isValid(zitatId)) throw new Problem(404, 'zitat_fehlt', 'Dieses Zitat gibt es nicht mehr.')
  const filter = { projectId, quelleId: quelle._id, zitatId: zitatId ? new ObjectId(zitatId) : null }
  const sammlung = await notizSammlung()
  if (!wert) return void (await sammlung.deleteOne(filter))
  await sammlung.updateOne(filter, { $set: { text: wert, geaendertVon: userId, geaendertAm: jetzt() } }, { upsert: true })
}

async function spaltenVon(projectId) {
  return (await (await matrixSpalten()).findOne({ _id: projectId }))?.spalten ?? []
}

export async function spalteAnlegen(projectId, name) {
  const wert = String(name ?? '').trim()
  if (!wert || wert.length > 80) {
    throw new Problem(400, 'spalte_ungueltig', 'Bitte einen Spaltennamen mit 1 bis 80 Zeichen angeben.')
  }
  const spalten = await spaltenVon(projectId)
  if (spalten.some(s => s.name.toLowerCase() === wert.toLowerCase())) {
    throw new Problem(409, 'spalte_vorhanden', `Die Spalte „${wert}“ gibt es schon.`)
  }
  if (spalten.length >= MAX_SPALTEN) throw new Problem(409, 'zu_viele_spalten', `Höchstens ${MAX_SPALTEN} Spalten.`)
  const spalte = { id: String(new ObjectId()), name: wert }
  // Die Bedingung auf die Länge verhindert, dass zwei gleichzeitige Aufrufe denselben Platz belegen.
  const ergebnis = await (await matrixSpalten()).updateOne(
    { _id: projectId, 'spalten.name': { $ne: wert }, [`spalten.${MAX_SPALTEN - 1}`]: { $exists: false } },
    { $push: { spalten: spalte } },
    { upsert: true }
  ).catch(error => {
    if (error.code === 11000) throw new Problem(409, 'spalte_vorhanden', `Die Spalte „${wert}“ gibt es schon.`)
    throw error
  })
  if (!ergebnis.modifiedCount && !ergebnis.upsertedCount) throw new Problem(409, 'spalte_vorhanden', `Die Spalte „${wert}“ gibt es schon.`)
  return spalte
}

async function quelleImProjekt(projectId, quelleId) {
  const quelle = ObjectId.isValid(quelleId) && (await (await quellen()).findOne({ _id: new ObjectId(quelleId), projectId }))
  if (!quelle) throw quelleFehlt()
  return quelle
}

async function zelle(projectId, quelleId, spalteId) {
  const quelle = await quelleImProjekt(projectId, quelleId)
  if (!(await spaltenVon(projectId)).some(s => s.id === spalteId)) throw spalteFehlt()
  return { projectId, quelleId: quelle._id, spalteId }
}

export async function zelleSetzen(projectId, { quelleId, spalteId, text }) {
  const wert = String(text ?? '')
  if (wert.length > MAX_ZELLE) throw zuLang(MAX_ZELLE)
  await (await matrixZellen()).updateOne(await zelle(projectId, quelleId, spalteId), { $set: { text: wert } }, { upsert: true })
}

// Claude schlägt nur vor; in die Zelle kommt der Text erst, wenn die Person bestätigt.
export async function vorschlagen(projectId, { quelleId, spalte, text, botId }) {
  const wert = String(text ?? '').trim()
  if (wert.length > MAX_ZELLE) throw zuLang(MAX_ZELLE)
  const treffer = (await spaltenVon(projectId)).find(s => s.name.toLowerCase() === String(spalte).trim().toLowerCase())
  if (!treffer) throw spalteFehlt()
  const filter = await zelle(projectId, quelleId, treffer.id)
  await (await matrixZellen()).updateOne(
    filter,
    { $set: { vorschlag: { text: wert, von: botId, am: jetzt() } }, $setOnInsert: { text: '' } },
    { upsert: true }
  )
  return { quelle_id: String(filter.quelleId), spalte: treffer.name }
}

export async function vorschlagBestaetigen(projectId, { quelleId, spalteId }) {
  const filter = await zelle(projectId, quelleId, spalteId)
  const sammlung = await matrixZellen()
  const eintrag = await sammlung.findOne({ ...filter, vorschlag: { $type: 'object' } })
  if (!eintrag) throw new Problem(409, 'kein_vorschlag', 'Für diese Zelle gibt es keinen Vorschlag mehr.')
  await sammlung.updateOne({ _id: eintrag._id }, { $set: { text: eintrag.vorschlag.text }, $unset: { vorschlag: '' } })
}

export async function vorschlagVerwerfen(projectId, { quelleId, spalteId }) {
  await (await matrixZellen()).updateOne(await zelle(projectId, quelleId, spalteId), { $unset: { vorschlag: '' } })
}

function zellenNachQuelle(liste) {
  const karte = new Map()
  for (const z of liste) {
    const key = String(z.quelleId)
    if (!karte.has(key)) karte.set(key, {})
    karte.get(key)[z.spalteId] = { text: z.text ?? '', vorschlag: z.vorschlag ? { text: z.vorschlag.text } : null }
  }
  return karte
}

export async function matrix(projectId, { seite = 1 } = {}) {
  const sammlung = await quellen()
  const [spalten, gesamt, zeilenQuellen] = await Promise.all([
    spaltenVon(projectId),
    sammlung.countDocuments({ projectId }),
    sammlung
      .find({ projectId }, { projection: { dateiname: 1, key: 1 } })
      .sort({ dateiname: 1 })
      .skip((seite - 1) * ZEILEN_SEITE)
      .limit(ZEILEN_SEITE)
      .toArray(),
  ])
  const zellen = zellenNachQuelle(
    await (await matrixZellen()).find({ projectId, quelleId: { $in: zeilenQuellen.map(q => q._id) } }).toArray()
  )
  const leer = { text: '', vorschlag: null }
  return {
    spalten,
    seite,
    proSeite: ZEILEN_SEITE,
    gesamt,
    zeilen: zeilenQuellen.map(q => ({
      quelle: { id: String(q._id), dateiname: q.dateiname, key: q.key },
      zellen: Object.fromEntries(spalten.map(s => [s.id, zellen.get(String(q._id))?.[s.id] ?? leer])),
    })),
  }
}

export async function matrixCsv(projectId) {
  const spalten = await spaltenVon(projectId)
  const alle = await (await quellen()).find({ projectId }, { projection: { dateiname: 1, key: 1 } }).sort({ dateiname: 1 }).toArray()
  const zellen = zellenNachQuelle(await (await matrixZellen()).find({ projectId }).toArray())
  return csv(
    ['Quelle', 'Key', ...spalten.map(s => s.name)],
    alle.map(q => [q.dateiname, q.key, ...spalten.map(s => zellen.get(String(q._id))?.[s.id]?.text ?? '')])
  )
}
