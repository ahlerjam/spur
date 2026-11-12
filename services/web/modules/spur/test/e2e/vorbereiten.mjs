// Legt Testkonten und Testprojekte an und setzt deren Quellen zurück.
// Aufruf: spur-dev run modules/spur/test/e2e/vorbereiten.mjs
import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import logger from '@overleaf/logger'
import { db } from '../../../../app/src/infrastructure/mongodb.mjs'
import UserRegistrationHandler from '../../../../app/src/Features/User/UserRegistrationHandler.mjs'
import ProjectDeleter from '../../../../app/src/Features/Project/ProjectDeleter.mjs'
import ProjectEntityHandler from '../../../../app/src/Features/Project/ProjectEntityHandler.mjs'
import DocumentUpdaterHandler from '../../../../app/src/Features/DocumentUpdater/DocumentUpdaterHandler.mjs'
import Settings from '@overleaf/settings'
import { fetchNothing } from '@overleaf/fetch-utils'
import { projektAnlegen } from '../../scripts/lib/projekt-anlegen.mjs'
import { ablageFreigeben, demoAnlegen, quelleAusFixture } from '../../scripts/seed.mjs'
import { projektAufraeumen } from '../../app/src/QuellenManager.mjs'
import * as TexPakete from '../../app/src/kompilieren/TexPakete.mjs'
import { grenzen, speicher as speicherSammlung } from '../../app/src/sammlungen.mjs'
import {
  ereignisse,
  herzschlaege,
  einstellungen,
  nachrichten,
  quellen,
  quellenSeiten,
  drossel,
  paperCache,
  suchprotokoll,
  vorschlaege,
  workflows,
} from '../../app/src/sammlungen.mjs'
import { createHash } from 'node:crypto'
import { botFuer, kontoAufraeumen, SCOPE } from '../../app/src/ClaudeZugang.mjs'
import UserDeleter from '../../../../app/src/Features/User/UserDeleter.mjs'

const PASSWORT = 'spur-e2e-Passwort-1'

const APA = String.raw`\documentclass{article}
\usepackage[style=apa,backend=biber]{biblatex}
\usepackage{csquotes}
\addbibresource{references.bib}
\begin{document}
\enquote{Hello} \autocite{e2e}
\printbibliography
\end{document}`

const NATBIB = String.raw`\documentclass{article}
\usepackage{natbib}
\begin{document}
Hello \citep{e2e}
\bibliographystyle{plainnat}
\bibliography{references}
\end{document}`

const BIB = `@article{e2e,
  author = {Smith, Alice},
  title = {Sleep and Memory},
  journal = {Journal of Sleep Research},
  year = {2024}
}`

const LEER = String.raw`\documentclass{article}
\begin{document}
Hello
\end{document}`

async function konto(email) {
  const vorhanden = await db.users.findOne({ email })
  if (vorhanden) return vorhanden
  return await UserRegistrationHandler.promises.registerNewUser({
    email,
    password: PASSWORT,
    analyticsId: randomUUID(),
  })
}

async function neuAnlegen(owner, name, dateien) {
  for (const alt of await db.projects.find({ owner_ref: owner._id, name }).toArray()) {
    await ProjectDeleter.promises.deleteProject(alt._id)
    await ProjectDeleter.promises.expireDeletedProject(alt._id)
  }
  return await projektAnlegen(owner._id, name, dateien)
}

// 1990 einzelne Einfügungen von hinten nach vorn, damit die Positionen gültig bleiben.
async function volleAenderungen(projectId, bot) {
  const docs = await ProjectEntityHandler.promises.getAllDocs(projectId)
  const docId = String(docs['/voll.tex']._id)
  const { version } = await DocumentUpdaterHandler.promises.getDocument(projectId, docId, -1)
  const op = Array.from({ length: 1990 }, (_, i) => ({ p: (1989 - i) * 2 + 1, i: 'x' }))
  await fetchNothing(
    `${Settings.apis.documentupdater.url}/project/${projectId}/doc/${docId}/spur-update`,
    {
      method: 'POST',
      json: { op, v: version, meta: { user_id: String(bot._id), tc: 'e2e000000000000001', source: 'spur' } },
    }
  )
}

async function projekt(owner, name, dateien) {
  const vorhanden = await db.projects.findOne({ owner_ref: owner._id, name })
  return vorhanden ?? (await projektAnlegen(owner._id, name, dateien))
}

async function vieleQuellen(projectId, ownerId) {
  const anzahl = 300
  const eintraege = Array.from({ length: anzahl }, (_, i) => ({
    projectId,
    dateiname: `quelle-${String(i).padStart(3, '0')}.pdf`,
    key: `quelle-${i}`,
    art: 'pdf',
    groesse: 1000,
    seitenzahl: 2,
    status: 'text',
    doi: null,
    meta: null,
    versatz: null,
    versatzQuelle: null,
    fassung: '',
    angelegtVon: ownerId,
    angelegtAm: new Date(),
  }))
  const { insertedIds } = await (await quellen()).insertMany(eintraege)
  await (await quellenSeiten()).insertMany(
    Object.values(insertedIds).flatMap((quelleId, i) => [
      {
        quelleId,
        projectId,
        seite: 1,
        label: null,
        text: `Studie ${i} prüft Lernen und Schlaf bei Erwachsenen. `.repeat(40),
      },
      {
        quelleId,
        projectId,
        seite: 2,
        label: null,
        text: i === 150 ? 'Die seltene Wortfolge steht nur hier.' : 'Nichts Besonderes.',
      },
    ])
  )
}

const BERICHT_MAIN = String.raw`\documentclass{article}
\usepackage[style=apa,backend=biber]{biblatex}
\usepackage{csquotes}
\addbibresource{references.bib}
\begin{document}
\section{Eins}
\enquote{Sleep supports […] declarative memory.} \autocite[347]{smith2024}
\enquote{Sleep strongly supports the consolidation} \autocite[347]{smith2024}
\enquote{During rest the hippocampus replays recent experience.} \autocite[349]{smith2024}
\enquote{Memory traces are strengthened during slow-wave sleep} \autocite[999]{smith2024}
\section{Zwei}
\enquote{Naps improve every kind of memory equally.} \autocite[2]{retracted}
\parencite{korrigiert}
\parencite{unbekannt}
\footfullcite{smith2024}
\input{kapitel}
\printbibliography
\end{document}`

const BERICHT_KAPITEL = String.raw`\section{Drei}
\textcquote[347]{smith2024}{Sleep supports the consolidation of declarative memory.}`

const BERICHT_BIB = `@article{smith2024,
  title = {Sleep and Memory},
  doi = {10.5555/spur.2024.001}
}
@article{retracted,
  title = {Retracted Findings on Sleep},
  doi = {10.5555/spur.retracted}
}
@article{korrigiert,
  title = {Corrected Findings on Sleep},
  doi = {10.5555/spur.korrigiert}
}
@article{unbekannt,
  title = {Unknown},
  doi = {10.5555/spur.unbekannt}
}`

const SCHREIBEN_MAIN = String.raw`\documentclass{article}
\usepackage[style=apa,backend=biber]{biblatex}
\usepackage{csquotes}
\addbibresource{references.bib}
\begin{document}
\section{Eins}
Erster Absatz.

Zweiter Absatz.
\section{Zwei}
\enquote{Erfunden und falsch.} \autocite[1]{smith2024}
\end{document}`

// Auch die Dev-Route POST /spur/dev/e2e/vorbereiten ruft das auf, damit die Suite sich selbst zurücksetzt.
export async function e2eDatenVorbereiten() {
  // Zuerst: Grenzen eines früheren Laufs würden sonst das Anlegen der Testdaten sperren.
  await (await grenzen()).deleteMany({})
  const a = await konto('e2e-a@example.org')
  const leser = await konto('e2e-leser@example.org')
  const link = await konto('e2e-link@example.org')

  await neuAnlegen(a, 'E2E APA', { 'main.tex': APA, 'references.bib': BIB })
  await neuAnlegen(a, 'E2E natbib', { 'main.tex': NATBIB, 'references.bib': BIB })
  await neuAnlegen(a, 'E2E Ohne Bib', { 'main.tex': APA })

  const leer = await projekt(a, 'E2E Quellen', { 'main.tex': LEER })
  await projektAufraeumen(leer._id)
  await db.projects.updateOne(
    { _id: leer._id },
    {
      $set: {
        publicAccesLevel: 'tokenBased',
        readOnly_refs: [leser._id],
        tokenAccessReadAndWrite_refs: [link._id],
      },
    }
  )

  const viele = await projekt(a, 'E2E Viele', { 'main.tex': LEER })
  await projektAufraeumen(viele._id)
  await vieleQuellen(viele._id, a._id)

  for (const alt of await db.projects.find({ owner_ref: a._id, name: 'Demo' }).toArray()) {
    await ProjectDeleter.promises.deleteProject(alt._id)
    await ProjectDeleter.promises.expireDeletedProject(alt._id)
  }
  const bericht = await neuAnlegen(a, 'E2E Bericht', {
    'main.tex': BERICHT_MAIN,
    'kapitel.tex': BERICHT_KAPITEL,
    'references.bib': BERICHT_BIB,
  })
  await quelleAusFixture(bericht._id, a._id, 'smith2024.pdf')
  await quelleAusFixture(bericht._id, a._id, 'retracted.pdf')

  const schreiben = await neuAnlegen(a, 'E2E Schreiben', {
    'main.tex': SCHREIBEN_MAIN,
    'references.bib': BERICHT_BIB,
    'weg.tex': 'Wird gelöscht.',
    'voll.tex': Array.from({ length: 1991 }, () => 'a').join(' '),
  })
  await quelleAusFixture(schreiben._id, a._id, 'smith2024.pdf')
  await volleAenderungen(schreiben._id, await botFuer(a))

  const pruefer = await konto('e2e-review@example.org')
  const laufProjekt = await neuAnlegen(a, 'E2E Lauf', {
    'main.tex': String.raw`\documentclass{article}
\begin{document}
Alpha Satz.

Beta Satz mit altem Wort.

Gamma Satz.

Delta Satz.
\end{document}`,
    'extra.tex': 'Extra Satz.',
  })
  await db.projects.updateOne(
    { _id: laufProjekt._id },
    { $set: { readOnly_refs: [leser._id], reviewer_refs: [pruefer._id] } }
  )
  await (await einstellungen()).deleteMany({})

  const neuesDemo = await demoAnlegen(a)
  await db.projects.updateOne({ _id: neuesDemo._id }, { $set: { readOnly_refs: [leser._id] } })

  for (const klon of await db.projects.find({ owner_ref: a._id, name: 'E2E Klon' }).toArray()) {
    await ProjectDeleter.promises.deleteProject(klon._id)
    await ProjectDeleter.promises.expireDeletedProject(klon._id)
  }

  await neuAnlegen(link, 'E2E Fremd', { 'main.tex': LEER })

  async function testToken(mensch, token, ablauf) {
    const bot = await botFuer(mensch)
    await db.oauthAccessTokens.deleteMany({ user_id: mensch._id, scope: SCOPE })
    await db.oauthAccessTokens.insertOne({
      accessToken: createHash('sha256').update(token).digest('hex'),
      accessTokenExpiresAt: ablauf,
      scope: SCOPE,
      user_id: mensch._id,
      spurBotId: bot._id,
      createdAt: new Date(ablauf.getTime() - 90 * 24 * 3600 * 1000),
    })
  }

  await testToken(leser, 'spur_e2e_abgelaufen', new Date(Date.now() - 3600 * 1000))
  const altWeg = await db.users.findOne({ email: 'e2e-weg@example.org' })
  if (altWeg) {
    await kontoAufraeumen(altWeg._id)
    await UserDeleter.promises.deleteUser(altWeg._id, {
      force: true,
      skipEmail: true,
      ipAddress: '127.0.0.1',
    })
  }
  await db.deletedUsers.deleteMany({ 'deleterData.deletedUserLastPrimaryEmail': 'e2e-weg@example.org' })
  const weg = await konto('e2e-weg@example.org')
  await testToken(weg, 'spur_e2e_weg', new Date(Date.now() + 24 * 3600 * 1000))

  // Ein Konto ohne Bot und ohne Token: f8 prüft das allererste Token eines neuen Nutzers.
  for (const email of ['e2e-neu@example.org', 'neu-p7@example.org', 'zweit-p7@example.org', 'dritt-p7@example.org']) {
    const alt = await db.users.findOne({ email })
    if (alt) {
      await kontoAufraeumen(alt._id)
      await UserDeleter.promises.deleteUser(alt._id, { force: true, skipEmail: true, ipAddress: '127.0.0.1' })
    }
    await db.deletedUsers.deleteMany({ 'deleterData.deletedUserLastPrimaryEmail': email })
  }
  const neu = await konto('e2e-neu@example.org')
  // Site-Admin: Claude bekommt über ein Admin-Token trotzdem nur Rollen aus Mitgliedschaften.
  const admin = await konto('e2e-admin@example.org')
  await db.users.updateOne({ _id: admin._id }, { $set: { isAdmin: true } })
  await testToken(admin, 'spur_e2e_admin', new Date(Date.now() + 24 * 3600 * 1000))
  await neuAnlegen(neu, 'E2E Neu', { 'main.tex': 'Erster Absatz.\n' })

  // P2: frisches Rechercheprojekt, Paper-Antworten nicht aus dem Cache des letzten Laufs.
  await neuAnlegen(a, 'E2E Recherche', { 'main.tex': LEER })
  await neuAnlegen(a, 'E2E Recherche Ziel', { 'main.tex': LEER })
  await neuAnlegen(a, 'E2E Beschaffung', { 'main.tex': LEER })
  await neuAnlegen(a, 'E2E Import', { 'main.tex': LEER })
  await neuAnlegen(a, 'E2E Literatur', { 'main.tex': LEER })
  await neuAnlegen(a, 'E2E Compile', {
    'main.tex': String.raw`\documentclass{article}
\begin{document}
Erste Seite.
\newpage
Zweite Seite.
\end{document}`,
  })
  await neuAnlegen(a, 'E2E Kaputt', {
    'main.tex': String.raw`\documentclass{article}
\begin{document}
Text davor.
\kaputtesmakro{}
\end{document}`,
  })
  await neuAnlegen(a, 'E2E Folien', { 'main.tex': 'Folien folgen.\n' })
  // P7: Theme aus dem TeX-Live-Fake, das nicht im Image ist.
  await neuAnlegen(a, 'E2E Pakete', {
    'main.tex': String.raw`\documentclass{beamer}
\usetheme{spurtest}
\begin{document}
\begin{frame}{Pakete}Theme aus dem Projekt.\end{frame}
\end{document}
`,
  })
  await TexPakete.begrenzer.delete(String(a._id))
  await neuAnlegen(a, 'E2E Hochladen', { 'main.tex': LEER })
  await neuAnlegen(a, 'E2E Hochladen B', { 'main.tex': LEER })
  await neuAnlegen(a, 'E2E Semantik', {
    'main.tex': String.raw`\documentclass{article}
\usepackage{csquotes}
\begin{document}
\enquote{Sleep supports the consolidation of declarative memory.} \autocite[347]{smith2024}
\end{document}`,
  })
  await neuAnlegen(a, 'E2E Offenlegung', { 'main.tex': 'Alpha.\nOmega.\n' })
  await neuAnlegen(a, 'E2E Zahlen', {
    'main.tex': String.raw`\documentclass{article}
\begin{document}
Platzhalter.
\end{document}`,
  })
  for (const sammlung of [ereignisse, herzschlaege, nachrichten, drossel, paperCache, suchprotokoll]) {
    await (await sammlung()).deleteMany({})
  }
  await testToken(a, 'spur_e2e_fake', new Date(Date.now() + 24 * 3600 * 1000))

  // P4: zwei Menschen mit Namen im selben Projekt, dazu eine Leserin.
  async function mitNamen(email, first_name, last_name) {
    const nutzer = await konto(email)
    await db.users.updateOne({ _id: nutzer._id }, { $set: { first_name, last_name } })
    return await db.users.findOne({ _id: nutzer._id })
  }
  const teamA = await mitNamen('e2e-team-a@example.org', 'Anna', 'Autor')
  const teamB = await mitNamen('e2e-team-b@example.org', 'Ben', 'Berater')
  const team = await neuAnlegen(teamA, 'E2E Team', { 'main.tex': LEER })
  await db.projects.updateOne(
    { _id: team._id },
    { $set: { collaberator_refs: [teamB._id], readOnly_refs: [leser._id] } }
  )
  await quelleAusFixture(team._id, teamA._id, 'smith2024.pdf')

  const scanProjekt = await neuAnlegen(a, 'E2E Scan', { 'main.tex': APA, 'references.bib': BIB })
  await quelleAusFixture(scanProjekt._id, a._id, 'scan.pdf')
  await neuAnlegen(a, 'E2E Web', { 'main.tex': APA, 'references.bib': BIB })
  await neuAnlegen(a, 'E2E Transkript', { 'main.tex': LEER })
  await neuAnlegen(a, 'E2E Leer P5', { 'main.tex': LEER })

  // P3: zwei Menschen mit eigenem Claude in denselben Projekten.
  const p3a = await mitNamen('e2e-p3a@example.org', 'Ada', 'Autorin')
  const p3b = await mitNamen('e2e-p3b@example.org', 'Bo', 'Berater')
  const ABSCHNITTE = String.raw`\documentclass{article}
\begin{document}
\section{Eins}
Erster Abschnitt.
\section{Zwei}
Zweiter Abschnitt über Schlaf und Gedächtnis.
\end{document}`
  await neuAnlegen(p3a, 'E2E Chat', { 'main.tex': ABSCHNITTE })
  for (const name of ['E2E Kommentar', 'E2E Vorschläge']) {
    const p = await neuAnlegen(p3a, name, {
      'main.tex': String.raw`\documentclass{article}
\begin{document}
Schlaf verdoppelt die Gedächtnisleistung.
\kaputtesmakro{}
\end{document}`,
    })
    await db.projects.updateOne({ _id: p._id }, { $set: { collaberator_refs: [p3b._id] } })
  }
  await neuAnlegen(p3a, 'E2E Workflows', { 'main.tex': ABSCHNITTE })
  for (const [mensch, token] of [[p3a, 'spur_e2e_p3a'], [p3b, 'spur_e2e_p3b']]) {
    await testToken(mensch, token, new Date(Date.now() + 24 * 3600 * 1000))
    // Ein Bot aus einem früheren Lauf trägt sonst noch den Namen von vor mitNamen.
    await db.users.updateOne({ 'spur.botFuer': mensch._id }, { $set: { last_name: `(${mensch.first_name})` } })
  }
  for (const sammlung of [vorschlaege, workflows]) {
    await (await sammlung()).deleteMany({})
  }

  // P6: @claude in einem offenen und in einem zuvor nie geladenen Dokument.
  await neuAnlegen(a, 'E2E P6 Kommentar', {
    'main.tex': String.raw`\documentclass{article}
\begin{document}
Ergebnisse.
\end{document}`,
    'kapitel.tex': 'Im Kapitel steht die Ausbeute von 81,2 Prozent.\n',
  })
  // P6: eine DOI, die der Crossref-Fake drosselt oder abschaltet, und eine erfundene.
  await neuAnlegen(a, 'E2E P6 Crossref', {
    'main.tex': String.raw`\documentclass{article}
\begin{document}
Lebensmittelabfälle \cite{foods2022}. Eine erfundene Quelle \cite{erfunden}.
\end{document}`,
    'references.bib': `@article{foods2022,
  author = {Drossel, Fixture},
  title = {Testwerk für gedrosseltes Crossref},
  journal = {Foods},
  year = {2022},
  doi = {10.3390/foods11223570}
}
@article{erfunden,
  author = {Niemand, Nora},
  title = {Gibt es nicht},
  year = {2020},
  doi = {10.9999/gibt-es-nicht}
}`,
  })
  // P6: sieben Zitierstellen, je eine geprüft, ohne Seitenangabe und nicht prüfbar (Crossref), vier ohne Quelle.
  const p6Bericht = await neuAnlegen(a, 'E2E P6 Bericht', {
    'main.tex': String.raw`\documentclass{article}
\usepackage{csquotes}
\begin{document}
\enquote{During rest the hippocampus replays recent experience.} \autocite[349]{smith2024}
\enquote{Sleep supports the consolidation} \autocite{smith2024}
\parencite{ohneA} \parencite{ohneB} \parencite{ohneC} \parencite{ohneD}
\parencite{foods2022}
\end{document}`,
    'references.bib': `@article{smith2024,
  title = {Sleep and Memory},
  doi = {10.5555/spur.2024.001}
}
@article{foods2022,
  title = {Testwerk für gedrosseltes Crossref},
  doi = {10.3390/foods11223570}
}
${['A', 'B', 'C', 'D'].map(x => `@book{ohne${x},\n  title = {Ohne Quelle ${x}}\n}`).join('\n')}`,
  })
  await quelleAusFixture(p6Bericht._id, a._id, 'smith2024.pdf')
  await neuAnlegen(a, 'E2E P6 Zahlen', { 'main.tex': LEER, 'quellen.bib': '@article{p6,\n  title = {Zahlen}\n}\n' })
  await grenzenVorbereiten()
  await p8Vorbereiten(a)
}

async function p8Vorbereiten(a) {
  const zaehlung = await neuAnlegen(a, 'E2E P8 Zählung', {
    'main.tex': String.raw`\documentclass{article}
\usepackage{csquotes}
\begin{document}
\enquote{Sleep supports the consolidation of declarative memory.} \autocite[347]{smith2024}
Schlaf hilft dem Gedächtnis \parencite{smith2024}.
\end{document}`,
    'references.bib': BERICHT_BIB,
  })
  await quelleAusFixture(zaehlung._id, a._id, 'smith2024.pdf')
  await neuAnlegen(a, 'E2E P8 DOI', {
    'main.tex': String.raw`\documentclass{article}
\usepackage[backend=biber]{biblatex}
\addbibresource{references.bib}
\begin{document}
Crossref \parencite{smith2024}.
arXiv \parencite{arxiv2024}.
Nirgends \parencite{nirgends}.
Andere \parencite{andere}.
\end{document}`,
    'references.bib': `@article{smith2024,
  title = {Sleep and Memory},
  doi = {10.5555/spur.2024.001}
}
@article{arxiv2024,
  title = {Sleep-like replay improves memory consolidation},
  doi = {10.48550/arXiv.2401.01234}
}
@article{nirgends,
  title = {Gibt es nirgends},
  doi = {10.9999/nirgends.1}
}
@article{andere,
  title = {Bei einer anderen Registrierstelle},
  doi = {10.3333/andere.1}
}`,
  })
}

// P7 Grenzen: eigene Konten ohne Admin-Rechte, damit die Projektzahlen klein und bekannt sind.
async function grenzenVorbereiten() {
  const [ga, gb, gc] = await Promise.all(['e2e-grenze-a', 'e2e-grenze-b', 'e2e-grenze-c'].map(n => konto(`${n}@example.org`)))
  for (const konto of [ga, gb, gc]) {
    for (const alt of await db.projects.find({ owner_ref: konto._id }).toArray()) {
      await ProjectDeleter.promises.deleteProject(alt._id)
      await ProjectDeleter.promises.expireDeletedProject(alt._id)
    }
  }
  const tex = 'Text.\n'
  await projektAnlegen(ga._id, 'Grenze A1', { 'main.tex': tex })
  await projektAnlegen(ga._id, 'Grenze A2', { 'main.tex': tex })
  const archiv = await projektAnlegen(ga._id, 'Grenze A3', { 'main.tex': tex })
  await db.projects.updateOne({ _id: archiv._id }, { $set: { archived: [ga._id] } })
  const geteilt = await projektAnlegen(gb._id, 'Grenze B1', { 'main.tex': tex })
  await db.projects.updateOne({ _id: geteilt._id }, { $set: { collaberator_refs: [ga._id] } })
  const mitQuelle = await projektAnlegen(gb._id, 'Grenze B2', { 'main.tex': tex })
  await quelleAusFixture(mitQuelle._id, gb._id, 'smith2024.pdf')
  await projektAnlegen(gb._id, 'Grenze B3', { 'main.tex': tex })
  for (let i = 1; i <= 5; i++) await projektAnlegen(gc._id, `Grenze C${i}`, { 'main.tex': tex })
  await (await speicherSammlung()).deleteMany({})
}

// Als Skript läuft es als root; die Ablage muss danach dem Web-Prozess gehören.
if (fileURLToPath(import.meta.url) === process.argv[1]) {
  logger.logger.level('error')
  await e2eDatenVorbereiten()
  await ablageFreigeben()
  console.log('E2E-Daten bereit')
  process.exit(0)
}
