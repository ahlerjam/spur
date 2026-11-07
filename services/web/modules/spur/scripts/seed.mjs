// `make seed`: legt das Projekt „Demo“ an. Aufruf: node modules/spur/scripts/seed.mjs [email]
import { execFile } from 'node:child_process'
import { randomBytes, randomUUID } from 'node:crypto'
import { copyFile, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import Path from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { db } from '../../../app/src/infrastructure/mongodb.mjs'
import UserRegistrationHandler from '../../../app/src/Features/User/UserRegistrationHandler.mjs'
import { projektAnlegen } from './lib/projekt-anlegen.mjs'
import * as QuellenManager from '../app/src/QuellenManager.mjs'

const execDatei = promisify(execFile)
const FIXTURES = fileURLToPath(new URL('../test/fixtures/', import.meta.url))

export const MAIN = String.raw`\documentclass{article}
\usepackage[style=apa,backend=biber]{biblatex}
\usepackage{csquotes}
\addbibresource{references.bib}
\begin{document}
\enquote{Sleep supports the consolidation of declarative memory.} \autocite[347]{smith2024}
\printbibliography
\end{document}`

export const BIB = `@article{smith2024,
  author = {Smith, Alice},
  title = {Sleep and Memory},
  journal = {Journal of Sleep Research},
  year = {2024},
  pages = {345--352},
  doi = {10.5555/spur.2024.001}
}`

export async function quelleAusFixture(projectId, userId, dateiname) {
  const tempPfad = Path.join(tmpdir(), `${randomUUID()}-${dateiname}`)
  await copyFile(Path.join(FIXTURES, dateiname), tempPfad)
  const { size } = await stat(tempPfad)
  return await QuellenManager.aufnehmen({
    projectId,
    userId,
    dateiname,
    tempPfad,
    groesse: size,
  })
}

// Das Skript läuft als root, der Web-Prozess muss die Ablage aber beschreiben können.
export async function ablageFreigeben() {
  const { uid, gid } = await stat(Path.dirname(QuellenManager.ablageWurzel()))
  await execDatei('chown', ['-R', `${uid}:${gid}`, QuellenManager.ablageWurzel()])
}

async function besitzer(email) {
  const vorhanden = email
    ? await db.users.findOne({ email })
    : await db.users.findOne({ isAdmin: true })
  if (vorhanden) return vorhanden
  return await UserRegistrationHandler.promises.registerNewUser({
    email: email ?? 'demo@example.org',
    password: randomBytes(24).toString('hex'),
    analyticsId: randomUUID(),
  })
}

export async function demoAnlegen(owner) {
  const vorhanden = await db.projects.findOne({ owner_ref: owner._id, name: 'Demo' })
  if (vorhanden) return vorhanden
  const project = await projektAnlegen(owner._id, 'Demo', {
    'main.tex': MAIN,
    'references.bib': BIB,
  })
  await quelleAusFixture(project._id, owner._id, 'smith2024.pdf')
  return project
}

if (fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    const owner = await besitzer(process.argv[2])
    await demoAnlegen(owner)
    await ablageFreigeben()
    console.log(`Projekt „Demo“ steht für ${owner.email} bereit`)
    process.exit(0)
  } catch (error) {
    console.error(error)
    process.exit(1)
  }
}
