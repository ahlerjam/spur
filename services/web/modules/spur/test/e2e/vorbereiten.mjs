// Legt Testkonten und Testprojekte an und setzt deren Quellen zurück.
// Aufruf: spur-dev run modules/spur/test/e2e/vorbereiten.mjs
import { randomUUID } from 'node:crypto'
import logger from '@overleaf/logger'
import { db } from '../../../../app/src/infrastructure/mongodb.mjs'
import UserRegistrationHandler from '../../../../app/src/Features/User/UserRegistrationHandler.mjs'
import ProjectDeleter from '../../../../app/src/Features/Project/ProjectDeleter.mjs'
import { projektAnlegen } from '../../scripts/lib/projekt-anlegen.mjs'
import { ablageFreigeben, demoAnlegen, quelleAusFixture } from '../../scripts/seed.mjs'
import { projektAufraeumen } from '../../app/src/QuellenManager.mjs'
import { quellen, quellenSeiten } from '../../app/src/sammlungen.mjs'

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

const a = await konto('e2e-a@example.org')
const leser = await konto('e2e-leser@example.org')
const link = await konto('e2e-link@example.org')

await neuAnlegen(a, 'E2E APA', { 'main.tex': APA, 'references.bib': BIB })
await neuAnlegen(a, 'E2E natbib', { 'main.tex': NATBIB, 'references.bib': BIB })

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

const neuesDemo = await demoAnlegen(a)
await db.projects.updateOne({ _id: neuesDemo._id }, { $set: { readOnly_refs: [leser._id] } })

for (const klon of await db.projects.find({ owner_ref: a._id, name: 'E2E Klon' }).toArray()) {
  await ProjectDeleter.promises.deleteProject(klon._id)
  await ProjectDeleter.promises.expireDeletedProject(klon._id)
}

await ablageFreigeben()
console.log('E2E-Daten bereit')
process.exit(0)
