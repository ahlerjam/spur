import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import logger from '@overleaf/logger'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { ObjectId } from './hilfen/datenbank.mjs'
import { Antwort, anfrage } from './hilfen/express.mjs'
import { fixture } from './hilfen/quellen.mjs'

let C
let m
let Problem
const anna = new ObjectId()
const projekt = new ObjectId()
const ordner = mkdtempSync(join(tmpdir(), 'spur-controller-'))
afterAll(() => rmSync(ordner, { recursive: true, force: true }))

beforeEach(async () => {
  m = {
    Import: { zoteroSammlungen: vi.fn(), zoteroImportieren: vi.fn() },
    Literatur: {},
    Offenlegung: {},
    Semantik: {},
    Quellen: {
      liste: vi.fn(),
      aufnehmen: vi.fn(),
      dateinamenSuchen: vi.fn(async () => []),
      suchen: vi.fn(async () => []),
      holen: vi.fn(),
      seite: vi.fn(),
      bild: vi.fn(),
      dateiPfad: vi.fn(),
      aendern: vi.fn(async (q, felder) => ({ ...q, ...felder })),
      loeschen: vi.fn(async () => {}),
      zipSchreiben: vi.fn(async () => {}),
      projekteMitQuellen: vi.fn(async () => []),
      klonHinweis: vi.fn(async () => null),
      uebernehmen: vi.fn(async () => 2),
      ocrZustand: q => q.ocr ?? null,
      vonIds: vi.fn(async () => []),
      webAufnehmen: vi.fn(async () => ({ _id: 'w1', art: 'web', dateiname: 'seite.html', meta: { titel: 'Seite' }, web: { url: 'https://example.org/', abgerufenAm: new Date(0), hash: 'h' } })),
      ocrStarten: vi.fn(async q => ({ quelle: { ...q, ocr: { status: 'laeuft', fertig: 0, gesamt: 3 } }, lauf: Promise.resolve() })),
    },
    Zitate: { liste: vi.fn(), markieren: vi.fn(), holen: vi.fn(), einfuegen: vi.fn(), kommentieren: vi.fn(), bestaetigen: vi.fn(), zuweisungLoesen: vi.fn(async () => {}), zugewiesenAn: vi.fn(async () => []) },
    Team: {
      namen: vi.fn(async () => new Map([[String(anna), 'Anna Autor'], ['ben', 'Ben']])),
      nameAus: (namen, id) => namen.get(String(id)) ?? 'Gelöschtes Konto',
      mitglieder: vi.fn(async () => [{ id: String(anna), name: 'Anna Autor' }]),
    },
    Pruef: { bericht: vi.fn(async () => ({ zeilen: [] })) },
    Zugang: {
      tokens: vi.fn(async () => []),
      tokenErzeugen: vi.fn(async () => ({ id: 't1', token: 'spur_x' })),
      widerrufen: vi.fn(async () => {}),
      botFuer: vi.fn(async () => ({ _id: 'bot1' })),
    },
    Inbox: { verlauf: vi.fn(async () => []), verbunden: vi.fn(async () => true), auftragAnlegen: vi.fn(async () => ({ _id: 'n1' })) },
    Aktionen: {
      automatik: vi.fn(async () => false),
      laufDaten: vi.fn(async () => ({ lauf: null, aenderungen: [] })),
      laufHolen: vi.fn(async () => ({ _id: 'l1' })),
      annehmen: vi.fn(async () => ({ angenommen: 1, rest: 0 })),
      ablehnen: vi.fn(async () => ({ abgelehnt: 1, rest: 0 })),
      zuruecknehmen: vi.fn(async () => {}),
      automatikSetzen: vi.fn(async () => {}),
    },
    Lauf: { letzterLauf: vi.fn(async () => null) },
    mitglied: true,
    stufe: 'readAndWrite',
  }
  vi.resetModules()
  ;({ Problem } = await import('../../app/src/probleme.mjs'))
  vi.doMock('../../../../app/src/infrastructure/mongodb.mjs', () => ({
    ObjectId,
    db: { users: { findOne: async () => ({ _id: anna, email: 'anna@example.org' }) } },
  }))
  vi.doMock('../../../../app/src/Features/Authentication/SessionManager.mjs', () => ({
    default: { getLoggedInUserId: () => String(anna) },
  }))
  vi.doMock('../../../../app/src/Features/Collaborators/CollaboratorsGetter.mjs', () => ({
    default: { promises: { isUserInvitedMemberOfProject: async () => m.mitglied } },
  }))
  vi.doMock('../../../../app/src/Features/Authorization/AuthorizationManager.mjs', () => ({
    default: { promises: { getPrivilegeLevelForProject: async () => m.stufe } },
  }))
  vi.doMock('../../app/src/QuellenManager.mjs', () => m.Quellen)
  vi.doMock('../../app/src/recherche/Import.mjs', () => m.Import)
  vi.doMock('../../app/src/literatur/Literatur.mjs', () => m.Literatur)
  vi.doMock('../../app/src/offenlegung/Offenlegung.mjs', () => m.Offenlegung)
  vi.doMock('../../app/src/semantik/Semantik.mjs', () => m.Semantik)
  vi.doMock('../../app/src/ZitatManager.mjs', () => m.Zitate)
  vi.doMock('../../app/src/Team.mjs', () => m.Team)
  vi.doMock('../../app/src/pruefung/PruefManager.mjs', () => m.Pruef)
  vi.doMock('../../app/src/ClaudeZugang.mjs', () => m.Zugang)
  vi.doMock('../../app/src/Inbox.mjs', () => m.Inbox)
  vi.doMock('../../app/src/schreiben/LaufAktionen.mjs', () => m.Aktionen)
  vi.doMock('../../app/src/schreiben/LaufManager.mjs', () => m.Lauf)
  C = await import('../../app/src/SpurController.mjs')
})

const req = (felder = {}) => anfrage({ params: { project_id: String(projekt) }, ...felder })
const ausfuehren = async (handler, anfrageObjekt, antwort = new Antwort()) => {
  const next = vi.fn()
  await handler(anfrageObjekt, antwort, next)
  return { res: antwort, next }
}

const quelle = (extra = {}) => ({ _id: new ObjectId(), dateiname: 'a.pdf', key: 'a', art: 'pdf', seitenzahl: 3, status: 'text', doi: '10.1/a', meta: { titel: 'Titel' }, fassung: '', versatz: 344, versatzQuelle: 'pagelabels', ...extra })

describe('Quellenliste und Suche', () => {
  it('quellenListe gibt nur die Felder für den Client heraus', async () => {
    const q = quelle({ geheim: 'x' })
    m.Quellen.liste.mockResolvedValue({ quellen: [q], gesamt: 1, seitengroesse: 100 })
    const { res } = await ausfuehren(C.quellenListe, req({ query: { seite: '2' } }))
    expect(m.Quellen.liste).toHaveBeenCalledWith(projekt, { seite: 2 })
    expect(res.body.quellen[0]).toEqual({ id: q._id, dateiname: 'a.pdf', key: 'a', art: 'pdf', seitenzahl: 3, status: 'text', doi: '10.1/a', titel: 'Titel', fassung: '', versatz: 344, versatzQuelle: 'pagelabels', nurProjekt: false, ocr: null, web: null })
    expect(res.body).toMatchObject({ gesamt: 1, seitengroesse: 100 })
  })

  it('quellenListe nimmt bei unsinniger Seite die erste', async () => {
    m.Quellen.liste.mockResolvedValue({ quellen: [] })
    await ausfuehren(C.quellenListe, req({ query: { seite: '-3' } }))
    expect(m.Quellen.liste).toHaveBeenCalledWith(projekt, { seite: 0 })
  })

  it('quellenSuche liefert ohne Suchbegriff nichts und sucht nicht', async () => {
    const { res } = await ausfuehren(C.quellenSuche, req({ query: { q: '  ' } }))
    expect(res.body).toEqual({ treffer: [] })
    expect(m.Quellen.suchen).not.toHaveBeenCalled()
  })

  it('quellenSuche setzt Treffer im Dateinamen vor die im Text', async () => {
    const q = quelle()
    m.Quellen.dateinamenSuchen.mockResolvedValue([q])
    m.Quellen.suchen.mockResolvedValue([{ quelleId: 'q2', seite: 3 }])
    const { res } = await ausfuehren(C.quellenSuche, req({ query: { q: ' sleep ' } }))
    expect(m.Quellen.suchen).toHaveBeenCalledWith(projekt, 'sleep')
    expect(res.body.treffer).toEqual([
      expect.objectContaining({ quelleId: q._id, imDateinamen: true, seite: 1, quelle: expect.objectContaining({ id: q._id }) }),
      { quelleId: 'q2', seite: 3 },
    ])
  })
})

describe('Webseite aufnehmen', () => {
  it('gibt die Adresse weiter und antwortet mit 201, Titel, Adresse und Abrufdatum, ohne Hash', async () => {
    const { res } = await ausfuehren(C.webQuelleAufnehmen, req({ body: { url: 'https://example.org/' } }))
    expect(m.Quellen.webAufnehmen).toHaveBeenCalledWith({ projectId: projekt, userId: anna, url: 'https://example.org/' })
    expect(res.statusCode).toBe(201)
    expect(res.body).toMatchObject({ id: 'w1', art: 'web', titel: 'Seite', web: { url: 'https://example.org/', abgerufenAm: new Date(0) } })
    expect(res.body.web.hash).toBeUndefined()
  })
})

describe('Hochladen', () => {
  const datei = (inhalt = 'pdf') => {
    const pfad = join(ordner, `upload-${Math.random().toString(16).slice(2)}`)
    writeFileSync(pfad, inhalt)
    return pfad
  }

  it('quelleHochladen antwortet ohne Datei mit 400 datei_fehlt als Problem-Antwort', async () => {
    const { res, next } = await ausfuehren(C.quelleHochladen, req({ file: undefined }))
    expect(res.statusCode).toBe(400)
    expect(res.kopfzeilen['Content-Type']).toBe('application/problem+json')
    expect(res.body).toMatchObject({ type: 'urn:spur:problem:datei_fehlt', status: 400 })
    expect(next).not.toHaveBeenCalled()
    expect(m.Quellen.aufnehmen).not.toHaveBeenCalled()
  })

  it('quelleHochladen nimmt die Datei auf, liest den Namen als UTF-8 und räumt die Temp-Datei weg', async () => {
    const pfad = datei()
    const q = quelle()
    m.Quellen.aufnehmen.mockResolvedValue(q)
    const { res } = await ausfuehren(
      C.quelleHochladen,
      req({ file: { originalname: Buffer.from('Müller 2020.pdf', 'utf8').toString('latin1'), path: pfad, size: 3 } })
    )
    expect(m.Quellen.aufnehmen).toHaveBeenCalledWith({ projectId: projekt, userId: anna, dateiname: 'Müller 2020.pdf', tempPfad: pfad, groesse: 3 })
    expect(res.statusCode).toBe(201)
    expect(res.body.id).toEqual(q._id)
    expect(existsSync(pfad)).toBe(false)
  })

  it('quelleHochladen räumt die Temp-Datei auch bei einem Fehler weg', async () => {
    const pfad = datei()
    m.Quellen.aufnehmen.mockRejectedValue(new Problem(415, 'dateityp', 'nein'))
    const { res } = await ausfuehren(C.quelleHochladen, req({ file: { originalname: 'a.docx', path: pfad, size: 3 } }))
    expect(res.statusCode).toBe(415)
    expect(existsSync(pfad)).toBe(false)
  })
})

describe('Seiten, Bilder und Dateien', () => {
  beforeEach(() => {
    m.Quellen.holen.mockResolvedValue(quelle({ seitenzahl: 8 }))
    m.Quellen.seite.mockResolvedValue({ text: 'Text', label: '347', seite: 3 })
  })
  const mitQuelle = extra => req({ params: { project_id: String(projekt), quelle_id: 'q1', seite: '3' }, ...extra })

  it('quelleSeite liefert Text, Label und Seitenzahl', async () => {
    const { res } = await ausfuehren(C.quelleSeite, mitQuelle())
    expect(m.Quellen.seite).toHaveBeenCalledWith(expect.anything(), 3)
    expect(res.body).toEqual({ text: 'Text', label: '347', seite: 3, seitenzahl: 8, art: 'pdf', ocrKonfidenz: null })
  })

  it('quelleBild sendet das PNG einer PDF-Seite', async () => {
    m.Quellen.bild.mockResolvedValue(fixture('smith2024.pdf'))
    const { res } = await ausfuehren(C.quelleBild, mitQuelle())
    expect(res.kopfzeilen['Content-Type']).toBe('png')
    expect(Buffer.concat(res.inhalt).subarray(0, 4).toString()).toBe('%PDF')
  })

  it('quelleBild gibt es nur für PDFs', async () => {
    m.Quellen.holen.mockResolvedValue(quelle({ art: 'vtt' }))
    const { res } = await ausfuehren(C.quelleBild, mitQuelle())
    expect(res.statusCode).toBe(404)
    expect(res.body.type).toBe('urn:spur:problem:kein_bild')
  })

  it('quelleBild meldet eine unbekannte Seite, bevor es rendert', async () => {
    m.Quellen.seite.mockRejectedValue(new Problem(404, 'seite_fehlt', 'weg'))
    const { res } = await ausfuehren(C.quelleBild, mitQuelle())
    expect(res.statusCode).toBe(404)
    expect(m.Quellen.bild).not.toHaveBeenCalled()
  })

  it('quelleDatei sendet die Datei nur an Projektmitglieder', async () => {
    m.Quellen.dateiPfad.mockReturnValue(fixture('interview.vtt'))
    m.mitglied = false
    const abgewiesen = await ausfuehren(C.quelleDatei, mitQuelle())
    expect(abgewiesen.res.statusCode).toBe(403)
    expect(abgewiesen.res.body.type).toBe('urn:spur:problem:nur_mitglieder')
    expect(abgewiesen.res.inhalt).toEqual([])
    m.mitglied = true
    const { res } = await ausfuehren(C.quelleDatei, mitQuelle())
    expect(res.kopfzeilen['Content-Disposition']).toContain('a.pdf')
    expect(Buffer.concat(res.inhalt).toString()).toContain('WEBVTT')
  })
})

describe('Abgebrochene Downloads', () => {
  beforeEach(() => {
    m.Quellen.holen.mockResolvedValue(quelle())
    m.Quellen.seite.mockResolvedValue({})
  })
  const download = () => req({ params: { project_id: String(projekt), quelle_id: 'q1' } })

  it('öffnet die Datei gar nicht erst, wenn der Browser schon weg ist', async () => {
    m.Quellen.dateiPfad.mockReturnValue(join(ordner, 'gibt-es-nicht.pdf'))
    const res = new Antwort()
    res.destroy()
    const { next } = await ausfuehren(C.quelleDatei, download(), res)
    expect(next).not.toHaveBeenCalled()
    expect(logger.warn).not.toHaveBeenCalled()
  })

  it('beendet den Ablauf ohne Fehler, wenn der Browser mitten im Download abbricht', async () => {
    const gross = join(ordner, 'gross.pdf')
    writeFileSync(gross, Buffer.alloc(4 * 1024 * 1024))
    m.Quellen.dateiPfad.mockReturnValue(gross)
    const res = new Antwort({
      schreiben(_stueck, _kodierung, weiter) {
        res.destroy()
        weiter()
      },
    })
    const { next } = await ausfuehren(C.quelleDatei, download(), res)
    expect(next).not.toHaveBeenCalled()
    expect(logger.warn).not.toHaveBeenCalled()
  })

  it('protokolliert eine nicht lesbare Datei, ohne den Prozess zu stören', async () => {
    m.Quellen.dateiPfad.mockReturnValue(join(ordner, 'gibt-es-nicht.pdf'))
    const { next } = await ausfuehren(C.quelleDatei, download())
    expect(next).not.toHaveBeenCalled()
    expect(logger.warn).toHaveBeenCalledTimes(1)
  })
})

describe('Quelle ändern, löschen, exportieren', () => {
  const mitQuelle = body => req({ params: { project_id: String(projekt), quelle_id: 'q1' }, body })

  beforeEach(() => m.Quellen.holen.mockResolvedValue(quelle()))

  it('quelleAendern speichert Fassung und Versatz', async () => {
    const { res } = await ausfuehren(C.quelleAendern, mitQuelle({ fassung: 'Preprint', versatz: 10 }))
    expect(m.Quellen.aendern).toHaveBeenCalledWith(expect.anything(), { fassung: 'Preprint', versatz: 10 })
    expect(res.body).toMatchObject({ fassung: 'Preprint', versatz: 10 })
  })

  it('quelleAendern erlaubt null zum Entfernen des Versatzes', async () => {
    await ausfuehren(C.quelleAendern, mitQuelle({ versatz: null }))
    expect(m.Quellen.aendern).toHaveBeenCalledWith(expect.anything(), { fassung: undefined, versatz: null })
  })

  it.each([
    ['eine Fassung, die kein Text ist', { fassung: 5 }, 'fassung'],
    ['eine zu lange Fassung', { fassung: 'x'.repeat(201) }, 'fassung'],
    ['einen Versatz über 100000', { versatz: 100001 }, 'versatz'],
    ['einen Versatz mit Kommastellen', { versatz: 1.5 }, 'versatz'],
    ['einen Versatz als Text', { versatz: '5' }, 'versatz'],
  ])('quelleAendern weist %s mit 422 ab', async (_name, body, typ) => {
    const { res } = await ausfuehren(C.quelleAendern, mitQuelle(body))
    expect(res.statusCode).toBe(422)
    expect(res.body.type).toBe(`urn:spur:problem:${typ}`)
    expect(m.Quellen.aendern).not.toHaveBeenCalled()
  })

  it('quelleAendern kennt Seitenzahlen nur für PDFs', async () => {
    m.Quellen.holen.mockResolvedValue(quelle({ art: 'vtt' }))
    const { res } = await ausfuehren(C.quelleAendern, mitQuelle({ versatz: 1 }))
    expect(res.statusCode).toBe(422)
  })

  it('quelleLoeschen antwortet mit 204', async () => {
    const { res } = await ausfuehren(C.quelleLoeschen, mitQuelle())
    expect(m.Quellen.loeschen).toHaveBeenCalled()
    expect(res.statusCode).toBe(204)
  })

  it('quellenExport packt das ZIP nur für Projektmitglieder', async () => {
    m.mitglied = false
    expect((await ausfuehren(C.quellenExport, req())).res.statusCode).toBe(403)
    expect(m.Quellen.zipSchreiben).not.toHaveBeenCalled()
    m.mitglied = true
    const { res } = await ausfuehren(C.quellenExport, req())
    expect(res.kopfzeilen['Content-Disposition']).toContain('quellen.zip')
    expect(m.Quellen.zipSchreiben).toHaveBeenCalledWith(projekt, res)
  })
})

describe('Quellen aus anderen Projekten', () => {
  it('andereProjekte nennt Projekte mit Quellen und einen Klon-Hinweis', async () => {
    m.Quellen.projekteMitQuellen.mockResolvedValue([{ id: 'p2', name: 'Alt' }])
    m.Quellen.klonHinweis.mockResolvedValue({ id: 'p3', name: 'Original' })
    const { res } = await ausfuehren(C.andereProjekte, req())
    expect(m.Quellen.projekteMitQuellen).toHaveBeenCalledWith(anna, projekt)
    expect(res.body).toEqual({ projekte: [{ id: 'p2', name: 'Alt' }], klonVon: { id: 'p3', name: 'Original' } })
  })

  it('quellenHolen übernimmt Quellen aus einem Projekt, in dem der Mensch Mitglied ist', async () => {
    const von = new ObjectId()
    const { res } = await ausfuehren(C.quellenHolen, req({ body: { projekt: String(von) } }))
    expect(m.Quellen.uebernehmen).toHaveBeenCalledWith(projekt, von, anna)
    expect(res.body).toEqual({ anzahl: 2 })
  })

  it('quellenHolen weist ungültige Projekte mit 422 ab', async () => {
    const { res } = await ausfuehren(C.quellenHolen, req({ body: { projekt: 'kaputt' } }))
    expect(res.statusCode).toBe(422)
  })

  it('quellenHolen weist fremde Projekte mit 403 ab', async () => {
    m.mitglied = false
    const { res } = await ausfuehren(C.quellenHolen, req({ body: { projekt: String(new ObjectId()) } }))
    expect(res.statusCode).toBe(403)
    expect(m.Quellen.uebernehmen).not.toHaveBeenCalled()
  })
})

describe('Zitate und Prüfbericht', () => {
  const mitQuelle = extra => req({ params: { project_id: String(projekt), quelle_id: 'q1', zitat_id: 'z1' }, ...extra })
  beforeEach(() => m.Quellen.holen.mockResolvedValue(quelle()))

  it('zitate listet Fundstellen ohne interne Felder, mit Namen statt IDs', async () => {
    const am = new Date('2026-11-07T10:00:00Z')
    m.Zitate.liste.mockResolvedValue([
      { _id: 'z1', seite: 3, label: '347', text: 'Satz', projectId: 'geheim', angelegtVon: anna, kommentare: [{ _id: 'k1', von: 'ben', text: 'Prüfen', am }], zugewiesen: { an: anna, von: 'ben', am } },
      { _id: 'z2', seite: 4, label: null, text: 'Alt', angelegtVon: new ObjectId() },
    ])
    const { res } = await ausfuehren(C.zitate, mitQuelle())
    expect(res.body).toEqual({
      zitate: [
        {
          id: 'z1', seite: 3, label: '347', text: 'Satz',
          von: { id: anna, name: 'Anna Autor' },
          kommentare: [{ id: 'k1', von: { id: 'ben', name: 'Ben' }, text: 'Prüfen', am }],
          zugewiesen: { an: { id: anna, name: 'Anna Autor' }, von: { id: 'ben', name: 'Ben' }, am },
          bestaetigt: null,
        },
        { id: 'z2', seite: 4, label: null, text: 'Alt', von: { id: expect.any(ObjectId), name: 'Gelöschtes Konto' }, kommentare: [], zugewiesen: null, bestaetigt: null },
      ],
    })
  })

  it('zitatKommentieren gibt Text und Zuweisung weiter und antwortet mit 201', async () => {
    m.Zitate.kommentieren.mockResolvedValue({ _id: 'z1', seite: 3, label: null, text: 'Satz', angelegtVon: anna, kommentare: [], zugewiesen: null })
    const { res } = await ausfuehren(C.zitatKommentieren, mitQuelle({ body: { text: 'Prüfen', zuweisen: String(anna), anderes: 1 } }))
    expect(m.Zitate.kommentieren).toHaveBeenCalledWith(expect.anything(), 'z1', { text: 'Prüfen', zuweisen: String(anna) }, anna)
    expect(res.statusCode).toBe(201)
    expect(res.body.id).toBe('z1')
  })

  it('zitatBestaetigen nennt, wer bestätigt hat', async () => {
    const am = new Date(0)
    m.Zitate.bestaetigen.mockResolvedValue({ _id: 'z1', seite: 1, label: null, text: 'Satz', angelegtVon: anna, bestaetigt: { von: 'ben', am } })
    const { res } = await ausfuehren(C.zitatBestaetigen, mitQuelle())
    expect(m.Zitate.bestaetigen).toHaveBeenCalledWith(expect.anything(), 'z1', anna)
    expect(res.body.bestaetigt).toEqual({ von: { id: 'ben', name: 'Ben' }, am })
  })

  it('ocrStarten antwortet mit 202 und dem Fortschritt', async () => {
    const { res } = await ausfuehren(C.ocrStarten, mitQuelle())
    expect(m.Quellen.ocrStarten).toHaveBeenCalled()
    expect(res.statusCode).toBe(202)
    expect(res.body.ocr).toEqual({ status: 'laeuft', fertig: 0, gesamt: 3 })
  })

  it('zuweisungLoesen antwortet mit 204', async () => {
    const { res } = await ausfuehren(C.zuweisungLoesen, mitQuelle())
    expect(m.Zitate.zuweisungLoesen).toHaveBeenCalledWith(expect.anything(), 'z1')
    expect(res.statusCode).toBe(204)
  })

  it('team nennt die Mitglieder', async () => {
    const { res } = await ausfuehren(C.team, req())
    expect(res.body).toEqual({ mitglieder: [{ id: String(anna), name: 'Anna Autor' }] })
  })

  it('zugewiesen liefert eigene Zuweisungen mit Quelle und Namen', async () => {
    const q = quelle()
    m.Quellen.vonIds.mockResolvedValue([q])
    m.Zitate.zugewiesenAn.mockResolvedValue([{ _id: 'z1', quelleId: q._id, seite: 3, label: '347', text: 'Satz', angelegtVon: anna, zugewiesen: { an: anna, von: 'ben', am: new Date(0) } }])
    const { res } = await ausfuehren(C.zugewiesen, req())
    expect(m.Zitate.zugewiesenAn).toHaveBeenCalledWith(projekt, anna)
    expect(m.Quellen.vonIds).toHaveBeenCalledWith(projekt, [q._id])
    expect(res.body.zitate).toHaveLength(1)
    expect(res.body.zitate[0]).toMatchObject({ id: 'z1', text: 'Satz', zugewiesen: { von: { name: 'Ben' } }, quelle: { id: q._id, dateiname: 'a.pdf' } })
  })

  it('zitatMarkieren legt die Fundstelle an und antwortet mit 201', async () => {
    m.Zitate.markieren.mockResolvedValue({ _id: 'z1', seite: 3, label: null, text: 'Satz' })
    const { res } = await ausfuehren(C.zitatMarkieren, mitQuelle({ body: { seite: '3', text: 'Satz' } }))
    expect(m.Zitate.markieren).toHaveBeenCalledWith(expect.anything(), { seite: 3, text: 'Satz' }, anna)
    expect(res.statusCode).toBe(201)
  })

  it('zitatEinfuegen liefert den LaTeX-Befehl', async () => {
    m.Zitate.holen.mockResolvedValue({ _id: 'z1' })
    m.Zitate.einfuegen.mockResolvedValue({ latex: '\\enquote{x}', key: 'a', paket: 'biblatex' })
    const { res } = await ausfuehren(C.zitatEinfuegen, mitQuelle())
    expect(m.Zitate.einfuegen).toHaveBeenCalledWith(projekt, expect.anything(), { _id: 'z1' }, anna)
    expect(res.body.paket).toBe('biblatex')
  })

  it('pruefbericht gibt den Bericht weiter', async () => {
    m.Pruef.bericht.mockResolvedValue({ zeilen: [1] })
    expect((await ausfuehren(C.pruefbericht, req())).res.body).toEqual({ zeilen: [1] })
  })

  it('Problem-Fehler der Manager werden zu Problem-Antworten', async () => {
    m.Quellen.holen.mockRejectedValue(new Problem(404, 'quelle_fehlt', 'weg'))
    const { res, next } = await ausfuehren(C.zitate, mitQuelle())
    expect(res.statusCode).toBe(404)
    expect(next).not.toHaveBeenCalled()
  })

  it('unerwartete Fehler gehen an Express', async () => {
    m.Quellen.holen.mockRejectedValue(new Error('Mongo weg'))
    const { next } = await ausfuehren(C.zitate, mitQuelle())
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ message: 'Mongo weg' }))
  })
})

describe('Claude-Zugang und Läufe', () => {
  it('Tokens: auflisten, erzeugen (201), widerrufen (204)', async () => {
    m.Zugang.tokens.mockResolvedValue([{ id: 't1' }])
    expect((await ausfuehren(C.claudeTokens, req())).res.body).toEqual({ tokens: [{ id: 't1' }] })
    expect(m.Zugang.tokens).toHaveBeenCalledWith(String(anna))
    const erzeugt = await ausfuehren(C.claudeTokenErzeugen, req())
    expect(erzeugt.res.statusCode).toBe(201)
    expect(erzeugt.res.body.token).toBe('spur_x')
    const weg = await ausfuehren(C.claudeTokenWiderrufen, req({ params: { token_id: 't1' } }))
    expect(m.Zugang.widerrufen).toHaveBeenCalledWith(String(anna), 't1')
    expect(weg.res.statusCode).toBe(204)
  })

  it('claudeStatus zeigt Verlauf (älteste zuerst), Verbindung, Automatik und Lauf', async () => {
    m.Inbox.verlauf.mockResolvedValue([{ _id: 'n2', von: 'claude', text: 'zwei', am: 2 }, { _id: 'n1', von: 'mensch', text: 'eins', am: 1 }])
    m.Aktionen.automatik.mockResolvedValue(true)
    m.Aktionen.laufDaten.mockResolvedValue({ lauf: { id: 'l1' }, aenderungen: [] })
    const { res } = await ausfuehren(C.claudeStatus, req())
    expect(m.Inbox.verlauf).toHaveBeenCalledWith(projekt, 'bot1')
    expect(res.body).toEqual({
      verbunden: true,
      nachrichten: [{ id: 'n1', von: 'mensch', text: 'eins', am: 1 }, { id: 'n2', von: 'claude', text: 'zwei', am: 2 }],
      automatik: true,
      lauf: { id: 'l1' },
      aenderungen: [],
    })
  })

  it('claudeAuftrag legt den getrimmten Auftrag für den Bot an', async () => {
    const { res } = await ausfuehren(C.claudeAuftrag, req({ body: { text: '  Glätte Kapitel 2  ' } }))
    expect(m.Inbox.auftragAnlegen).toHaveBeenCalledWith({ projectId: projekt, botId: 'bot1', text: 'Glätte Kapitel 2' })
    expect(res.statusCode).toBe(201)
    expect(res.body).toEqual({ id: 'n1' })
  })

  it.each([['leer', ''], ['nur Leerraum', '   '], ['zu lang', 'a'.repeat(20001)], ['kein Text', 42], ['fehlend', undefined]])(
    'claudeAuftrag weist einen Auftrag ab, der %s ist',
    async (_name, text) => {
      const { res } = await ausfuehren(C.claudeAuftrag, req({ body: { text } }))
      expect(res.statusCode).toBe(422)
      expect(m.Inbox.auftragAnlegen).not.toHaveBeenCalled()
    }
  )

  const lauf = body => req({ params: { project_id: String(projekt), lauf_id: 'l1' }, body })

  it('laufAnnehmen nimmt alle oder die gewählten Changes an', async () => {
    await ausfuehren(C.laufAnnehmen, lauf({}))
    expect(m.Aktionen.annehmen).toHaveBeenCalledWith(projekt, { _id: 'l1' }, anna, undefined)
    await ausfuehren(C.laufAnnehmen, lauf({ change_ids: ['a', 'b'] }))
    expect(m.Aktionen.annehmen).toHaveBeenLastCalledWith(projekt, { _id: 'l1' }, anna, ['a', 'b'])
  })

  it.each([['kein Array', 'a'], ['Zahlen', [1, 2]]])('laufAnnehmen weist change_ids ab, die %s sind', async (_name, ids) => {
    const { res } = await ausfuehren(C.laufAnnehmen, lauf({ change_ids: ids }))
    expect(res.statusCode).toBe(422)
    expect(m.Aktionen.annehmen).not.toHaveBeenCalled()
  })

  it('laufAblehnen beschränkt Prüfende auf die Changes des eigenen Bots', async () => {
    m.stufe = 'review'
    await ausfuehren(C.laufAblehnen, lauf({}))
    expect(m.Aktionen.laufHolen).toHaveBeenCalledWith(projekt, 'l1', 'bot1')
  })

  it('laufAblehnen lässt Schreibende alle Läufe ablehnen', async () => {
    m.stufe = 'readAndWrite'
    const { res } = await ausfuehren(C.laufAblehnen, lauf({ change_ids: ['a'] }))
    expect(m.Aktionen.laufHolen).toHaveBeenCalledWith(projekt, 'l1', undefined)
    expect(m.Aktionen.ablehnen).toHaveBeenCalledWith(projekt, { _id: 'l1' }, anna, ['a'])
    expect(res.body).toEqual({ abgelehnt: 1, rest: 0 })
  })

  it('laufZuruecknehmen antwortet mit 204', async () => {
    const { res } = await ausfuehren(C.laufZuruecknehmen, lauf({}))
    expect(m.Aktionen.zuruecknehmen).toHaveBeenCalledWith(projekt, { _id: 'l1' }, anna)
    expect(res.statusCode).toBe(204)
  })

  it('automatikSetzen verlangt einen Wahrheitswert', async () => {
    expect((await ausfuehren(C.automatikSetzen, req({ body: { an: 'ja' } }))).res.statusCode).toBe(422)
    const { res } = await ausfuehren(C.automatikSetzen, req({ body: { an: true } }))
    expect(m.Aktionen.automatikSetzen).toHaveBeenCalledWith(projekt, anna, true)
    expect(res.statusCode).toBe(204)
  })
})
