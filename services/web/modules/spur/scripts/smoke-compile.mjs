// Kompiliert die Smoke-Dokumente (APA; Folien mit metropolis, ngerman, mhchem, siunitx) mit dem laufenden Stack.
// Workflow `Smoke`.
import { randomBytes, randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import UserRegistrationHandler from '../../../app/src/Features/User/UserRegistrationHandler.mjs'
import CompileManager from '../../../app/src/Features/Compile/CompileManager.mjs'
import ProjectDeleter from '../../../app/src/Features/Project/ProjectDeleter.mjs'
import { zitateFinden } from '../app/src/pruefung/latex.mjs'
import { projektAnlegen } from './lib/projekt-anlegen.mjs'
import { DOKUMENTE } from './smoke-dokumente.mjs'

export default async function main() {
  // Die Grammatik ist generiert; das Dev-Image würde ein Fehlen im Produktions-Image verdecken.
  if (zitateFinden(String.raw`\cite{smoke}`).length !== 1) {
    throw new Error('Der Zitat-Parser funktioniert im Image nicht')
  }
  const user = await UserRegistrationHandler.promises.registerNewUser({
    email: `smoke-${Date.now()}@example.org`,
    password: randomBytes(24).toString('hex'),
    analyticsId: randomUUID(),
  })
  for (const { name, dateien } of DOKUMENTE) {
    const project = await projektAnlegen(user._id, `Smoke ${name}`, dateien)
    const result = await CompileManager.promises.compile(project._id, user._id, {})
    await ProjectDeleter.promises.deleteProject(project._id)
    const pdf = result.outputFiles?.some(file => file.path === 'output.pdf')
    if (result.status !== 'success' || !pdf) {
      throw new Error(`Compile ${name}: ${result.status}, PDF: ${Boolean(pdf)}`)
    }
    console.log(`Compile ${name} erfolgreich`)
  }
}

if (fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    await main()
    process.exit(0)
  } catch (error) {
    console.error(error)
    process.exit(1)
  }
}
