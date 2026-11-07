import { createHash } from 'node:crypto'
import DocumentUpdaterHandler from '../../../../../app/src/Features/DocumentUpdater/DocumentUpdaterHandler.mjs'
import ProjectEntityHandler from '../../../../../app/src/Features/Project/ProjectEntityHandler.mjs'
import ProjectGetter from '../../../../../app/src/Features/Project/ProjectGetter.mjs'
import * as Crossref from '../Crossref.mjs'
import * as QuellenManager from '../QuellenManager.mjs'
import { pruefCache } from '../sammlungen.mjs'
import { jetzt } from '../schalter.mjs'
import { bibLesen } from './bib.mjs'
import { istProblem, zeileBewerten } from './bewertung.mjs'
import { zitateFinden } from './latex.mjs'

const ABSCHNITT = /^[ \t]*\\(part|chapter|section)\*?\s*[[{]/gm

export function abschnitte(text) {
  const grenzen = [0]
  for (const m of text.matchAll(ABSCHNITT)) {
    if (m.index > 0) grenzen.push(m.index)
  }
  return grenzen.map((von, i) => ({
    von,
    text: text.slice(von, grenzen[i + 1] ?? text.length),
  }))
}

function zeileAn(text, pos) {
  let zeile = 1
  for (let i = text.indexOf('\n'); i >= 0 && i < pos; i = text.indexOf('\n', i + 1)) {
    zeile++
  }
  return zeile
}

function hash(...teile) {
  const h = createHash('sha1')
  for (const teil of teile) h.update(teil).update('\0')
  return h.digest('hex')
}

async function dokumente(projectId) {
  await DocumentUpdaterHandler.promises.flushProjectToMongo(projectId)
  const docs = await ProjectEntityHandler.promises.getAllDocs(projectId)
  const projekt = await ProjectGetter.promises.getProject(projectId, {
    rootDoc_id: true,
  })
  const wurzel = String(projekt.rootDoc_id)
  return Object.entries(docs)
    .map(([pfad, doc]) => ({
      pfad: pfad.replace(/^\//, ''),
      docId: String(doc._id),
      text: doc.lines.join('\n'),
    }))
    .sort((a, b) => {
      if (a.docId === wurzel) return -1
      if (b.docId === wurzel) return 1
      return a.pfad.localeCompare(b.pfad)
    })
}

async function kontextLaden(projectId, docs) {
  const bibEintraege = new Map()
  for (const doc of docs) {
    if (!doc.pfad.endsWith('.bib')) continue
    for (const [key, eintrag] of bibLesen(doc.text)) bibEintraege.set(key, eintrag)
  }
  const quellen = await QuellenManager.alle(projectId)
  const dois = [...bibEintraege.values()].map(e => e.doi).filter(Boolean)
  const werke = new Map()
  await Promise.all(
    [...new Set(dois)].map(async doi => {
      werke.set(doi.toLowerCase(), await Crossref.werk(doi))
    })
  )
  return { bibEintraege, quellen, werke, seitenJeQuelle: null }
}

function stempel(kontext) {
  return JSON.stringify({
    tag: jetzt().toISOString().slice(0, 10),
    bib: [...kontext.bibEintraege.values()],
    werke: [...kontext.werke.entries()].map(([d, w]) => [d, w?.gefunden, w?.retraction]),
    quellen: kontext.quellen.map(q => [q._id, q.key, q.doi, q.versatz, q.versatzQuelle]),
  })
}

async function abschnittBewerten(abschnitt, kontext) {
  kontext.seitenJeQuelle ??= await QuellenManager.seitenVon(
    kontext.quellen.map(q => q._id)
  )
  return zitateFinden(abschnitt.text).map(fund => zeileBewerten(fund, kontext))
}

async function zeilenFuer(projectId, abschnittsListe, kontext, statistik) {
  const cache = await pruefCache()
  const basis = stempel(kontext)
  const schluessel = abschnittsListe.map(a => hash(basis, a.text))
  const vorhanden = new Map(
    (
      await cache
        .find({ projectId, hash: { $in: schluessel } })
        .toArray()
    ).map(e => [e.hash, e.zeilen])
  )
  const neu = []
  const zeilen = []
  for (const [i, abschnitt] of abschnittsListe.entries()) {
    let liste = vorhanden.get(schluessel[i])
    if (liste) {
      statistik.wiederverwendet++
    } else {
      statistik.geprueft++
      liste = await abschnittBewerten(abschnitt, kontext)
      neu.push({ projectId, hash: schluessel[i], zeilen: liste, erstelltAm: jetzt() })
    }
    zeilen.push({ abschnitt, liste })
  }
  if (neu.length) await cache.insertMany(neu)
  return zeilen
}

export async function bericht(projectId) {
  const docs = await dokumente(projectId)
  const kontext = await kontextLaden(projectId, docs)
  const statistik = { geprueft: 0, wiederverwendet: 0 }
  const zeilen = []
  for (const doc of docs) {
    if (!doc.pfad.endsWith('.tex')) continue
    const teile = abschnitte(doc.text)
    for (const { abschnitt, liste } of await zeilenFuer(projectId, teile, kontext, statistik)) {
      for (const z of liste) {
        const von = z.von + abschnitt.von
        zeilen.push({
          ...z,
          id: hash(doc.docId, String(von)).slice(0, 12),
          docId: doc.docId,
          pfad: doc.pfad,
          von,
          bis: z.bis + abschnitt.von,
          zitatVon: z.zitatVon + abschnitt.von,
          zitatBis: z.zitatBis + abschnitt.von,
          zeile: zeileAn(doc.text, von),
          problem: istProblem(z),
        })
      }
    }
  }
  return { zeilen, statistik, stand: jetzt() }
}
