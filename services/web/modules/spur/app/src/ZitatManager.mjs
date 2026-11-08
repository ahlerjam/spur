// EditorController meldet neue Dateien sofort an offene Editoren (Dateibaum).
import EditorController from '../../../../app/src/Features/Editor/EditorController.mjs'
import { ObjectId } from '../../../../app/src/infrastructure/mongodb.mjs'
import { bibLesen } from './pruefung/bib.mjs'
import { zitierpaket } from './pruefung/latex.mjs'
import { dokumente } from './pruefung/PruefManager.mjs'
import { Problem } from './probleme.mjs'
import { quotes } from './sammlungen.mjs'
import { jetzt } from './schalter.mjs'
import * as QuellenManager from './QuellenManager.mjs'
import CollaboratorsGetter from '../../../../app/src/Features/Collaborators/CollaboratorsGetter.mjs'
import { zitateGeaendert as melden } from './live.mjs'

const MAX_ZITAT = 2000
const MAX_KOMMENTAR = 2000

export async function liste(quelle) {
  return await (await quotes())
    .find({ quelleId: quelle._id })
    .sort({ seite: 1, angelegtAm: 1 })
    .toArray()
}

export async function markieren(quelle, { seite, text }, userId) {
  const flach = String(text ?? '').replace(/\s+/g, ' ').trim()
  if (!flach || flach.length > MAX_ZITAT) {
    throw new Problem(
      422,
      'zitat_text',
      `Bitte eine Textstelle mit 1 bis ${MAX_ZITAT} Zeichen markieren.`
    )
  }
  const eintrag = await QuellenManager.seite(quelle, seite)
  if (!eintrag.text.replace(/\s+/g, ' ').includes(flach)) {
    throw new Problem(
      422,
      'zitat_nicht_in_quelle',
      'Der markierte Text steht nicht auf dieser Seite. Bitte erneut markieren.'
    )
  }
  const zitat = {
    _id: new ObjectId(),
    projectId: quelle.projectId,
    quelleId: quelle._id,
    seite,
    label: eintrag.label,
    text: flach,
    angelegtVon: userId,
    angelegtAm: jetzt(),
  }
  await (await quotes()).insertOne(zitat)
  melden(quelle)
  return zitat
}

async function zuweisungPruefen(projectId, zuweisen) {
  const ids = await CollaboratorsGetter.promises.getInvitedMemberIds(projectId)
  if (typeof zuweisen !== 'string' || !ids.some(id => String(id) === zuweisen)) {
    throw new Problem(422, 'zuweisung', 'Zuweisen geht nur an Mitglieder dieses Projekts.')
  }
  return new ObjectId(zuweisen)
}

export async function kommentieren(quelle, zitatId, { text, zuweisen }, userId) {
  const zitat = await holen(quelle, zitatId)
  const inhalt = typeof text === 'string' ? text.trim() : ''
  if (!inhalt || inhalt.length > MAX_KOMMENTAR) {
    throw new Problem(
      422,
      'kommentar_text',
      `Bitte einen Kommentar mit 1 bis ${MAX_KOMMENTAR} Zeichen schreiben.`
    )
  }
  const am = jetzt()
  const kommentar = { _id: new ObjectId(), von: userId, text: inhalt, am }
  const zugewiesen =
    zuweisen === undefined
      ? undefined
      : { an: await zuweisungPruefen(quelle.projectId, zuweisen), von: userId, am }
  const neu = await (await quotes()).findOneAndUpdate(
    { _id: zitat._id },
    { $push: { kommentare: kommentar }, ...(zugewiesen ? { $set: { zugewiesen } } : {}) },
    { returnDocument: 'after' }
  )
  melden(quelle, zugewiesen?.an)
  return neu
}

export async function bestaetigen(quelle, zitatId, userId) {
  const zitat = await holen(quelle, zitatId)
  const neu = await (await quotes()).findOneAndUpdate(
    { _id: zitat._id },
    { $set: { bestaetigt: { von: userId, am: jetzt() } } },
    { returnDocument: 'after' }
  )
  melden(quelle)
  return neu
}

export async function zuweisungLoesen(quelle, zitatId) {
  const zitat = await holen(quelle, zitatId)
  await (await quotes()).updateOne({ _id: zitat._id }, { $set: { zugewiesen: null } })
  melden(quelle, zitat.zugewiesen?.an)
}

export async function zugewiesenAn(projectId, userId) {
  return await (await quotes())
    .find({ projectId, 'zugewiesen.an': userId })
    .sort({ 'zugewiesen.am': -1 })
    .limit(20)
    .toArray()
}

export async function holen(quelle, zitatId) {
  const zitat =
    ObjectId.isValid(zitatId) &&
    (await (await quotes()).findOne({
      _id: new ObjectId(zitatId),
      quelleId: quelle._id,
    }))
  if (!zitat) {
    throw new Problem(404, 'zitat_fehlt', 'Dieses Zitat gibt es nicht mehr.')
  }
  return zitat
}

const LATEX_ZEICHEN = /[\\{}&%$#_^~]/g
const LATEX_ERSATZ = {
  '\\': '\\textbackslash{}',
  '~': '\\textasciitilde{}',
  '^': '\\textasciicircum{}',
}

function latexSicher(text) {
  return text.replace(LATEX_ZEICHEN, c => LATEX_ERSATZ[c] ?? `\\${c}`)
}

// Crossref-Daten, Webseiten-Titel und Dateinamen sind fremder Text: maskieren, damit die Klammern
// der .bib halten.
const text = wert => wert && latexSicher(String(wert))
const ohneKlammern = wert => wert && String(wert).replace(/[{}\\]/g, '')
const alsBib = (typ, key, felder) => {
  const zeilen = felder.filter(([, wert]) => wert).map(([name, wert]) => `  ${name} = {${wert}}`)
  return `@${typ}{${key},\n${zeilen.join(',\n')}\n}`
}

function webEintrag(key, quelle) {
  return alsBib('online', key, [
    ['title', text(quelle.meta?.titel ?? quelle.web.url)],
    // Die URL steht in biblatex wörtlich; nur Klammern und Backslash würden die .bib brechen.
    ['url', ohneKlammern(quelle.web.url)],
    ['urldate', quelle.web.abgerufenAm.toISOString().slice(0, 10)],
  ])
}

function bibEintrag(key, quelle) {
  if (quelle.art === 'web') return webEintrag(key, quelle)
  const meta = quelle.meta?.gefunden ? quelle.meta : {}
  const felder = [
    ['author', text(meta.autoren?.map(a => [a.family, a.given].filter(Boolean).join(', ')).join(' and '))],
    ['title', text(meta.titel ?? quelle.dateiname)],
    ['journal', text(meta.journal)],
    ['year', ohneKlammern(meta.jahr)],
    ['pages', ohneKlammern(meta.seiten?.replace('-', '--'))],
    ['doi', ohneKlammern(quelle.doi)],
  ]
  return alsBib('article', key, felder)
}

async function bibSicherstellen(projectId, docs, quelle, userId) {
  const bibDocs = docs.filter(d => d.pfad.endsWith('.bib'))
  for (const doc of bibDocs) {
    for (const eintrag of bibLesen(doc.text).values()) {
      const gleicheDoi =
        quelle.doi && eintrag.doi?.toLowerCase() === quelle.doi.toLowerCase()
      if (gleicheDoi || eintrag.key === quelle.key) return eintrag.key
    }
  }
  const eintrag = bibEintrag(quelle.key, quelle).split('\n')
  if (bibDocs.length) {
    await EditorController.promises.appendToDoc(
      projectId,
      bibDocs[0].docId,
      ['', ...eintrag],
      'spur',
      userId
    )
  } else {
    await EditorController.promises.upsertDocWithPath(
      projectId,
      '/references.bib',
      eintrag,
      'spur',
      userId
    )
  }
  return quelle.key
}

export async function einfuegen(projectId, quelle, zitat, userId) {
  const docs = await dokumente(projectId)
  const paket = zitierpaket(docs[0]?.text ?? '') ?? 'biblatex'
  const key = await bibSicherstellen(projectId, docs, quelle, userId)
  // Das Label kann sich nach dem Markieren ändern, wenn jemand den Versatz bestätigt.
  const { label } = await QuellenManager.seite(quelle, zitat.seite)
  const seite = label ?? String(zitat.seite)
  const wortlaut = latexSicher(zitat.text)
  // Webseiten haben keine Seiten: zitiert wird ohne Seitenangabe.
  const stelle =
    quelle.art === 'web' ? '' : paket === 'natbib' ? `[S.~${seite}]` : `[${seite}]`
  const befehl = paket === 'natbib' ? 'citep' : 'autocite'
  const latex = `\\enquote{${wortlaut}} \\${befehl}${stelle}{${key}}`
  return { latex, key, paket }
}
