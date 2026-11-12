import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { ObjectId, schalterAttrappe, testDatenbank } from './hilfen/datenbank.mjs'
import { fehlerVon } from './hilfen/fehler.mjs'
import { meldung } from '../../app/src/meldungen.mjs'

let datenbank
let SchreibManager
let Errors
let schalter
let projektDateien
let dokumente
let spurUpdate
let upsertDocWithPath
let deleteEntity
let bereichPruefen
let laufManager
let binaer
let eintraege
const projekt = new ObjectId()
const bot = new ObjectId()
const lauf = { _id: new ObjectId() }
const KAPITEL = new ObjectId()

beforeAll(async () => {
  datenbank = await testDatenbank()
})
afterAll(async () => await datenbank.schliessen())

beforeEach(async () => {
  await datenbank.leeren()
  schalter = schalterAttrappe()
  projektDateien = new Map([['kapitel.tex', KAPITEL]])
  binaer = new Set()
  eintraege = 10
  dokumente = new Map()
  spurUpdate = vi.fn(async () => {})
  bereichPruefen = vi.fn(async () => [])
  deleteEntity = vi.fn(async () => {})
  laufManager = {
    laufFuerSchreiben: vi.fn(async () => lauf),
    aenderungMerken: vi.fn(async () => {}),
  }
  vi.resetModules()
  ;({ default: Errors } = await import('../../../../app/src/Features/Errors/Errors.js'))
  upsertDocWithPath = vi.fn(async (_projekt, pfad) => {
    const doc = { _id: new ObjectId() }
    projektDateien.set(pfad.replace(/^\//, ''), doc._id)
    dokumente.set(String(doc._id), { lines: [''], version: 1, ranges: { changes: [] } })
    return { doc }
  })
  docSetzen(KAPITEL, 'Erster Satz. Zweiter Satz.')

  vi.doMock('../../../../app/src/infrastructure/mongodb.mjs', () => datenbank.mongodbModul)
  vi.doMock('../../app/src/schalter.mjs', () => schalter.modul)
  vi.doMock('../../../../app/src/Features/DocumentUpdater/DocumentUpdaterHandler.mjs', () => ({
    default: { promises: { getDocument: async (_p, docId) => dokumente.get(String(docId)) } },
  }))
  vi.doMock('../../../../app/src/Features/Editor/EditorController.mjs', () => ({
    default: { promises: { upsertDocWithPath, deleteEntity } },
  }))
  vi.doMock('../../../../app/src/Features/Editor/EditorHttpController.mjs', () => ({
    default: { _nameIsAcceptableLength: name => name != null && name.length < 150 && name.length !== 0 },
  }))
  vi.doMock('../../../../app/src/Features/Project/ProjectLocator.mjs', () => ({
    default: {
      promises: {
        findElement: async ({ element_id: id }) => {
          const pfad = [...projektDateien].find(([, wert]) => String(wert) === String(id))?.[0]
          if (!pfad) throw new Errors.NotFoundError('weg')
          return { element: { _id: id }, path: { fileSystem: `/${pfad}` } }
        },
        findElementByPath: async ({ path }) => {
          const pfad = path.replace(/^\//, '')
          if (binaer.has(pfad)) return { element: { _id: new ObjectId(), name: pfad }, type: 'file' }
          const id = projektDateien.get(pfad)
          if (!id) throw new Errors.NotFoundError('weg')
          return { element: { _id: id }, type: 'doc' }
        },
      },
    },
  }))
  vi.doMock('../../app/src/schreiben/spurUpdate.mjs', () => ({ spurUpdate }))
  vi.doMock('../../app/src/projektEintraege.mjs', () => ({ anzahlEintraege: async () => eintraege, maxEintraege: () => 2000 }))
  vi.doMock('../../app/src/schreiben/LaufManager.mjs', () => laufManager)
  vi.doMock('../../app/src/pruefung/PruefManager.mjs', () => ({ bereichPruefen }))
  SchreibManager = await import('../../app/src/schreiben/SchreibManager.mjs')
})

function docSetzen(id, text, changes = [], version = 5) {
  dokumente.set(String(id), { lines: text.split('\n'), version, ranges: { changes } })
}

const bearbeiten = (felder = {}) =>
  SchreibManager.docEdit({
    projectId: projekt,
    botId: bot,
    pfad: 'kapitel.tex',
    alt: 'Zweiter Satz.',
    neu: 'Dritter Satz.',
    schluessel: 'schluessel-0001',
    ...felder,
  })

describe('docEdit', () => {
  it('ersetzt den Alttext als Track Change des Bots und meldet Lauf und Version', async () => {
    const ergebnis = await bearbeiten()
    expect(spurUpdate).toHaveBeenCalledWith(
      projekt,
      String(KAPITEL),
      [{ p: 13, d: 'Zweiter' }, { p: 13, i: 'Dritter' }],
      5,
      { userId: bot, tracked: true }
    )
    expect(ergebnis).toEqual({ doc_id: String(KAPITEL), version: 5, lauf_id: lauf._id, aenderung: true, rot: [], zahlen_ohne_beleg: [] })
    expect(laufManager.aenderungMerken).toHaveBeenCalledWith(lauf, { docId: String(KAPITEL), rot: [], zahlen: [] })
  })

  it('meldet frei getippte Zahlen und merkt sie am Lauf', async () => {
    const ergebnis = await bearbeiten({ neu: 'Es waren 412 Personen, seit 2019.' })
    expect(ergebnis.zahlen_ohne_beleg).toEqual(['412'])
    expect(laufManager.aenderungMerken).toHaveBeenCalledWith(lauf, {
      docId: String(KAPITEL),
      rot: [],
      zahlen: [{ zahl: '412', pfad: 'kapitel.tex' }],
    })
  })

  it('meldet keine Zahl, die schon in ergebnisse.tex steht', async () => {
    const ergebnisse = new ObjectId()
    projektDateien.set('ergebnisse.tex', ergebnisse)
    docSetzen(ergebnisse, String.raw`\newcommand{\ausbeute}{\qty{75.7}{\percent}}`)
    const ergebnis = await bearbeiten({ neu: String.raw`Ausbeute \qty{75.7}{\percent}, Volumen $V = 0{,}89\,\mathrm{L}$.` })
    expect(ergebnis.zahlen_ohne_beleg).toEqual(['0,89'])
  })

  it('prüft in .bib-Dateien keine Zahlen', async () => {
    const bib = new ObjectId()
    projektDateien.set('quellen.bib', bib)
    docSetzen(bib, '@article{a,\n}')
    const ergebnis = await bearbeiten({ pfad: 'quellen.bib', alt: '\n}', neu: '\n  volume = {11},\n  pages = {3570}\n}' })
    expect(ergebnis.zahlen_ohne_beleg).toEqual([])
  })

  it('findet das Dokument auch über die doc_id', async () => {
    await bearbeiten({ pfad: undefined, docId: String(KAPITEL) })
    expect(spurUpdate).toHaveBeenCalledTimes(1)
  })

  it('hängt ohne Alttext am Ende an', async () => {
    await bearbeiten({ alt: '', neu: ' Vierter Satz.' })
    expect(spurUpdate.mock.calls[0][2]).toEqual([{ p: 26, i: ' Vierter Satz.' }])
  })

  it('ändert nichts und startet keinen Lauf-Eintrag, wenn alt und neu gleich sind', async () => {
    const ergebnis = await bearbeiten({ neu: 'Zweiter Satz.' })
    expect(ergebnis.aenderung).toBe(false)
    expect(spurUpdate).not.toHaveBeenCalled()
    expect(laufManager.aenderungMerken).not.toHaveBeenCalled()
  })

  it('verlangt doc_id oder pfad', async () => {
    const fehler = await fehlerVon(bearbeiten({ pfad: undefined }))
    expect(fehler).toMatchObject({ code: 'doc_fehlt' })
  })

  it.each([
    ['ein unbekannter Pfad', { pfad: 'gibt-es-nicht.tex' }],
    ['eine unbekannte doc_id', { pfad: undefined, docId: String(new ObjectId()) }],
  ])('meldet doc_fehlt für %s', async (_name, felder) => {
    expect(await fehlerVon(bearbeiten(felder))).toMatchObject({ code: 'doc_fehlt' })
  })

  it('meldet konflikt, wenn der Alttext fehlt', async () => {
    const fehler = await fehlerVon(bearbeiten({ alt: 'Gibt es nicht.' }))
    expect(fehler).toMatchObject({ code: 'konflikt' })
    expect(fehler.message).toBe(meldung('spur_fehler_alttext_fehlt'))
    expect(spurUpdate).not.toHaveBeenCalled()
  })

  it('meldet konflikt, wenn der Alttext mehrfach vorkommt', async () => {
    docSetzen(KAPITEL, 'Satz. Satz.')
    const fehler = await fehlerVon(bearbeiten({ alt: 'Satz.' }))
    expect(fehler).toMatchObject({ code: 'konflikt' })
    expect(fehler.message).toBe(meldung('spur_fehler_alttext_mehrfach'))
  })

  it('stoppt bei fast 2000 offenen Änderungen mit grenze_changes', async () => {
    docSetzen(KAPITEL, 'Text', Array.from({ length: 1990 }, (_, i) => ({ id: String(i) })))
    expect(await fehlerVon(bearbeiten({ alt: 'Text', neu: 'Neu' }))).toMatchObject({ code: 'grenze_changes' })
    docSetzen(KAPITEL, 'Text', Array.from({ length: 1989 }, (_, i) => ({ id: String(i) })))
    expect((await bearbeiten({ alt: 'Text', neu: 'Neu' })).aenderung).toBe(true)
  })

  it('reicht Fehler des document-updater weiter und gibt den Schlüssel wieder frei', async () => {
    spurUpdate.mockRejectedValueOnce(Object.assign(new Error('409'), { code: 'konflikt_du' }))
    expect(await fehlerVon(bearbeiten())).toMatchObject({ code: 'konflikt_du' })
    expect((await bearbeiten()).aenderung).toBe(true)
    expect(spurUpdate).toHaveBeenCalledTimes(2)
  })
})

describe('Pfadprüfung', () => {
  const lang = 'x'.repeat(146)
  const gerade = 'x'.repeat(145)

  it.each([
    ['ein zu langer Dateiname', `${lang}.tex`],
    ['ein zu langer Ordnername', `${'x'.repeat(150)}/kapitel.tex`],
    ['ein Pfad mit ..', '../kapitel.tex'],
    ['ein Name mit verbotenem Zeichen', 'kap*itel.tex'],
    ['ein reservierter Name', 'constructor'],
  ])('weist bei doc_create %s mit pfad_ungueltig ab, ohne etwas anzulegen', async (_name, pfad) => {
    const fehler = await fehlerVon(
      SchreibManager.docCreate({ projectId: projekt, botId: bot, pfad, inhalt: 'x', schluessel: 'schluessel-0002' })
    )
    expect(fehler).toMatchObject({ code: 'pfad_ungueltig' })
    expect(upsertDocWithPath).not.toHaveBeenCalled()
    expect(await datenbank.db.collection('spurEdits').countDocuments()).toBe(0)
  })

  it('weist bei doc_edit einen zu langen Dateinamen mit pfad_ungueltig ab', async () => {
    expect(await fehlerVon(bearbeiten({ pfad: `${lang}.tex` }))).toMatchObject({ code: 'pfad_ungueltig' })
    expect(spurUpdate).not.toHaveBeenCalled()
  })

  it('lässt Namen knapp unter der Grenze zu', async () => {
    const ergebnis = await SchreibManager.docCreate({
      projectId: projekt,
      botId: bot,
      pfad: `${gerade}.tex`,
      inhalt: 'Inhalt',
      schluessel: 'schluessel-0003',
    })
    expect(ergebnis.aenderung).toBe(true)
  })
})

describe('docCreate', () => {
  const anlegen = (felder = {}) =>
    SchreibManager.docCreate({
      projectId: projekt,
      botId: bot,
      pfad: 'neu/kapitel2.tex',
      inhalt: 'Neuer Inhalt.',
      schluessel: 'schluessel-0004',
      ...felder,
    })

  it('legt das Dokument leer an und schreibt den Inhalt als Track Change', async () => {
    const ergebnis = await anlegen()
    expect(upsertDocWithPath).toHaveBeenCalledWith(projekt, '/neu/kapitel2.tex', [''], 'spur', bot)
    expect(spurUpdate.mock.calls[0][2]).toEqual([{ p: 0, i: 'Neuer Inhalt.' }])
    expect(spurUpdate.mock.calls[0][4]).toEqual({ userId: bot, tracked: true })
    expect(ergebnis).toMatchObject({ aenderung: true, lauf_id: lauf._id })
  })

  it('überschreibt keine vorhandene Datei', async () => {
    const fehler = await fehlerVon(anlegen({ pfad: 'kapitel.tex' }))
    expect(fehler).toMatchObject({ code: 'konflikt' })
    expect(upsertDocWithPath).not.toHaveBeenCalled()
  })

  it('meldet pfad_ungueltig, wenn Overleaf den Namen ablehnt', async () => {
    upsertDocWithPath.mockRejectedValueOnce(new Errors.InvalidNameError('nein'))
    expect(await fehlerVon(anlegen())).toMatchObject({ code: 'pfad_ungueltig' })
  })

  it('reicht andere Fehler beim Anlegen weiter', async () => {
    upsertDocWithPath.mockRejectedValueOnce(new Error('Mongo weg'))
    expect((await fehlerVon(anlegen())).message).toBe('Mongo weg')
  })

  it('löscht das leere Dokument wieder, wenn das Schreiben scheitert', async () => {
    bereichPruefen.mockResolvedValueOnce([{ wortlaut: 'abweichend', key: 'a', auszug: 'x', form: 'enquote' }])
    const fehler = await fehlerVon(anlegen({ inhalt: '\\enquote{Falsch.} \\autocite{a}' }))
    expect(fehler).toMatchObject({ code: 'zitat_abweichend' })
    expect(deleteEntity).toHaveBeenCalledWith(projekt, expect.anything(), 'doc', 'spur', bot)
  })
})

describe('docCreate: Ursachen statt „interner Fehler“', () => {
  const anlegen = (felder = {}) =>
    SchreibManager.docCreate({ projectId: projekt, botId: bot, pfad: 'kapitel/einleitung.tex', inhalt: 'Text.', schluessel: `s-${Math.random()}`, ...felder })
  // Wie RequestFailedError von @overleaf/fetch-utils: Die Antwort hängt am Fehler.
  const dienstFehler = () => Object.assign(new Error('request failed'), { response: new Response('', { status: 500 }) })

  it('meldet pfad_ist_datei, wenn ein Pfadteil eine Datei ist, und legt nichts an', async () => {
    binaer.add('abb')
    const fehler = await fehlerVon(anlegen({ pfad: 'abb/x.tex' }))
    expect(fehler).toMatchObject({ code: 'pfad_ist_datei', message: meldung('spur_fehler_pfad_ist_datei', { teil: 'abb' }) })
    expect(upsertDocWithPath).not.toHaveBeenCalled()
  })

  it('meldet projekt_zu_viele_dateien bei 2000 Einträgen, bevor etwas entsteht', async () => {
    eintraege = 2000
    const fehler = await fehlerVon(anlegen())
    expect(fehler).toMatchObject({ code: 'projekt_zu_viele_dateien', message: meldung('spur_fehler_projekt_zu_viele_dateien', { anzahl: 2000, grenze: 2000 }) })
    expect(upsertDocWithPath).not.toHaveBeenCalled()
  })

  it('übersetzt TooManyFilesError von Overleaf in projekt_zu_viele_dateien', async () => {
    upsertDocWithPath.mockRejectedValueOnce(new Errors.TooManyFilesError('voll'))
    expect(await fehlerVon(anlegen())).toMatchObject({ code: 'projekt_zu_viele_dateien' })
  })

  it('meldet dienst_nicht_erreichbar bei 500 des document-updater, räumt auf und lässt den zweiten Versuch zu', async () => {
    spurUpdate.mockRejectedValueOnce(dienstFehler())
    expect(await fehlerVon(anlegen())).toMatchObject({ code: 'dienst_nicht_erreichbar' })
    expect(deleteEntity).toHaveBeenCalledTimes(1)
    projektDateien.delete('kapitel/einleitung.tex')
    expect((await anlegen()).aenderung).toBe(true)
  })

  it('meldet bei gescheitertem Aufräumen den ersten Fehler, und der nächste Versuch nimmt das leere Dokument', async () => {
    spurUpdate.mockRejectedValueOnce(dienstFehler())
    deleteEntity.mockRejectedValueOnce(new Error('Aufräumen gescheitert'))
    expect(await fehlerVon(anlegen())).toMatchObject({ code: 'dienst_nicht_erreichbar' })
    expect(upsertDocWithPath).toHaveBeenCalledTimes(1)
    const ergebnis = await anlegen()
    expect(ergebnis.aenderung).toBe(true)
    expect(upsertDocWithPath).toHaveBeenCalledTimes(1)
  })

  it('lässt ein leeres Dokument eines anderen Bots oder mit Inhalt nicht überschreiben', async () => {
    spurUpdate.mockRejectedValueOnce(dienstFehler())
    deleteEntity.mockRejectedValueOnce(new Error('Aufräumen gescheitert'))
    await fehlerVon(anlegen())
    const fremd = await fehlerVon(SchreibManager.docCreate({ projectId: projekt, botId: new ObjectId(), pfad: 'kapitel/einleitung.tex', inhalt: 'x', schluessel: 'fremd-0001' }))
    expect(fremd).toMatchObject({ code: 'konflikt' })
    docSetzen(projektDateien.get('kapitel/einleitung.tex'), 'Jemand hat geschrieben.')
    expect(await fehlerVon(anlegen())).toMatchObject({ code: 'konflikt' })
  })

  it('nennt bei konflikt den Pfad', async () => {
    await anlegen()
    const fehler = await fehlerVon(anlegen())
    expect(fehler).toMatchObject({ code: 'konflikt' })
    expect(fehler.message).toContain('kapitel/einleitung.tex')
  })

  it('gelingt mit Zahlen, auch wenn ergebnisse.tex eine Binärdatei ist', async () => {
    binaer.add('ergebnisse.tex')
    const ergebnis = await anlegen({ inhalt: 'Es waren 412 Personen.' })
    expect(ergebnis.zahlen_ohne_beleg).toEqual(['412'])
  })
})

describe('Zitatprüfung beim Schreiben', () => {
  const ZITAT = '\\enquote{Sleep supports.} \\autocite[3]{smith2024}'
  const mitZitat = () => bearbeiten({ alt: 'Zweiter Satz.', neu: ZITAT })

  it('prüft auch, wenn nur der Wortlaut in einem Zitat oder eigenen Zitatmakro geändert wird', async () => {
    docSetzen(KAPITEL, 'Vorher \\enquote{exakter Wortlaut} \\cite[3]{k} und \\zitat{eigener Wortlaut} \\cite[3]{k}.')
    await bearbeiten({ alt: 'exakter Wortlaut', neu: 'erfundener Wortlaut' })
    await bearbeiten({ alt: 'eigener Wortlaut', neu: 'anderer Wortlaut', schluessel: 'schluessel-0098' })
    expect(bereichPruefen).toHaveBeenCalledTimes(2)
  })

  it('prüft nur, wenn die Änderung ein Zitat berührt', async () => {
    await bearbeiten()
    expect(bereichPruefen).not.toHaveBeenCalled()
    await bearbeiten({ alt: 'Zweiter Satz.', neu: ZITAT, schluessel: 'schluessel-0099' })
    expect(bereichPruefen).toHaveBeenCalledTimes(1)
  })

  it('lehnt abweichenden Wortlaut mit zitat_abweichend ab', async () => {
    bereichPruefen.mockResolvedValue([{ wortlaut: 'abweichend', key: 'smith2024', auszug: 'Sleep supports.', form: 'enquote' }])
    const fehler = await fehlerVon(mitZitat())
    expect(fehler).toMatchObject({ code: 'zitat_abweichend' })
    expect(fehler.message).toContain('Sleep supports.')
    expect(spurUpdate).not.toHaveBeenCalled()
  })

  it('lehnt Zitate ohne Quelle mit quelle_fehlt ab', async () => {
    bereichPruefen.mockResolvedValue([{ wortlaut: 'quelle_fehlt', key: 'smith2024', auszug: 'x', form: 'enquote' }])
    expect(await fehlerVon(mitZitat())).toMatchObject({ code: 'quelle_fehlt' })
  })

  it('nimmt nicht prüfbare Zitate an, markiert sie aber rot', async () => {
    bereichPruefen.mockResolvedValue([
      { wortlaut: 'nicht_pruefbar', key: 'a', auszug: 'Eins', form: 'enquote' },
      { wortlaut: null, form: 'unbekannt', key: null, auszug: 'Zwei' },
      { wortlaut: 'gefunden', form: 'enquote', key: 'b', auszug: 'Drei' },
    ])
    const ergebnis = await mitZitat()
    expect(ergebnis.rot).toEqual([
      { grund: 'nicht_pruefbar', auszug: 'Eins' },
      { grund: 'nicht_pruefbar', auszug: 'Zwei' },
    ])
    expect(laufManager.aenderungMerken).toHaveBeenCalledWith(lauf, { docId: String(KAPITEL), rot: ergebnis.rot, zahlen: [] })
  })
})

describe('Idempotenz', () => {
  it('liefert bei Wiederholung dasselbe Ergebnis, ohne erneut zu schreiben', async () => {
    const erst = await bearbeiten()
    const nochmal = await bearbeiten()
    expect(nochmal).toEqual({ ...erst, wiederholt: true })
    expect(spurUpdate).toHaveBeenCalledTimes(1)
  })

  it('weist denselben Schlüssel mit anderem Inhalt ab', async () => {
    await bearbeiten()
    const fehler = await fehlerVon(bearbeiten({ neu: 'Etwas ganz anderes.' }))
    expect(fehler).toMatchObject({ code: 'konflikt' })
    expect(fehler.message).toBe(meldung('spur_fehler_idempotenz_andere_aenderung'))
  })

  it('weist denselben Schlüssel in einem anderen Projekt ab', async () => {
    await bearbeiten()
    const fehler = await fehlerVon(bearbeiten({ projectId: new ObjectId() }))
    expect(fehler.message).toBe(meldung('spur_fehler_idempotenz_anderes_projekt'))
  })

  it('meldet einen Aufruf, der noch läuft, als konflikt', async () => {
    await datenbank.db.collection('spurEdits').insertOne({ botId: bot, schluessel: 'schluessel-0001', projectId: projekt, am: schalter.zeit })
    const fehler = await fehlerVon(bearbeiten())
    expect(fehler).toMatchObject({ code: 'konflikt' })
    expect(fehler.message).toBe(meldung('spur_fehler_idempotenz_laeuft'))
  })

  it('gibt eine verwaiste Reservierung nach zwei Minuten frei und schreibt', async () => {
    await datenbank.db.collection('spurEdits').insertOne({
      botId: bot,
      schluessel: 'schluessel-0001',
      projectId: projekt,
      am: new Date(schalter.zeit.getTime() - 2 * 60 * 1000 - 1),
    })
    expect((await bearbeiten()).aenderung).toBe(true)
    expect(spurUpdate).toHaveBeenCalledTimes(1)
  })

  it('gilt je Bot: Derselbe Schlüssel eines anderen Bots schreibt', async () => {
    await bearbeiten()
    docSetzen(KAPITEL, 'Erster Satz. Zweiter Satz.')
    await bearbeiten({ botId: new ObjectId() })
    expect(spurUpdate).toHaveBeenCalledTimes(2)
  })

  it('behält die Reservierung, wenn nur das Mitzählen am Lauf scheitert', async () => {
    laufManager.aenderungMerken.mockRejectedValueOnce(new Error('Mongo weg'))
    const erst = await bearbeiten()
    expect(erst.aenderung).toBe(true)
    expect((await bearbeiten()).wiederholt).toBe(true)
    expect(spurUpdate).toHaveBeenCalledTimes(1)
  })

  it('meldet konflikt, wenn die Reservierung zwischen Anlegen und Nachsehen verschwindet', async () => {
    const eintraege = datenbank.db.collection('spurEdits')
    await eintraege.insertOne({ botId: bot, schluessel: 'schluessel-0001', projectId: projekt, am: schalter.zeit })
    const echt = datenbank.mongodbModul.getCollectionInternal
    datenbank.mongodbModul.getCollectionInternal = async name => {
      const sammlung = await echt(name)
      if (name !== 'spurEdits') return sammlung
      return new Proxy(sammlung, {
        get: (ziel, eigenschaft) =>
          eigenschaft === 'findOne'
            ? async () => null
            : typeof ziel[eigenschaft] === 'function'
              ? ziel[eigenschaft].bind(ziel)
              : ziel[eigenschaft],
      })
    }
    try {
      vi.resetModules()
      const neu = await import('../../app/src/schreiben/SchreibManager.mjs')
      const fehler = await fehlerVon(
        neu.docEdit({ projectId: projekt, botId: bot, pfad: 'kapitel.tex', alt: 'a', neu: 'b', schluessel: 'schluessel-0001' })
      )
      expect(fehler.message).toBe(meldung('spur_fehler_idempotenz_gescheitert'))
    } finally {
      datenbank.mongodbModul.getCollectionInternal = echt
    }
  })
})
