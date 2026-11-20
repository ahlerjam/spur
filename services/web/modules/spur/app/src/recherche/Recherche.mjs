import logger from '@overleaf/logger'
import { doiNormal } from '../pruefung/bib.mjs'
import { Problem } from '../probleme.mjs'
import { meldung } from '../meldungen.mjs'
import { DienstFehler, gezaehlt } from './abruf.mjs'
import { PRO_SEITE, SUCHDIENSTE, ZITATIONSDIENSTE } from './dienste.mjs'
import * as Suchprotokoll from './Suchprotokoll.mjs'

const DOI_MUSTER = /^10\.\d{4,9}\/\S+$/
const RICHTUNGEN = ['zitiert_von', 'zitiert']
const ANZEIGE = Object.fromEntries(SUCHDIENSTE.map(d => [d.name, d.anzeige]))

const titelSchluessel = titel => titel?.trim() && `titel:${titel.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()}`

function zusammenfuehren(sammlung, treffer) {
  const schluessel = treffer.doi || titelSchluessel(treffer.titel) || `ohne:${sammlung.size}`
  const neu = { ...treffer, dienste: treffer.dienste.map(d => ANZEIGE[d]) }
  const alt = sammlung.get(schluessel)
  if (!alt) return sammlung.set(schluessel, neu)
  for (const [feld, wert] of Object.entries(neu)) {
    if (feld === 'dienste') alt.dienste.push(...wert.filter(d => !alt.dienste.includes(d)))
    else if (feld === 'frei') alt.frei = alt.frei === true || wert === true ? true : (alt.frei ?? wert)
    else if (alt[feld] == null || (Array.isArray(alt[feld]) && !alt[feld].length)) alt[feld] = wert
  }
}

const ABSTRACT_MAX = 600
// An Zeichen kürzen, nicht an UTF-16-Einheiten: ein halbes Emoji wäre ungültiges JSON-Unicode.
const kuerzen = text => {
  const zeichen = [...text]
  return zeichen.length > ABSTRACT_MAX ? `${zeichen.slice(0, ABSTRACT_MAX).join('')}…` : text
}

// Fragt die Dienste parallel und zählt je Dienst die Versuche.
async function fragen(dienste, aufruf) {
  const staende = dienste.map(() => ({ versuche: 0 }))
  const ergebnisse = await Promise.allSettled(dienste.map((d, i) => gezaehlt(staende[i], () => aufruf(d))))
  return auswerten(dienste, ergebnisse, staende.map(s => s.versuche))
}

// Fasst die Antworten paralleler Dienstaufrufe zusammen. Ein Ausfall nimmt nur diesen Dienst heraus.
export function auswerten(dienste, ergebnisse, versuche = []) {
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
        text: ergebnis.reason instanceof DienstFehler ? ergebnis.reason.message : meldung('spur_fehler_dienst_nicht_erreichbar', { dienst: dienst.anzeige }),
      })
      return
    }
    const { treffer, gesamt: anzahl } = ergebnis.value
    gesamt.push({ dienst, anzahl, geliefert: treffer.length })
    for (const t of treffer) zusammenfuehren(sammlung, t)
  })
  // Ohne Abstract bleibt das Feld leer statt null. Gekürzt, damit eine Seite paper_search unter 10.000 Tokens bleibt.
  const treffer = [...sammlung.values()].map(t => ({ ...t, abstract: kuerzen(t.abstract ?? '') }))
  const antworten = dienste.map((d, i) => {
    const fehlschlag = fehler.find(f => f.dienst === d.name)
    return {
      dienst: d.anzeige,
      antwort: !fehlschlag ? 'geantwortet' : fehlschlag.art === 'limit' ? 'gedrosselt' : 'nicht_erreichbar',
      versuche: versuche[i] ?? 0,
    }
  })
  // Eine leere Liste heißt sonst „nichts gefunden“, obwohl niemand gefragt werden konnte.
  const hinweis = gesamt.length ? null : meldung('spur_hinweis_kein_dienst')
  return { treffer, fehler, gesamt, dienste: antworten, hinweis }
}

export async function suchen({ projectId, userId, anfrage, seite = 0 }) {
  const begriff = anfrage?.trim()
  if (!begriff) throw new Problem(400, 'anfrage_fehlt', 'spur_fehler_suchbegriff_fehlt')
  const { treffer, fehler, gesamt, dienste, hinweis } = await fragen(SUCHDIENSTE, d => d.suchen(begriff, seite))
  await Suchprotokoll.festhalten({
    projectId,
    userId,
    anfrage: begriff,
    seite,
    dienste: dienste.map((d, i) => {
      const antwort = gesamt.find(g => g.dienst === SUCHDIENSTE[i])
      return { ...d, treffer: antwort?.geliefert ?? 0, gesamt: antwort?.anzahl ?? null }
    }),
    treffer,
  })
  return {
    anfrage: begriff,
    seite,
    treffer,
    weiter: gesamt.some(({ anzahl }) => (seite + 1) * PRO_SEITE < anzahl),
    fehler,
    dienste,
    hinweis,
  }
}

export function doiPruefen(doi) {
  const wert = doiNormal(doi ?? '')?.toLowerCase()
  if (!DOI_MUSTER.test(wert ?? '')) {
    throw new Problem(400, 'doi_ungueltig', 'spur_fehler_doi_ungueltig')
  }
  return wert
}

// richtung: 'zitiert_von' (Arbeiten, die dieses Paper zitieren) oder 'zitiert' (seine Referenzen).
export async function zitationen(doi, richtung) {
  if (!RICHTUNGEN.includes(richtung)) {
    throw new Problem(400, 'richtung_ungueltig', 'spur_fehler_richtung_ungueltig')
  }
  const wert = doiPruefen(doi)
  const { treffer, fehler, dienste, hinweis } = await fragen(ZITATIONSDIENSTE, d => d.zitationen(wert, richtung))
  return { doi: wert, richtung, treffer, fehler, dienste, hinweis }
}
