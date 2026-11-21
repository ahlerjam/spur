// Stand eines Laufs in Zahlen und in einem Satz, für run_status, run_finish und die Laufkarte.
// Eine Bearbeitung ist ein doc_edit; ihre Track Changes erkennt spur am Seed der Change-IDs (tc in spurUpdate).
// Mit alle_vorkommen zählt jede Ersetzung einzeln (anzahl).
import { meldung } from '../meldungen.mjs'

const SEED = 18
export const seedVon = changeId => String(changeId).slice(0, SEED)

const ZAHLWOERTER = meldung('spur_zahlwoerter').split(',')

function zahl(n) {
  return n < ZAHLWOERTER.length ? ZAHLWOERTER[n] : String(n)
}

function satz(n, einer, mehrere) {
  const text = n === 1 ? einer : mehrere.replace('__anzahl__', zahl(n))
  return text.charAt(0).toUpperCase() + text.slice(1)
}

// liste: offene Changes des Laufs je Dokument (LaufAktionen.aenderungen); bei abgeschlossenen Läufen leer.
export function laufStand(lauf, liste) {
  const offeneSeeds = new Set(liste.flatMap(d => d.changes.map(c => seedVon(c.id))))
  const angenommen = lauf?.angenommen ?? []
  const automatisch = new Set(angenommen.filter(a => a.automatisch).map(a => a.seed))
  const vonHand = new Set(angenommen.map(a => a.seed))
  const bearbeitungen = lauf?.bearbeitungen ?? []
  const stand = { gesamt: lauf?.aenderungen ?? 0, automatisch_angenommen: 0, offen: 0, rot: 0 }
  let angenommenVonHand = 0
  let offenRot = 0
  for (const b of bearbeitungen) {
    if (b.rot) stand.rot += b.anzahl
    if (offeneSeeds.has(b.seed)) {
      stand.offen += b.anzahl
      if (b.rot) offenRot += b.anzahl
    } else if (automatisch.has(b.seed)) stand.automatisch_angenommen += b.anzahl
    else if (vonHand.has(b.seed)) angenommenVonHand += b.anzahl
  }
  // Läufe von vor P15 kennen ihre Bearbeitungen nicht: Jeder offene Seed zählt als eine.
  if (!lauf?.bearbeitungen) stand.offen += offeneSeeds.size
  return { aenderungen: stand, hinweis: hinweisFuer(lauf, stand, { angenommenVonHand, offenRot }) }
}

function hinweisFuer(lauf, stand, { angenommenVonHand, offenRot }) {
  if (!lauf) return meldung('spur_lauf_hinweis_kein_lauf')
  if (stand.gesamt === 0) return meldung('spur_lauf_hinweis_leer')
  if (lauf.status === 'zurueckgenommen') return meldung('spur_lauf_hinweis_zurueckgenommen')
  const saetze = []
  const { automatisch_angenommen: automatisch, offen, gesamt } = stand
  if (automatisch) {
    saetze.push(satz(automatisch, meldung('spur_lauf_hinweis_automatisch_1'), meldung('spur_lauf_hinweis_automatisch_n')))
  }
  if (angenommenVonHand) {
    saetze.push(satz(angenommenVonHand, meldung('spur_lauf_hinweis_von_hand_1'), meldung('spur_lauf_hinweis_von_hand_n')))
  }
  if (offen) saetze.push(satz(offen, meldung('spur_lauf_hinweis_offen_1'), meldung('spur_lauf_hinweis_offen_n')))
  if (offenRot) saetze.push(satz(offenRot, meldung('spur_lauf_hinweis_rot_1'), meldung('spur_lauf_hinweis_rot_n')))
  saetze.push(satz(gesamt, meldung('spur_lauf_hinweis_rueckgaengig_1'), meldung('spur_lauf_hinweis_rueckgaengig_n')))
  return saetze.join(' ')
}
