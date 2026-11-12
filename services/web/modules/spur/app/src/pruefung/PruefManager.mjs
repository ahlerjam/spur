import { createHash } from 'node:crypto'
import { promiseMapWithLimit } from '@overleaf/promise-utils'
import DocumentUpdaterHandler from '../../../../../app/src/Features/DocumentUpdater/DocumentUpdaterHandler.mjs'
import ProjectEntityHandler from '../../../../../app/src/Features/Project/ProjectEntityHandler.mjs'
import ProjectGetter from '../../../../../app/src/Features/Project/ProjectGetter.mjs'
import * as Crossref from '../Crossref.mjs'
import * as QuellenManager from '../QuellenManager.mjs'
import { pruefCache, quotes } from '../sammlungen.mjs'
import { jetzt } from '../schalter.mjs'
import { bibLesen } from './bib.mjs'
import { istProblem, quelleZu, STELLEN_STATUS, stelleEinordnen, zeileBewerten } from './bewertung.mjs'
import { zitateFinden } from './latex.mjs'

const CROSSREF_PARALLEL = 5
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

function zeilenStarts(text) {
  const starts = [0]
  for (let i = text.indexOf('\n'); i >= 0; i = text.indexOf('\n', i + 1)) starts.push(i + 1)
  return starts
}

function zeileAn(starts, pos) {
  let unten = 0
  let oben = starts.length - 1
  while (unten < oben) {
    const mitte = (unten + oben + 1) >> 1
    if (starts[mitte] <= pos) unten = mitte
    else oben = mitte - 1
  }
  return unten + 1
}

function hash(...teile) {
  const h = createHash('sha1')
  for (const teil of teile) h.update(teil).update('\0')
  return h.digest('hex')
}

export async function dokumente(projectId) {
  const [, projekt] = await Promise.all([
    DocumentUpdaterHandler.promises.flushProjectToMongo(projectId),
    ProjectGetter.promises.getProject(projectId, { rootDoc_id: true }),
  ])
  const docs = await ProjectEntityHandler.promises.getAllDocs(projectId)
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
  // Bestätigte Zitate zählen nur für OCR-Quellen (siehe bewertung.mjs).
  const ocrIds = quellen.filter(q => q.status === 'ocr').map(q => q._id)
  const dois = [...bibEintraege.values()].map(e => e.doi).filter(Boolean)
  const werke = new Map()
  const [bestaetigteZitate] = await Promise.all([
    ocrIds.length
      ? (await quotes())
          .find(
            { projectId, quelleId: { $in: ocrIds }, bestaetigt: { $ne: null } },
            { projection: { quelleId: 1, text: 1 } }
          )
          .toArray()
      : [],
    promiseMapWithLimit(CROSSREF_PARALLEL, [...new Set(dois)], async doi => {
      werke.set(doi.toLowerCase(), await Crossref.pruefen(doi))
    }),
  ])
  const bestaetigt = new Map()
  for (const z of bestaetigteZitate) {
    const key = String(z.quelleId)
    if (!bestaetigt.has(key)) bestaetigt.set(key, [])
    bestaetigt.get(key).push(z.text)
  }
  return { bibEintraege, quellen, werke, bestaetigt, seitenJeQuelle: new Map() }
}

function stempel(kontext) {
  return JSON.stringify({
    tag: jetzt().toISOString().slice(0, 10),
    bib: [...kontext.bibEintraege.values()],
    werke: [...kontext.werke.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([d, w]) => [d, w?.gefunden, w?.retraction, w?.registrierstelle, w?.nichtPruefbar]),
    quellen: kontext.quellen.map(q => [q._id, q.key, q.doi, q.versatz, q.versatzQuelle, q.status]),
    bestaetigt: [...kontext.bestaetigt.entries()].sort(([a], [b]) => a.localeCompare(b)),
  })
}

async function fundeBewerten(funde, kontext) {
  const fehlend = new Set()
  for (const fund of funde) {
    const key = fund.belege[0]?.key
    const quelle = key && quelleZu(key, kontext.bibEintraege, kontext.quellen)
    if (quelle && !kontext.seitenJeQuelle.has(String(quelle._id))) fehlend.add(quelle._id)
  }
  if (fehlend.size) {
    const geladen = await QuellenManager.seitenVon([...fehlend])
    for (const id of fehlend) {
      kontext.seitenJeQuelle.set(String(id), geladen.get(String(id)) ?? [])
    }
  }
  return funde.map(fund => zeileBewerten(fund, kontext))
}

async function abschnittBewerten(abschnitt, kontext) {
  return await fundeBewerten(zitateFinden(abschnitt.text), kontext)
}

// Prüft nur Zitate, die den Bereich [von, bis) im Text berühren.
export async function bereichPruefen(projectId, text, von, bis) {
  const docs = await dokumente(projectId)
  const kontext = await kontextLaden(projectId, docs)
  const funde = zitateFinden(text).filter(f => f.von <= bis && f.bis >= von)
  return await fundeBewerten(funde, kontext)
}

async function zeilenFuer(projectId, abschnittsListe, kontext, basis, nutzung) {
  const cache = await pruefCache()
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
      nutzung.uebernommen++
    } else {
      nutzung.neu++
      liste = await abschnittBewerten(abschnitt, kontext)
      neu.push({ projectId, hash: schluessel[i], zeilen: liste, erstelltAm: jetzt() })
    }
    zeilen.push({ abschnitt, liste })
  }
  // Parallele Prüfungen desselben Projekts schreiben dieselben Abschnitte.
  if (neu.length) {
    await cache.bulkWrite(
      neu.map(eintrag => ({
        updateOne: {
          filter: { projectId, hash: eintrag.hash },
          update: { $setOnInsert: eintrag },
          upsert: true,
        },
      }))
    )
  }
  return zeilen
}

export async function bericht(projectId) {
  const docs = await dokumente(projectId)
  const kontext = await kontextLaden(projectId, docs)
  // Nur zur Diagnose: wie viele Abschnitte neu bewertet und wie viele aus dem Cache übernommen wurden.
  const nutzung = { neu: 0, uebernommen: 0 }
  const basis = stempel(kontext)
  const zeilen = []
  for (const doc of docs) {
    if (!doc.pfad.endsWith('.tex')) continue
    const teile = abschnitte(doc.text)
    const starts = zeilenStarts(doc.text)
    for (const { abschnitt, liste } of await zeilenFuer(projectId, teile, kontext, basis, nutzung)) {
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
          zeile: zeileAn(starts, von),
          problem: istProblem(z),
          ...stelleEinordnen(z),
        })
      }
    }
  }
  const zaehlung = Object.fromEntries(STELLEN_STATUS.map(status => [status, zeilen.filter(z => z.status === status).length]))
  return { zeilen, zaehlung, abschnitte: nutzung, stand: jetzt() }
}
