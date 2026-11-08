import logger from '@overleaf/logger'
import { csv } from '../csv.mjs'
import { doiNormal } from '../pruefung/bib.mjs'
import { Problem } from '../probleme.mjs'
import { suchprotokoll } from '../sammlungen.mjs'
import { jetzt } from '../schalter.mjs'
import { DienstFehler } from './abruf.mjs'
import { aktiv, PRO_SEITE, SUCHDIENSTE, ZITATIONSDIENSTE } from './dienste.mjs'

const PROTOKOLL_SEITE = 50
const CSV_MAX = 10000
export const DOI_MUSTER = /^10\.\d{4,9}\/\S+$/
const RICHTUNGEN = ['zitiert_von', 'zitiert']
const ANZEIGE = Object.fromEntries(SUCHDIENSTE.map(d => [d.name, d.anzeige]))

const titelSchluessel = titel => titel?.trim() && `titel:${titel.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()}`

function zusammenfuehren(sammlung, treffer) {
  const schluessel = treffer.doi ?? titelSchluessel(treffer.titel) ?? `ohne:${sammlung.size}`
  const neu = { ...treffer, dienste: treffer.dienste.map(d => ANZEIGE[d]) }
  const alt = sammlung.get(schluessel)
  if (!alt) return sammlung.set(schluessel, neu)
  for (const [feld, wert] of Object.entries(neu)) {
    if (feld === 'dienste') alt.dienste.push(...wert.filter(d => !alt.dienste.includes(d)))
    else if (feld === 'frei') alt.frei = alt.frei === true || wert === true ? true : (alt.frei ?? wert)
    else if (alt[feld] == null || (Array.isArray(alt[feld]) && !alt[feld].length)) alt[feld] = wert
  }
}

// Fasst die Antworten paralleler Dienstaufrufe zusammen. Ein Ausfall nimmt nur diesen Dienst heraus.
export function auswerten(dienste, ergebnisse) {
  const sammlung = new Map()
  const fehler = []
  const gesamt = []
  ergebnisse.forEach((ergebnis, i) => {
    const dienst = dienste[i]
    if (ergebnis.status === 'rejected') {
      if (!(ergebnis.reason instanceof DienstFehler)) {
        logger.error({ err: ergebnis.reason, dienst: dienst.name }, 'Paper-Dienst unerwartet fehlgeschlagen')
      }
      fehler.push({
        dienst: dienst.name,
        art: ergebnis.reason?.art ?? 'nicht_erreichbar',
        text: ergebnis.reason instanceof DienstFehler ? ergebnis.reason.message : `${dienst.anzeige} nicht erreichbar`,
      })
      return
    }
    const { treffer, gesamt: anzahl } = Array.isArray(ergebnis.value)
      ? { treffer: ergebnis.value, gesamt: ergebnis.value.length }
      : ergebnis.value
    gesamt.push({ dienst, anzahl })
    for (const t of treffer) zusammenfuehren(sammlung, t)
  })
  return { treffer: [...sammlung.values()], fehler, gesamt }
}

export async function suchen({ projectId, userId, anfrage, seite = 0 }) {
  const begriff = anfrage?.trim()
  if (!begriff) throw new Problem(400, 'anfrage_fehlt', 'Bitte einen Suchbegriff eingeben.')
  const dienste = SUCHDIENSTE.filter(aktiv)
  const hinweise = SUCHDIENSTE.filter(d => !aktiv(d)).map(
    d => `${d.anzeige} ist aus: Der Betreiber hat keinen API-Key hinterlegt (${d.keyVariable}).`
  )
  const ergebnisse = await Promise.allSettled(dienste.map(d => d.suchen(begriff, seite)))
  const { treffer, fehler, gesamt } = auswerten(dienste, ergebnisse)
  if (seite === 0 && gesamt.length) {
    const datum = jetzt()
    await (await suchprotokoll()).insertMany(
      gesamt.map(({ dienst, anzahl }) => ({
        projectId,
        userId,
        datum,
        dienst: dienst.anzeige,
        anfrage: begriff,
        treffer: anzahl,
      }))
    )
  }
  return {
    anfrage: begriff,
    seite,
    treffer,
    weiter: gesamt.some(({ anzahl }) => (seite + 1) * PRO_SEITE < anzahl),
    fehler,
    hinweise,
  }
}

export async function protokoll(projectId, { seite = 0 } = {}) {
  const sammlung = await suchprotokoll()
  const [eintraege, anzahl] = await Promise.all([
    sammlung
      .find({ projectId }, { projection: { _id: 0, datum: 1, dienst: 1, anfrage: 1, treffer: 1 } })
      .sort({ datum: -1, _id: -1 })
      .skip(seite * PROTOKOLL_SEITE)
      .limit(PROTOKOLL_SEITE)
      .toArray(),
    sammlung.countDocuments({ projectId }),
  ])
  return { eintraege, gesamt: anzahl, weiter: (seite + 1) * PROTOKOLL_SEITE < anzahl }
}

export function doiPruefen(doi) {
  const wert = doiNormal(doi ?? '')?.toLowerCase()
  if (!DOI_MUSTER.test(wert ?? '')) {
    throw new Problem(400, 'doi_ungueltig', 'Das ist keine DOI. Bitte eine DOI wie 10.1038/nrn2762 angeben.')
  }
  return wert
}

// richtung: 'zitiert_von' (Arbeiten, die dieses Paper zitieren) oder 'zitiert' (seine Referenzen).
export async function zitationen(doi, richtung) {
  if (!RICHTUNGEN.includes(richtung)) {
    throw new Problem(400, 'richtung_ungueltig', 'Die Richtung ist „zitiert_von“ oder „zitiert“.')
  }
  const wert = doiPruefen(doi)
  const dienste = ZITATIONSDIENSTE.filter(aktiv)
  const ergebnisse = await Promise.allSettled(dienste.map(d => d.zitationen(wert, richtung)))
  const { treffer, fehler } = auswerten(dienste, ergebnisse)
  return { doi: wert, richtung, treffer, fehler }
}

export async function protokollCsv(projectId) {
  const eintraege = await (await suchprotokoll())
    .find({ projectId })
    .sort({ datum: -1, _id: -1 })
    .limit(CSV_MAX)
    .toArray()
  return csv(
    ['Datum', 'Datenbank', 'Anfrage', 'Trefferzahl'],
    eintraege.map(e => [e.datum.toISOString(), e.dienst, e.anfrage, e.treffer])
  )
}
