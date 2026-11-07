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

const MAX_ZITAT = 2000

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
  return zitat
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

function bibEintrag(key, quelle) {
  const meta = quelle.meta?.gefunden ? quelle.meta : {}
  // Crossref-Daten und Dateinamen sind fremder Text: maskieren, damit die Klammern der .bib halten.
  const text = wert => wert && latexSicher(String(wert))
  const ohneKlammern = wert => wert && String(wert).replace(/[{}\\]/g, '')
  const felder = [
    ['author', text(meta.autoren?.map(a => [a.family, a.given].filter(Boolean).join(', ')).join(' and '))],
    ['title', text(meta.titel ?? quelle.dateiname)],
    ['journal', text(meta.journal)],
    ['year', ohneKlammern(meta.jahr)],
    ['pages', ohneKlammern(meta.seiten?.replace('-', '--'))],
    ['doi', ohneKlammern(quelle.doi)],
  ].filter(([, wert]) => wert)
  const zeilen = felder.map(([name, wert]) => `  ${name} = {${wert}}`)
  return `@article{${key},\n${zeilen.join(',\n')}\n}`
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
  const text = latexSicher(zitat.text)
  const latex =
    paket === 'natbib'
      ? `\\enquote{${text}} \\citep[S.~${seite}]{${key}}`
      : `\\enquote{${text}} \\autocite[${seite}]{${key}}`
  return { latex, key, paket }
}
