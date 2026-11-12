import { describe, expect, it } from 'vitest'
import { istProblem, quelleZu, referenzStatus, stelleEinordnen, zeileBewerten } from '../../app/src/pruefung/bewertung.mjs'

const SEITEN = [
  { label: '345', text: 'Anfang der Studie.' },
  { label: '346', text: 'Sleep supports the consolidation of declarative memory.' },
]
const QUELLE = { _id: 'q1', key: 'smith2024', dateiname: 'smith2024.pdf', doi: '10.5555/SPUR.1', versatz: 344, versatzQuelle: 'pagelabels' }

function kontext(extra = {}) {
  return {
    bibEintraege: new Map([['smith2024', { key: 'smith2024', doi: '10.5555/spur.1' }]]),
    quellen: [QUELLE],
    seitenJeQuelle: new Map([['q1', SEITEN]]),
    werke: new Map([['10.5555/spur.1', { gefunden: true, retraction: 'keine_meldung' }]]),
    ...extra,
  }
}

const fund = (extra = {}) => ({
  form: 'enquote',
  von: 0,
  bis: 80,
  zitatVon: 0,
  zitatBis: 60,
  roh: 'Sleep supports the consolidation of declarative memory.',
  belege: [{ befehl: 'autocite', key: 'smith2024', seite: '346' }],
  ...extra,
})

describe('quelleZu', () => {
  it('findet die Quelle über die DOI des .bib-Eintrags, auch bei anderer Schreibweise', () => {
    const bib = new Map([['anderer', { key: 'anderer', doi: '10.5555/spur.1' }]])
    expect(quelleZu('anderer', bib, [QUELLE])).toBe(QUELLE)
  })

  it('fällt auf den Schlüssel zurück und liefert sonst null', () => {
    expect(quelleZu('smith2024', new Map(), [QUELLE])).toBe(QUELLE)
    expect(quelleZu('niemand', new Map(), [QUELLE])).toBeNull()
  })
})

describe('zeileBewerten', () => {
  it('prüft Wortlaut und Seite und findet beides in Ordnung', () => {
    expect(zeileBewerten(fund(), kontext())).toMatchObject({
      key: 'smith2024',
      quelleId: 'q1',
      wortlaut: 'exakt',
      seite: 'stimmt',
      referenz: 'gefunden',
      retraction: 'keine_meldung',
    })
  })

  it('meldet die tatsächliche Seite, wenn die zitierte nicht stimmt', () => {
    const zeile = zeileBewerten(fund({ belege: [{ key: 'smith2024', seite: '345' }] }), kontext())
    expect(zeile).toMatchObject({ seite: 'gefunden', gefundenAuf: '346' })
  })

  it('zeigt bestätigte Seitenzahlen als bestätigt', () => {
    const quelle = { ...QUELLE, versatzQuelle: 'bestaetigt' }
    expect(zeileBewerten(fund(), kontext({ quellen: [quelle] })).seite).toBe('bestaetigt')
  })

  it('kann die Seite ohne Versatz oder ohne Seitenangabe nicht prüfen', () => {
    expect(zeileBewerten(fund(), kontext({ quellen: [{ ...QUELLE, versatz: null }] })).seite).toBe('nicht_pruefbar')
    expect(zeileBewerten(fund({ belege: [{ key: 'smith2024' }] }), kontext()).seite).toBe('nicht_pruefbar')
  })

  it('meldet abweichenden Wortlaut', () => {
    expect(zeileBewerten(fund({ roh: 'Etwas ganz anderes.' }), kontext()).wortlaut).toBe('abweichend')
  })

  it('meldet quelle_fehlt, wenn es zum Schlüssel keine Quelle gibt', () => {
    const zeile = zeileBewerten(fund({ belege: [{ key: 'unbekannt', seite: '1' }] }), kontext())
    expect(zeile).toMatchObject({ wortlaut: 'quelle_fehlt', quelleId: null, seite: null })
  })

  it('lässt den Wortlaut offen, wenn nur zitiert wird (ohne Anführung)', () => {
    expect(zeileBewerten(fund({ roh: '' }), kontext())).toMatchObject({ wortlaut: null, seite: null })
    expect(zeileBewerten(fund({ roh: '', belege: [{ key: 'x' }] }), kontext()).wortlaut).toBeNull()
  })

  it('behandelt unbekannte Formen und Funde ohne Beleg als nicht prüfbar', () => {
    expect(zeileBewerten(fund({ form: 'unbekannt' }), kontext())).toMatchObject({ wortlaut: 'nicht_pruefbar', key: null })
    expect(zeileBewerten(fund({ belege: [] }), kontext())).toMatchObject({ wortlaut: 'nicht_pruefbar', key: null })
  })

  it('kürzt den Auszug auf 200 Zeichen', () => {
    expect(zeileBewerten(fund({ roh: `  ${'a'.repeat(300)}` }), kontext()).auszug).toHaveLength(200)
  })

  it('bewertet die Referenz: ohne DOI, nicht prüfbar, nicht gefunden, zurückgezogen', () => {
    const ohneDoi = kontext({ bibEintraege: new Map([['smith2024', { key: 'smith2024', doi: null }]]) })
    expect(zeileBewerten(fund(), ohneDoi)).toMatchObject({ referenz: 'ohne_doi', retraction: null })
    // Crossref nicht erreichbar ist kein Befund über die Arbeit: nicht prüfbar mit Grund, nie „unbekannt“.
    expect(zeileBewerten(fund(), kontext({ werke: new Map([['10.5555/spur.1', null]]) }))).toMatchObject({
      referenz: 'nicht_pruefbar',
      grund: 'crossref_nicht_erreichbar',
      retraction: null,
    })
    expect(zeileBewerten(fund(), kontext({ werke: new Map([['10.5555/spur.1', { gefunden: false }]]) }))).toMatchObject({
      referenz: 'nicht_gefunden',
      retraction: null,
    })
    const zurueck = kontext({ werke: new Map([['10.5555/spur.1', { gefunden: true, retraction: 'zurueckgezogen' }]]) })
    expect(zeileBewerten(fund(), zurueck).retraction).toBe('zurueckgezogen')
  })
})

describe('istProblem', () => {
  it.each([
    [{ wortlaut: 'abweichend' }, true],
    [{ wortlaut: 'nicht_pruefbar' }, true],
    [{ wortlaut: 'quelle_fehlt' }, true],
    [{ wortlaut: 'exakt', seite: 'nicht_pruefbar' }, true],
    [{ wortlaut: 'exakt', seite: 'gefunden' }, true],
    [{ wortlaut: 'exakt', referenz: 'nicht_gefunden' }, true],
    [{ wortlaut: 'exakt', retraction: 'zurueckgezogen' }, true],
    [{ wortlaut: 'exakt', retraction: 'korrektur' }, true],
    [{ wortlaut: 'exakt', seite: 'stimmt', referenz: 'gefunden', retraction: 'keine_meldung' }, false],
    [{ wortlaut: 'trennung', seite: 'bestaetigt', referenz: 'ohne_doi' }, false],
    [{ wortlaut: null, seite: null, referenz: 'nicht_pruefbar' }, false],
  ])('bewertet %j als %s', (zeile, erwartet) => {
    expect(istProblem(zeile)).toBe(erwartet)
  })
})

describe('OCR-Quellen', () => {
  const OCR = { ...QUELLE, status: 'ocr', versatz: null }
  const ocrKontext = bestaetigt => kontext({ quellen: [OCR], bestaetigt: new Map(bestaetigt) })

  it('zeigt einen gefundenen Wortlaut nie als exakt, solange kein Mensch die Stelle bestätigt hat', () => {
    const zeile = zeileBewerten(fund(), ocrKontext([]))
    expect(zeile.wortlaut).toBe('ocr_unbestaetigt')
    expect(istProblem(zeile)).toBe(true)
  })

  it('gilt als von Mensch bestätigt, wenn ein bestätigtes Zitat der Quelle den Text enthält', () => {
    const zeile = zeileBewerten(
      fund({ roh: 'consolidation of declarative memory' }),
      ocrKontext([['q1', ['Sleep supports the  consolidation of\ndeclarative memory.']]])
    )
    expect(zeile.wortlaut).toBe('bestaetigt')
  })

  it('zählt bestätigte Zitate einer anderen Quelle oder mit anderem Text nicht', () => {
    expect(zeileBewerten(fund(), ocrKontext([['q2', [SEITEN[1].text]]])).wortlaut).toBe('ocr_unbestaetigt')
    expect(zeileBewerten(fund(), ocrKontext([['q1', ['Anfang der Studie.']]])).wortlaut).toBe('ocr_unbestaetigt')
  })

  it('lässt abweichenden Wortlaut abweichend', () => {
    expect(zeileBewerten(fund({ roh: 'Rest supports memory.' }), ocrKontext([])).wortlaut).toBe('abweichend')
  })
})

describe('Webseiten', () => {
  const WEB = { _id: 'w1', key: 'testseite', art: 'web', status: 'text', doi: null, versatz: null }
  const webKontext = () =>
    kontext({
      bibEintraege: new Map([['testseite', { key: 'testseite' }]]),
      quellen: [WEB],
      seitenJeQuelle: new Map([['w1', [{ label: null, text: 'Regular sleep times help shift workers recover.' }]]]),
    })

  it('prüft den Wortlaut gegen den Schnappschuss und kennt keine Seite', () => {
    const zeile = zeileBewerten(
      fund({ roh: 'Regular sleep times help shift workers recover.', belege: [{ befehl: 'autocite', key: 'testseite', seite: null }] }),
      webKontext()
    )
    expect(zeile).toMatchObject({ wortlaut: 'exakt', seite: null, quelleId: 'w1' })
    expect(istProblem(zeile)).toBe(false)
  })

  it('meldet abweichenden Wortlaut', () => {
    const zeile = zeileBewerten(fund({ roh: 'Irregular sleep helps.', belege: [{ key: 'testseite' }] }), webKontext())
    expect(zeile.wortlaut).toBe('abweichend')
  })
})

describe('stelleEinordnen', () => {
  const QUELLE_ID = 'q1'
  it.each([
    [{ key: 'a', quelleId: QUELLE_ID, wortlaut: 'exakt', seitenangabe: 'S. 3', referenz: 'gefunden' }, 'geprueft', null],
    [{ key: 'a', quelleId: QUELLE_ID, wortlaut: 'abweichend', seitenangabe: '3' }, 'geprueft', null],
    [{ key: 'a', quelleId: QUELLE_ID, wortlaut: null, seitenangabe: null, referenz: 'ohne_doi' }, 'beleg_ohne_wortlaut', 'kein_wortlaut'],
    [{ key: 'a', quelleId: QUELLE_ID, wortlaut: null, seitenangabe: '3', referenz: 'gefunden' }, 'beleg_ohne_wortlaut', 'kein_wortlaut'],
    [{ key: 'a', quelleId: null, wortlaut: 'quelle_fehlt' }, 'ohne_quelle', 'keine_quelle'],
    [{ key: 'a', quelleId: null, wortlaut: null }, 'ohne_quelle', 'keine_quelle'],
    [{ key: 'a', quelleId: QUELLE_ID, wortlaut: 'exakt', seitenangabe: null }, 'ohne_seitenangabe', 'seitenangabe_fehlt'],
    [{ key: 'a', quelleId: null, wortlaut: null, referenz: 'nicht_pruefbar', grund: 'crossref_nicht_erreichbar' }, 'nicht_pruefbar', 'crossref_nicht_erreichbar'],
    [{ key: null, wortlaut: 'nicht_pruefbar' }, 'nicht_pruefbar', 'zitierform_unbekannt'],
    [{ key: 'a', quelleId: QUELLE_ID, wortlaut: 'nicht_pruefbar', seitenangabe: '3' }, 'nicht_pruefbar', 'quelle_ohne_text'],
  ])('%o ist %s', (zeile, status, grund) => {
    expect(stelleEinordnen(zeile)).toEqual({ status, grund })
  })
})

describe('referenzStatus (Registrierstellen)', () => {
  const eintrag = { key: 'k', doi: '10.48550/x' }

  it('meldet eine DataCite-DOI als gefunden, mit Titel und Jahr, ohne Problem', () => {
    const status = referenzStatus(eintrag, {
      gefunden: true,
      registrierstelle: 'datacite',
      registrierstelleName: 'DataCite',
      titel: 'T',
      jahr: 2024,
      retraction: null,
    })
    expect(status).toEqual({ referenz: 'gefunden', registrierstelle: 'datacite', titel: 'T', jahr: 2024, retraction: null })
    expect(istProblem(status)).toBe(false)
  })

  it('meldet eine andere Registrierstelle als registriert, ohne Problem', () => {
    const status = referenzStatus(eintrag, {
      gefunden: true,
      registrierstelle: 'medra',
      registrierstelleName: 'mEDRA',
      metadaten: false,
      retraction: null,
    })
    expect(status).toEqual({ referenz: 'registriert', registrierstelle: 'medra', registrierstelleName: 'mEDRA', retraction: null })
    expect(istProblem(status)).toBe(false)
  })

  it('meldet eine nicht registrierte DOI als nicht gefunden', () => {
    const status = referenzStatus(eintrag, { gefunden: false, registrierstelle: null })
    expect(status).toEqual({ referenz: 'nicht_gefunden', registrierstelle: null, retraction: null })
    expect(istProblem(status)).toBe(true)
  })

  it('meldet eine nicht erreichbare Registrierstelle als nicht prüfbar, ohne Problem', () => {
    const status = referenzStatus(eintrag, { nichtPruefbar: 'registrierstelle_nicht_erreichbar' })
    expect(status).toEqual({ referenz: 'nicht_pruefbar', grund: 'registrierstelle_nicht_erreichbar', retraction: null })
    expect(istProblem(status)).toBe(false)
    expect(stelleEinordnen({ ...status, key: 'k', quelleId: 'q' })).toEqual({ status: 'nicht_pruefbar', grund: 'registrierstelle_nicht_erreichbar' })
  })
})
