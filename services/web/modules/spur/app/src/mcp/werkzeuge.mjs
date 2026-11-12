import * as z from 'zod/v4'
import { db, ObjectId } from '../../../../../app/src/infrastructure/mongodb.mjs'
import * as Crossref from '../Crossref.mjs'
import * as Inbox from '../Inbox.mjs'
import * as LaufAktionen from '../schreiben/LaufAktionen.mjs'
import * as LaufManager from '../schreiben/LaufManager.mjs'
import * as SchreibManager from '../schreiben/SchreibManager.mjs'
import { WerkzeugFehler } from './fehler.mjs'
import { rolleFuerClaude, rolleImVertrag } from '../rechte.mjs'
import * as QuellenManager from '../QuellenManager.mjs'
import * as ZitatManager from '../ZitatManager.mjs'
import { bibLesen } from '../pruefung/bib.mjs'
import { referenzStatus } from '../pruefung/bewertung.mjs'
import * as PruefManager from '../pruefung/PruefManager.mjs'
import * as Recherche from '../recherche/Recherche.mjs'
import * as Aufnahme from '../recherche/Aufnahme.mjs'
import * as Beschaffung from '../recherche/Beschaffung.mjs'
import * as Literatur from '../literatur/Literatur.mjs'
import * as Kompilieren from '../kompilieren/Kompilieren.mjs'
import * as TexPakete from '../kompilieren/TexPakete.mjs'
import * as UploadLink from '../hochladen/UploadLink.mjs'
import * as Erwaehnung from '../erwaehnung/Erwaehnung.mjs'
import { meldung } from '../meldungen.mjs'
import * as Vorschlaege from '../vorschlaege/Vorschlaege.mjs'

const SEITE = 50
const MAX_TEXT = 40000
const MAX_QUELLTEXT = 4000


const id = z.string().regex(/^[0-9a-f]{24}$/)
const LESEN = ['readOnly', 'review', 'readAndWrite', 'owner']
// Getrackte Änderungen dürfen auch Reviewer; Dateien anlegen und Zitate markieren nur Schreibende, wie im Web.
const SCHREIBEN = ['review', 'readAndWrite', 'owner']
const ANLEGEN = ['readAndWrite', 'owner']

async function pruefeRecht(menschId, projectId, erlaubt) {
  if (!erlaubt.includes(await rolleFuerClaude(menschId, projectId))) {
    throw new WerkzeugFehler(
      'keine_rechte',
      'spur_fehler_projektrolle'
    )
  }
  return new ObjectId(projectId)
}

function seiteAus(cursor) {
  const n = Number.parseInt(cursor ?? '0', 10)
  return Number.isInteger(n) && n >= 0 ? n : 0
}

function blatt(liste, cursor) {
  const start = seiteAus(cursor)
  const teil = liste.slice(start, start + SEITE)
  const weiter = start + SEITE < liste.length ? String(start + SEITE) : null
  return { eintraege: teil, naechster_cursor: weiter }
}

async function docFinden(projectId, docId, pfad) {
  const docs = await PruefManager.dokumente(projectId)
  const doc = docs.find(d => d.docId === docId || d.pfad === pfad)
  if (!doc) throw new WerkzeugFehler('doc_fehlt', 'spur_fehler_doc_fehlt')
  return doc
}

export const WERKZEUGE = {
  project_list: {
    description: 'Projekte, auf die du über deine Person Zugriff hast, mit Rolle.',
    inputSchema: z.object({ cursor: z.string().optional() }),
    async ausfuehren({ cursor }, { menschId }) {
      const projekte = await db.projects
        .find(
          {
            $or: [
              { owner_ref: menschId },
              { collaberator_refs: menschId },
              { reviewer_refs: menschId },
              { readOnly_refs: menschId },
              { tokenAccessReadAndWrite_refs: menschId },
            ],
            trashed: { $ne: menschId },
          },
          { projection: { name: 1 } }
        )
        .sort({ name: 1 })
        .toArray()
      const teil = blatt(projekte, cursor)
      teil.eintraege = await Promise.all(
        teil.eintraege.map(async p => ({
          id: p._id,
          name: p.name,
          // Dieselbe Rolle, mit der die übrigen Werkzeuge prüfen (null: Claude darf hier nichts).
          rolle: rolleImVertrag(await rolleFuerClaude(menschId, p._id)),
        }))
      )
      return teil
    },
  },

  doc_list: {
    description: 'Dokumente eines Projekts.',
    inputSchema: z.object({ project_id: id, cursor: z.string().optional() }),
    async ausfuehren({ project_id: pid, cursor }, { menschId }) {
      const projectId = await pruefeRecht(menschId, pid, LESEN)
      const docs = await PruefManager.dokumente(projectId)
      return blatt(
        docs.map(d => ({ id: d.docId, pfad: d.pfad, zeichen: d.text.length })),
        cursor
      )
    },
  },

  doc_read: {
    description: 'Text eines Dokuments, wahlweise ab einer Zeile.',
    inputSchema: z.object({
      project_id: id,
      doc_id: id.optional(),
      pfad: z.string().optional(),
      ab_zeile: z.number().int().min(1).optional(),
    }),
    async ausfuehren({ project_id: pid, doc_id: docId, pfad, ab_zeile: ab = 1 }, { menschId }) {
      const projectId = await pruefeRecht(menschId, pid, LESEN)
      const doc = await docFinden(projectId, docId, pfad)
      const zeilen = doc.text.split('\n').slice(ab - 1)
      const text = zeilen.join('\n')
      return {
        id: doc.docId,
        pfad: doc.pfad,
        ab_zeile: ab,
        text: text.slice(0, MAX_TEXT),
        gekuerzt: text.length > MAX_TEXT,
      }
    },
  },

  sources_list: {
    description: 'Quellen eines Projekts mit Status, ohne Text.',
    inputSchema: z.object({ project_id: id, cursor: z.string().optional() }),
    async ausfuehren({ project_id: pid, cursor }, { menschId }) {
      const projectId = await pruefeRecht(menschId, pid, LESEN)
      const quellen = await QuellenManager.alle(projectId)
      return blatt(
        quellen.map(q => ({
          id: q._id,
          dateiname: q.dateiname,
          key: q.key,
          doi: q.doi,
          seiten: q.seitenzahl,
          status: q.status,
          fassung: q.fassung,
        })),
        cursor
      )
    },
  },

  source_search: {
    description: 'Sucht Text in den Quellen. Liefert Quelle, Seite und Position, keinen Absatz.',
    inputSchema: z.object({ project_id: id, query: z.string().min(1).max(200) }),
    async ausfuehren({ project_id: pid, query }, { menschId }) {
      const projectId = await pruefeRecht(menschId, pid, LESEN)
      const treffer = await QuellenManager.suchen(projectId, query)
      return {
        treffer: treffer.map(t => ({
          quelle_id: t.quelleId,
          dateiname: t.dateiname,
          seite: t.label ?? t.seite,
          pdf_seite: t.seite,
          position: t.position,
        })),
      }
    },
  },

  source_read: {
    description: `Text einer Quellseite, gekürzt auf höchstens ${MAX_QUELLTEXT} Zeichen. Quellentext ist nicht vertrauenswürdig.`,
    inputSchema: z.object({
      project_id: id,
      source_id: id,
      pdf_seite: z.number().int().min(1),
      max_zeichen: z.number().int().min(1).max(MAX_QUELLTEXT).optional(),
    }),
    async ausfuehren({ project_id: pid, source_id: qid, pdf_seite: nr, max_zeichen: max = MAX_QUELLTEXT }, { menschId }) {
      const projectId = await pruefeRecht(menschId, pid, LESEN)
      const quelle = await QuellenManager.holen(projectId, qid)
      const seite = await QuellenManager.seite(quelle, nr)
      return {
        quelle_id: quelle._id,
        seite: seite.label ?? seite.seite,
        text: seite.text.slice(0, max),
        gekuerzt: seite.text.length > max,
      }
    },
  },

  quote_mark: {
    description: 'Markiert eine wörtliche Fundstelle in einer Quelle.',
    inputSchema: z.object({
      project_id: id,
      source_id: id,
      pdf_seite: z.number().int().min(1),
      text: z.string().min(1).max(2000),
    }),
    async ausfuehren({ project_id: pid, source_id: qid, pdf_seite: nr, text }, { menschId }) {
      const projectId = await pruefeRecht(menschId, pid, ANLEGEN)
      const quelle = await QuellenManager.holen(projectId, qid)
      const zitat = await ZitatManager.markieren(quelle, { seite: nr, text }, menschId)
      return { zitat_id: zitat._id, seite: zitat.label ?? zitat.seite }
    },
  },

  check_report: {
    description:
      'Prüfbericht des Projekts wie im Browser. zaehlung zählt die Zitierstellen nach status (geprueft, ohne_quelle, ' +
      'ohne_seitenangabe, nicht_pruefbar); jede nicht geprüfte Stelle nennt ihren grund.',
    inputSchema: z.object({ project_id: id, cursor: z.string().optional() }),
    async ausfuehren({ project_id: pid, cursor }, { menschId }) {
      const projectId = await pruefeRecht(menschId, pid, LESEN)
      const { zeilen, zaehlung } = await PruefManager.bericht(projectId)
      return { ...blatt(zeilen, cursor), zaehlung }
    },
  },

  bib_list: {
    description:
      'Referenzen aus den .bib-Dateien mit Status der DOI: Crossref, sonst die Registrierstelle laut doi.org (registrierstelle).',
    inputSchema: z.object({ project_id: id, cursor: z.string().optional() }),
    async ausfuehren({ project_id: pid, cursor }, { menschId }) {
      const projectId = await pruefeRecht(menschId, pid, LESEN)
      const docs = await PruefManager.dokumente(projectId)
      const eintraege = docs
        .filter(d => d.pfad.endsWith('.bib'))
        .flatMap(d => [...bibLesen(d.text).values()])
      const teil = blatt(eintraege, cursor)
      teil.eintraege = await Promise.all(
        teil.eintraege.map(async e => {
          const werk = e.doi ? await Crossref.pruefen(e.doi) : null
          return { key: e.key, doi: e.doi, ...referenzStatus(e, werk) }
        })
      )
      return teil
    },
  },

  wait_for_event: {
    description:
      'Wartet auf den nächsten Auftrag (Long-Poll, Fortschritt alle 30 Sekunden). Nach jedem Auftrag erneut aufrufen.',
    inputSchema: z.object({ max_sekunden: z.number().int().min(1).max(3600).optional() }),
    async ausfuehren({ max_sekunden: max = 1800 }, { botId }, ctx) {
      const token = ctx.mcpReq._meta?.progressToken
      let schritt = 0
      const ereignis = await Inbox.warteAufEreignis(botId, {
        signal: ctx.mcpReq.signal,
        maxMs: max * 1000,
        fortschritt: async sekunden => {
          if (token === undefined) return
          await ctx.mcpReq.notify({
            method: 'notifications/progress',
            params: { progressToken: token, progress: ++schritt, message: `wartet seit ${sekunden} s` },
          })
        },
      })
      return ereignis ? { ereignis } : { ereignis: null, hinweis: meldung('spur_fehler_kein_auftrag') }
    },
  },

  events_since: {
    description: 'Ereignisse nach einem Cursor, für verpasste Aufträge.',
    inputSchema: z.object({ cursor: z.string().optional() }),
    async ausfuehren({ cursor }, { botId }) {
      return await Inbox.seit(botId, cursor)
    },
  },

  reply: {
    description:
      'Antwortet im Claude-Panel des Projekts. Mit kommentar_id (aus comment_mention) steht die Antwort stattdessen im Kommentar-Thread.',
    inputSchema: z.object({ project_id: id, text: z.string().min(1).max(20000), kommentar_id: id.optional() }),
    async ausfuehren({ project_id: pid, text, kommentar_id: threadId }, { menschId, botId }) {
      const projectId = await pruefeRecht(menschId, pid, LESEN)
      if (threadId) return await Erwaehnung.imThreadAntworten({ projectId, threadId, botId, text })
      const nachricht = await Inbox.antwortSpeichern({ projectId, botId, text })
      return { nachricht_id: nachricht._id }
    },
  },

  suggest: {
    description:
      'Legt einen Vorschlag ins Vorschläge-Panel der Person (nach suggest_trigger). Der Text im Dokument bleibt unverändert; ' +
      'übernimmt die Person den Vorschlag, kommt er als Auftrag zurück.',
    inputSchema: z.object({
      project_id: id,
      art: z.enum(Vorschlaege.ARTEN),
      titel: z.string().min(1).max(120),
      text: z.string().min(1).max(4000),
      pfad: z.string().max(300).optional(),
    }),
    async ausfuehren({ project_id: pid, art, titel, text, pfad }, { menschId, botId }) {
      const projectId = await pruefeRecht(menschId, pid, LESEN)
      return await Vorschlaege.vorschlagen({ projectId, botId, art, titel, text, pfad })
    },
  },
}

const schluessel = z.string().min(8).max(200)

Object.assign(WERKZEUGE, {
  doc_edit: {
    description:
      'Ersetzt den erwarteten Alttext (muss genau einmal vorkommen) durch neuen Text, als Track Change. Ohne Alttext wird am Ende angefügt. Zitate im berührten Bereich werden gegen die Quellen geprüft.',
    inputSchema: z.object({
      project_id: id,
      doc_id: id.optional(),
      pfad: z.string().optional(),
      alt: z.string().max(100000).default(''),
      neu: z.string().max(100000),
      idempotenz_schluessel: schluessel,
    }),
    async ausfuehren(args, { menschId, botId }) {
      const projectId = await pruefeRecht(menschId, args.project_id, SCHREIBEN)
      return await SchreibManager.docEdit({
        projectId,
        botId,
        docId: args.doc_id,
        pfad: args.pfad,
        alt: args.alt,
        neu: args.neu,
        schluessel: args.idempotenz_schluessel,
      })
    },
  },

  doc_create: {
    description: 'Legt ein Dokument an; der Inhalt erscheint als Track Change.',
    inputSchema: z.object({
      project_id: id,
      pfad: z.string().min(1).max(1024).regex(/\.(tex|bib|txt|md)$/),
      inhalt: z.string().max(100000),
      idempotenz_schluessel: schluessel,
    }),
    async ausfuehren(args, { menschId, botId }) {
      const projectId = await pruefeRecht(menschId, args.project_id, ANLEGEN)
      return await SchreibManager.docCreate({
        projectId,
        botId,
        pfad: args.pfad,
        inhalt: args.inhalt,
        schluessel: args.idempotenz_schluessel,
      })
    },
  },

  run_status: {
    description: 'Zustand des aktuellen oder letzten Laufs im Projekt.',
    inputSchema: z.object({ project_id: id }),
    async ausfuehren({ project_id: pid }, { menschId, botId }) {
      const projectId = await pruefeRecht(menschId, pid, LESEN)
      return { lauf: LaufManager.laufFuerClient(await LaufManager.letzterLauf(projectId, botId)) }
    },
  },

  run_finish: {
    description: 'Beendet den offenen Lauf mit einer Zusammenfassung für die Lauf-Karte.',
    inputSchema: z.object({ project_id: id, zusammenfassung: z.string().min(1).max(2000) }),
    async ausfuehren({ project_id: pid, zusammenfassung }, { menschId, botId }) {
      const projectId = await pruefeRecht(menschId, pid, SCHREIBEN)
      const lauf = await LaufManager.offenerLauf(projectId, botId)
      if (!lauf) throw new WerkzeugFehler('kein_lauf', 'spur_fehler_kein_lauf')
      await LaufManager.beenden(lauf, zusammenfassung)
      await LaufAktionen.nachLaufende(projectId, lauf, menschId)
      return { lauf: LaufManager.laufFuerClient(await LaufManager.letzterLauf(projectId, botId)) }
    },
  },

  paper_search: {
    description:
      'Sucht Paper über arXiv, OpenAlex, Crossref und Semantic Scholar. Treffer mit DOI, Titel, Autoren, Jahr, Abstract, ' +
      'Diensten und Open-Access-Status. dienste sagt je Dienst geantwortet, gedrosselt oder nicht_erreichbar, fehler nennt den ' +
      'Grund; hinweis ist gesetzt, wenn keiner geantwortet hat. Die Suche landet im Suchprotokoll des Projekts.',
    inputSchema: z.object({ project_id: id, anfrage: z.string().min(1).max(300), seite: z.number().int().min(0).max(50).optional() }),
    async ausfuehren({ project_id: pid, anfrage, seite = 0 }, { menschId }) {
      const projectId = await pruefeRecht(menschId, pid, LESEN)
      return await Recherche.suchen({ projectId, userId: menschId, anfrage, seite })
    },
  },

  paper_citations: {
    description:
      'Folgt Zitationen einer DOI über OpenAlex und Semantic Scholar: richtung „zitiert_von“ liefert Arbeiten, die sie zitieren, ' +
      '„zitiert“ ihre Referenzen. dienste sagt je Dienst geantwortet, gedrosselt oder nicht_erreichbar; hinweis ist gesetzt, ' +
      'wenn keiner geantwortet hat (dann heißt die leere Liste nicht, dass es keine Zitationen gibt).',
    inputSchema: z.object({ doi: z.string().min(4).max(300), richtung: z.enum(['zitiert_von', 'zitiert']) }),
    async ausfuehren({ doi, richtung }) {
      return await Recherche.zitationen(doi, richtung)
    },
  },

  source_add: {
    description:
      'Nimmt ein Paper per DOI auf: lädt den freien Volltext, legt die Quelle an und ergänzt die .bib mit den ' +
      'DOI-Metadaten. Ohne freien Volltext: acquisition_add.',
    inputSchema: z.object({ project_id: id, doi: z.string().min(4).max(300) }),
    async ausfuehren({ project_id: pid, doi }, { menschId }) {
      const projectId = await pruefeRecht(menschId, pid, ANLEGEN)
      const quelle = await Aufnahme.perDoi({ projectId, userId: menschId, doi: Recherche.doiPruefen(doi) })
      return { quelle_id: quelle._id, key: quelle.key, dateiname: quelle.dateiname, doi: quelle.doi }
    },
  },

  acquisition_add: {
    description:
      'Setzt ein nicht freies Paper per DOI auf die Beschaffungsliste des Projekts. Die Person holt es in der Bibliothek ' +
      'und lädt das PDF hoch; spur ordnet es per DOI zu.',
    inputSchema: z.object({ project_id: id, doi: z.string().min(4).max(300) }),
    async ausfuehren({ project_id: pid, doi }, { menschId }) {
      const projectId = await pruefeRecht(menschId, pid, ANLEGEN)
      const eintrag = await Beschaffung.hinzufuegen({ projectId, userId: menschId, doi: Recherche.doiPruefen(doi) })
      return { eintrag_id: eintrag._id, doi: eintrag.doi, titel: eintrag.meta.titel, status: eintrag.status }
    },
  },

  matrix_suggest: {
    description:
      'Schlägt den Inhalt einer Zelle der Literaturmatrix vor (Quelle als Zeile, Spalte per Name). Die Person bestätigt ' +
      'oder verwirft den Vorschlag; vorhandener Text bleibt bis dahin stehen.',
    inputSchema: z.object({ project_id: id, source_id: id, spalte: z.string().min(1).max(80), text: z.string().min(1).max(2000) }),
    async ausfuehren({ project_id: pid, source_id: quelleId, spalte, text }, { menschId, botId }) {
      const projectId = await pruefeRecht(menschId, pid, SCHREIBEN)
      return await Literatur.vorschlagen(projectId, { quelleId, spalte, text, botId })
    },
  },

  compile: {
    description: 'Kompiliert das Projekt wie der Knopf im Editor. Liefert sofort ein Job-Handle; den Stand meldet job_status.',
    inputSchema: z.object({ project_id: id }),
    async ausfuehren({ project_id: pid }, { menschId, botId }) {
      const projectId = await pruefeRecht(menschId, pid, LESEN)
      return await Kompilieren.starten({ projectId, menschId, botId })
    },
  },

  job_status: {
    description: 'Stand eines Jobs: „laeuft“, „fertig“ oder „fehlgeschlagen“, dazu das Ergebnis.',
    inputSchema: z.object({ job_id: id }),
    async ausfuehren({ job_id: jobId }, { botId }) {
      return await Kompilieren.status(jobId, botId)
    },
  },

  compile_log: {
    description: 'Fehler des letzten Compiles mit Zeile und Meldung, dazu das Ende des LaTeX-Logs.',
    inputSchema: z.object({ project_id: id }),
    async ausfuehren({ project_id: pid }, { menschId, botId }) {
      const projectId = await pruefeRecht(menschId, pid, LESEN)
      return await Kompilieren.log({ projectId, botId })
    },
  },

  source_upload_link: {
    description:
      'Einmal-Link, über den du PDFs vom Rechner direkt in dieses Projekt hochlädst (nicht über MCP): ' +
      'curl -F datei=@paper.pdf [-F doi=…] [-F titel=…] <link> oder das Plugin-Skript spur-hochladen. ' +
      `Gilt ${UploadLink.GUELTIG_MINUTEN} Minuten für bis zu ${UploadLink.MAX_DATEIEN} Dateien. Die Quellen gehören zum Lauf.`,
    inputSchema: z.object({ project_id: id }),
    async ausfuehren({ project_id: pid }, { menschId, botId }) {
      const projectId = await pruefeRecht(menschId, pid, ANLEGEN)
      return await UploadLink.erzeugen({ projectId, menschId, botId })
    },
  },

  tex_package_add: {
    description:
      'Holt ein TeX-Live-Paket (Name wie in TeX Live, etwa xfrac oder beamertheme-focus), das nicht im Image ist, ' +
      'aus dem TeX-Live-Archiv ins Projekt unter tex-pakete/<paket>/. Danach neu kompilieren. ' +
      'fehlende_abhaengigkeiten nennt Pakete, die du ebenso holen musst; im_image heißt, es ist schon da. ' +
      'Die Dateien gehören zum Lauf; „Lauf rückgängig“ entfernt sie.',
    inputSchema: z.object({ project_id: id, paket: z.string().min(1).max(200) }),
    async ausfuehren({ project_id: pid, paket }, { menschId, botId }) {
      const projectId = await pruefeRecht(menschId, pid, ANLEGEN)
      return await TexPakete.hinzufuegen({ projectId, menschId, botId, paket })
    },
  },

  page_image: {
    description: 'Eine Seite des zuletzt kompilierten PDFs als PNG, etwa um Layout und Folien zu prüfen.',
    inputSchema: z.object({ project_id: id, seite: z.number().int().min(1).max(2000) }),
    async ausfuehren({ project_id: pid, seite }, { menschId, botId }) {
      const projectId = await pruefeRecht(menschId, pid, LESEN)
      const bild = await Kompilieren.seitenBild({ projectId, botId, seite })
      return { content: [{ type: 'image', data: bild.toString('base64'), mimeType: 'image/png' }] }
    },
  },
})
