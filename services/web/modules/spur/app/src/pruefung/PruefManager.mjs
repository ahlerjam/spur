import { createHash } from 'node:crypto'
import { promiseMapWithLimit } from '@overleaf/promise-utils'
import DocumentUpdaterHandler from '../../../../../app/src/Features/DocumentUpdater/DocumentUpdaterHandler.mjs'
import ProjectEntityHandler from '../../../../../app/src/Features/Project/ProjectEntityHandler.mjs'
import ProjectGetter from '../../../../../app/src/Features/Project/ProjectGetter.mjs'
import * as Crossref from '../Crossref.mjs'
import * as QuellenManager from '../QuellenManager.mjs'
import { Problem } from '../probleme.mjs'
import { einstellungen, pruefCache, quotes } from '../sammlungen.mjs'
import { jetzt } from '../schalter.mjs'
import { bibLesen } from './bib.mjs'
import { istProblem, quelleZu, STELLEN_STATUS, stelleEinordnen, zeileBewerten } from './bewertung.mjs'
import { makrosErkennen, makrosWirksam, zitateFinden } from './latex.mjs'

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

const MAKRO_LISTEN = ['zitat', 'ausgeblendet']
const MAX_MAKROS = 30
const projektFilter = projectId => ({ projectId, userId: null })

export async function makroEinstellung(projectId) {
  const eintrag = await (await einstellungen()).findOne(projektFilter(projectId), { projection: { pruefMakros: 1 } })
  return { zitat: eintrag?.pruefMakros?.zitat ?? [], ausgeblendet: eintrag?.pruefMakros?.ausgeblendet ?? [] }
}

// Namen ohne Backslash, nur Buchstaben und @; ein vorangestellter Backslash wird entfernt.
export async function makroEinstellungSetzen(projectId, eingabe) {
  const neu = {}
  for (const liste of MAKRO_LISTEN) {
    const namen = eingabe?.[liste] ?? []
    if (!Array.isArray(namen) || namen.length > MAX_MAKROS) {
      throw new Problem(422, 'makros_ungueltig', 'spur_fehler_makros_zu_viele', { max: MAX_MAKROS })
    }
    const bereinigt = namen.map(n => String(n).trim().replace(/^\\/, ''))
    const falsch = bereinigt.find(n => !/^[a-zA-Z@]+$/.test(n))
    if (falsch !== undefined) throw new Problem(422, 'makros_ungueltig', 'spur_fehler_makro_name', { name: falsch })
    neu[liste] = [...new Set(bereinigt)]
  }
  await (await einstellungen()).updateOne(projektFilter(projectId), { $set: { pruefMakros: neu } }, { upsert: true })
  return neu
}

function texte(docs) {
  return docs.filter(d => d.pfad.endsWith('.tex')).map(d => d.text)
}

export async function makroUebersicht(projectId) {
  const [docs, einstellung] = await Promise.all([dokumente(projectId), makroEinstellung(projectId)])
  return { ...einstellung, erkannt: makrosErkennen(texte(docs)) }
}

async function kontextLaden(projectId, docs, weitererText = null) {
  const makros = makrosWirksam(
    makrosErkennen([...texte(docs), ...(weitererText ? [weitererText] : [])]),
    await makroEinstellung(projectId)
  )
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
  return { bibEintraege, quellen, werke, bestaetigt, makros, seitenJeQuelle: new Map() }
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
    makros: kontext.makros,
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
  const funde = zitateFinden(abschnitt.text, kontext.makros)
  const sichtbar = funde.filter(f => !f.ausgeblendet)
  return { zeilen: await fundeBewerten(sichtbar, kontext), uebersprungen: funde.length - sichtbar.length }
}

// Prüft nur Zitate, die den Bereich [von, bis) im Text berühren.
export async function bereichPruefen(projectId, text, von, bis) {
  const docs = await dokumente(projectId)
  const kontext = await kontextLaden(projectId, docs, text)
  const funde = zitateFinden(text, kontext.makros).filter(f => !f.ausgeblendet && f.von <= bis && f.bis >= von)
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
    ).map(e => [e.hash, e])
  )
  const neu = []
  const zeilen = []
  for (const [i, abschnitt] of abschnittsListe.entries()) {
    let bewertet = vorhanden.get(schluessel[i])
    if (bewertet) {
      nutzung.uebernommen++
    } else {
      nutzung.neu++
      bewertet = await abschnittBewerten(abschnitt, kontext)
      neu.push({ projectId, hash: schluessel[i], ...bewertet, erstelltAm: jetzt() })
    }
    zeilen.push({ abschnitt, liste: bewertet.zeilen, uebersprungen: bewertet.uebersprungen ?? 0 })
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
  let uebersprungen = 0
  for (const doc of docs) {
    if (!doc.pfad.endsWith('.tex')) continue
    const teile = abschnitte(doc.text)
    const starts = zeilenStarts(doc.text)
    for (const { abschnitt, liste, uebersprungen: weg } of await zeilenFuer(projectId, teile, kontext, basis, nutzung)) {
      uebersprungen += weg
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
  // Markiert: alle Stellen mit Problem, genau die, die der Filter „Markiert“ im Prüfbericht zeigt.
  zaehlung.markiert = zeilen.filter(z => z.problem).length
  return { zeilen, zaehlung, uebersprungen, abschnitte: nutzung, stand: jetzt() }
}
