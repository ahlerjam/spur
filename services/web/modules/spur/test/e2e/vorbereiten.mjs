// Legt Testkonten und Testprojekte an und setzt deren Quellen zurück.
// Aufruf: spur-dev run modules/spur/test/e2e/vorbereiten.mjs
import { randomUUID } from 'node:crypto'
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
} from '../../app/src/sammlungen.mjs'
import { createHash } from 'node:crypto'
import { botFuer, kontoAufraeumen, SCOPE } from '../../app/src/ClaudeZugang.mjs'
import UserDeleter from '../../../../app/src/Features/User/UserDeleter.mjs'

const PASSWORT = 'spur-e2e-Passwort-1'
logger.logger.level('error')

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
for (const email of ['e2e-neu@example.org']) {
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

await ablageFreigeben()
console.log('E2E-Daten bereit')
process.exit(0)
