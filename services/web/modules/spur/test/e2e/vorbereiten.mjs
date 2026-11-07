// Legt Testkonten und Testprojekte an. Wiederholbar: Vorhandenes bleibt stehen.
// Aufruf: spur-dev run modules/spur/test/e2e/vorbereiten.mjs
import { randomUUID } from 'node:crypto'
import { db } from '../../../../app/src/infrastructure/mongodb.mjs'
import UserRegistrationHandler from '../../../../app/src/Features/User/UserRegistrationHandler.mjs'
import { projektAnlegen } from '../../scripts/lib/projekt-anlegen.mjs'

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

async function konto(email) {
  const vorhanden = await db.users.findOne({ email })
  if (vorhanden) return vorhanden
  return await UserRegistrationHandler.promises.registerNewUser({
    email,
    password: PASSWORT,
    analyticsId: randomUUID(),
  })
}

async function projekt(owner, name, dateien) {
  const vorhanden = await db.projects.findOne({ owner_ref: owner._id, name })
  if (!vorhanden) await projektAnlegen(owner._id, name, dateien)
}

const a = await konto('e2e-a@example.org')
await projekt(a, 'E2E APA', { 'main.tex': APA, 'references.bib': BIB })
await projekt(a, 'E2E natbib', { 'main.tex': NATBIB, 'references.bib': BIB })

console.log('E2E-Daten bereit')
process.exit(0)
