// Suchprotokoll eines Projekts: jede Anfrage an die Suchdienste, die Treffer ohne Dubletten und die Entscheidung
// je Treffer. Daraus entstehen die Zahlen für ein PRISMA-Flussdiagramm.
import { ObjectId } from '../../../../../app/src/infrastructure/mongodb.mjs'
import { csv } from '../csv.mjs'
import { Problem } from '../probleme.mjs'
import { beschaffungen, quellen, suchprotokoll, suchtreffer } from '../sammlungen.mjs'
import { jetzt } from '../schalter.mjs'
import { SUCHDIENSTE } from './dienste.mjs'
import { normal } from './titelabgleich.mjs'

export const SEITE = 50
const CSV_MAX = 10000

const titelNormal = titel => normal(titel) || null

// Dubletten erkennt spur über die normalisierte DOI, ohne DOI über Titel (klein, ohne Satzzeichen und Akzente) und Jahr.
function schluesselVon(treffer) {
  if (treffer.doi) return `doi:${treffer.doi.toLowerCase()}`
  const titel = titelNormal(treffer.titel)
  // Ohne DOI und Titel lässt sich nichts vergleichen: Der Treffer zählt für sich.
  return titel ? `titel:${titel}|${treffer.jahr ?? ''}` : `ohne:${new ObjectId()}`
}

// Hält eine Anfrage fest (auch Folgeseiten). dienste: je Dienst { dienst, antwort, versuche, treffer, gesamt };
// treffer: die zusammengeführten Treffer dieser Anfrage.
export async function festhalten({ projectId, userId, anfrage, seite, dienste, treffer }) {
  const datum = jetzt()
  let neu = 0
  if (treffer.length) {
    const ergebnis = await (await suchtreffer()).bulkWrite(
      treffer.map(t => ({
        updateOne: {
          filter: { projectId, schluessel: schluesselVon(t) },
          update: { $setOnInsert: { doi: t.doi?.toLowerCase() ?? null, titel: t.titel ?? null, titelSchluessel: titelNormal(t.titel), jahr: t.jahr ?? null, erstmals: datum } },
          upsert: true,
        },
      })),
      { ordered: false }
    )
    neu = ergebnis.upsertedCount
  }
  const geliefert = dienste.reduce((summe, d) => summe + d.treffer, 0)
  await (await suchprotokoll()).insertOne({ projectId, userId, datum, anfrage, seite, dienste, geliefert, neu })
}

// Einträge von vor P12 stehen je Dienst einzeln im Protokoll und kennen nur die Trefferzahl des Dienstes.
const istAlt = eintrag => !Array.isArray(eintrag.dienste)

function fuerClient(eintrag) {
  if (istAlt(eintrag)) {
    return {
      zeit: eintrag.datum,
      anfrage: eintrag.anfrage,
      seite: 0,
      filter: null,
      dienste: [{ dienst: eintrag.dienst, status: 'geantwortet', treffer: eintrag.treffer }],
      treffer: eintrag.treffer,
      dubletten: null,
    }
  }
  return {
    zeit: eintrag.datum,
    anfrage: eintrag.anfrage,
    seite: eintrag.seite,
    // paper_search kennt keine Filter; das Feld steht für das PRISMA-Protokoll trotzdem fest.
    filter: null,
    dienste: eintrag.dienste.map(d => ({ dienst: d.dienst, status: d.antwort, treffer: d.treffer, versuche: d.versuche })),
    treffer: eintrag.geliefert,
    dubletten: eintrag.geliefert - eintrag.neu,
  }
}

// Anfragen ab Position `ab`, höchstens 50; aufsteigend in zeitlicher Folge (MCP) oder die neuesten zuerst (Web).
export async function liste(projectId, { ab = 0, aufsteigend = false } = {}) {
  const sammlung = await suchprotokoll()
  const richtung = aufsteigend ? 1 : -1
  const [eintraege, gesamt] = await Promise.all([
    sammlung.find({ projectId }).sort({ datum: richtung, _id: richtung }).skip(ab).limit(SEITE).toArray(),
    sammlung.countDocuments({ projectId }),
  ])
  return { eintraege: eintraege.map(fuerClient), gesamt, weiter: ab + SEITE < gesamt }
}

const zaehlen = (zaehler, name, anzahl = 1) => {
  zaehler[name] = (zaehler[name] ?? 0) + anzahl
}

// Summen für das PRISMA-Flussdiagramm. Es gilt identifiziert − dubletten = gesichtet und
// gesichtet = aufgenommen + ausgeschlossen + nicht beschaffbar + offen.
export async function prisma(projectId) {
  const [anfragen, treffer, quellenDois, offeneListe] = await Promise.all([
    (await suchprotokoll()).find({ projectId }, { projection: { dienste: 1, dienst: 1, treffer: 1 } }).toArray(),
    (await suchtreffer()).find({ projectId }, { projection: { doi: 1, ausschluss: 1, aufnahmeFehler: 1 } }).toArray(),
    (await quellen()).distinct('doi', { projectId, doi: { $type: 'string' } }),
    (await beschaffungen()).find({ projectId, status: 'offen' }, { projection: { doi: 1, grund: 1 } }).toArray(),
  ])
  const nachDienst = {}
  let ohneAbgleich = 0
  for (const anfrage of anfragen) {
    if (istAlt(anfrage)) {
      zaehlen(nachDienst, anfrage.dienst, anfrage.treffer)
      ohneAbgleich += anfrage.treffer
    } else {
      for (const d of anfrage.dienste) if (d.treffer) zaehlen(nachDienst, d.dienst, d.treffer)
    }
  }
  const aufgenommeneDois = new Set(quellenDois.map(doi => doi.toLowerCase()))
  const grundNachDoi = new Map(offeneListe.map(e => [e.doi, e.grund ?? null]))
  const nachGrund = {}
  const nichtBeschaffbar = {}
  let aufgenommen = 0
  // Alte Einträge kennen ihre Treffer nicht einzeln: Sie zählen als gesichtet und offen.
  let offen = ohneAbgleich
  for (const t of treffer) {
    if (t.doi && aufgenommeneDois.has(t.doi)) aufgenommen++
    else if (t.ausschluss) zaehlen(nachGrund, t.ausschluss.grund)
    else if (t.doi && grundNachDoi.has(t.doi)) zaehlen(nichtBeschaffbar, grundNachDoi.get(t.doi) ?? t.aufnahmeFehler ?? 'nicht_frei')
    else offen++
  }
  const identifiziert = Object.values(nachDienst).reduce((summe, n) => summe + n, 0)
  const gesichtet = treffer.length + ohneAbgleich
  return {
    identifiziert,
    identifiziert_nach_dienst: nachDienst,
    dubletten: identifiziert - gesichtet,
    gesichtet,
    aufgenommen,
    ausgeschlossen: { gesamt: Object.values(nachGrund).reduce((summe, n) => summe + n, 0), nach_grund: nachGrund },
    nicht_beschaffbar: nichtBeschaffbar,
    offen,
  }
}

// Schließt einen Treffer des Protokolls mit Grund aus; ein zweiter Aufruf ersetzt den Grund.
export async function ausschliessen({ projectId, userId, doi, titel, grund }) {
  const filter = doi ? { projectId, schluessel: `doi:${doi.toLowerCase()}` } : { projectId, titelSchluessel: titelNormal(titel) }
  const treffer =
    (doi || filter.titelSchluessel) &&
    (await (await suchtreffer()).findOneAndUpdate(
      filter,
      { $set: { ausschluss: { grund, von: userId, am: jetzt() } } },
      { sort: { erstmals: -1 }, returnDocument: 'after' }
    ))
  if (!treffer) throw new Problem(404, 'treffer_nicht_gefunden', 'spur_fehler_treffer_nicht_gefunden')
  return { doi: treffer.doi, titel: treffer.titel, grund: treffer.ausschluss.grund }
}

// Der Volltext eines Treffers ließ sich nicht laden: Steht er später auf der Beschaffungsliste, nennt prisma diesen Grund.
export async function aufnahmeFehlerMerken(projectId, doi, typ) {
  await (await suchtreffer()).updateOne({ projectId, schluessel: `doi:${doi.toLowerCase()}` }, { $set: { aufnahmeFehler: typ } })
}

const NICHT_BESCHAFFBAR = { nicht_frei: 'nicht frei verfügbar', bot_schutz: 'frei, Download blockiert', pdf_fehlt: 'Volltext nicht ladbar' }

// Je Anfrage eine Zeile, am Ende die Summen wie in `prisma`.
export async function alsCsv(projectId) {
  const [eintraege, summen] = await Promise.all([
    (await suchprotokoll()).find({ projectId }).sort({ datum: -1, _id: -1 }).limit(CSV_MAX).toArray(),
    prisma(projectId),
  ])
  const namen = SUCHDIENSTE.map(d => d.anzeige)
  const zeilen = eintraege.map(fuerClient).map(e => [
    e.zeit.toISOString(),
    e.anfrage,
    e.seite,
    '',
    ...namen.flatMap(name => {
      const dienst = e.dienste.find(d => d.dienst === name)
      return [dienst?.status ?? '', dienst?.treffer ?? '']
    }),
    e.treffer,
    e.dubletten ?? '',
  ])
  const nichtBeschaffbar = Object.values(summen.nicht_beschaffbar).reduce((summe, n) => summe + n, 0)
  const summenzeilen = [
    ['Summe: identifiziert', summen.identifiziert],
    ['Summe: Dubletten', summen.dubletten],
    ['Summe: gesichtet', summen.gesichtet],
    ['Summe: aufgenommen', summen.aufgenommen],
    ['Summe: ausgeschlossen', summen.ausgeschlossen.gesamt],
    ...Object.entries(summen.ausgeschlossen.nach_grund).map(([grund, n]) => [`Summe: ausgeschlossen (${grund})`, n]),
    ['Summe: nicht beschaffbar', nichtBeschaffbar],
    ...Object.entries(summen.nicht_beschaffbar).map(([grund, n]) => [`Summe: nicht beschaffbar (${NICHT_BESCHAFFBAR[grund] ?? grund})`, n]),
    ['Summe: offen', summen.offen],
  ]
  return csv(
    ['Datum', 'Anfrage', 'Seite', 'Filter', ...namen.flatMap(name => [`${name}: Status`, `${name}: Treffer`]), 'Treffer', 'Dubletten'],
    [...zeilen, ...summenzeilen]
  )
}
