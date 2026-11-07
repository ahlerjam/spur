import { latexZuText, seiteAusBeleg } from './latex.mjs'
import { wortlautPruefen } from './wortlaut.mjs'

function seitenStatus(beleg, quelle, gefunden, texte) {
  if (quelle.versatz == null) return { seite: 'nicht_pruefbar' }
  const zitiert = seiteAusBeleg(beleg.seite)
  if (gefunden.length === 0 || !zitiert) return { seite: 'nicht_pruefbar' }
  const labels = gefunden.map(i => texte[i].label)
  if (labels.includes(zitiert)) {
    return { seite: quelle.versatzQuelle === 'bestaetigt' ? 'bestaetigt' : 'stimmt' }
  }
  return { seite: 'gefunden', gefundenAuf: labels[0] }
}

function quelleZu(key, bibEintraege, quellen) {
  const doi = bibEintraege.get(key)?.doi?.toLowerCase()
  const nachDoi = doi && quellen.find(q => q.doi?.toLowerCase() === doi)
  return nachDoi || quellen.find(q => q.key === key) || null
}

function referenzStatus(eintrag, doiWerk) {
  if (!eintrag?.doi) return { referenz: 'ohne_doi', retraction: null }
  if (!doiWerk) return { referenz: 'unbekannt', retraction: null }
  if (!doiWerk.gefunden) return { referenz: 'nicht_gefunden', retraction: null }
  return { referenz: 'gefunden', retraction: doiWerk.retraction }
}

export function zeileBewerten(fund, kontext) {
  const { bibEintraege, quellen, seitenJeQuelle, werke } = kontext
  const basis = {
    form: fund.form,
    von: fund.von,
    bis: fund.bis,
    zitatVon: fund.zitatVon,
    zitatBis: fund.zitatBis,
    auszug: (fund.roh || '').trim().slice(0, 200),
  }
  if (fund.form === 'unbekannt') {
    return { ...basis, wortlaut: 'nicht_pruefbar', key: null, seite: null }
  }
  const [beleg] = fund.belege
  const quelle = quelleZu(beleg.key, bibEintraege, quellen)
  const eintrag = bibEintraege.get(beleg.key)
  const referenz = referenzStatus(
    eintrag,
    eintrag?.doi ? werke.get(eintrag.doi.toLowerCase()) : null
  )
  const ergebnis = {
    ...basis,
    key: beleg.key,
    seitenangabe: beleg.seite,
    quelleId: quelle?._id ?? null,
    dateiname: quelle?.dateiname ?? null,
    ...referenz,
  }
  if (!quelle) {
    return { ...ergebnis, wortlaut: fund.roh ? 'quelle_fehlt' : null, seite: null }
  }
  if (!fund.roh) return { ...ergebnis, wortlaut: null, seite: null }
  const seiten = seitenJeQuelle.get(String(quelle._id)) ?? []
  const texte = seiten.map(s => s.text)
  const { wortlaut, seiten: gefunden } = wortlautPruefen(latexZuText(fund.roh), texte)
  return {
    ...ergebnis,
    wortlaut,
    ...seitenStatus(beleg, quelle, gefunden, seiten),
  }
}

export function istProblem(zeile) {
  return (
    ['abweichend', 'nicht_pruefbar', 'quelle_fehlt'].includes(zeile.wortlaut) ||
    ['nicht_pruefbar', 'gefunden'].includes(zeile.seite) ||
    zeile.referenz === 'nicht_gefunden' ||
    zeile.retraction === 'zurueckgezogen' ||
    zeile.retraction === 'korrektur'
  )
}
