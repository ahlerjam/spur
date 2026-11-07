// f5: Nach `projectExpired` liegen keine Dateien des Projekts mehr im Daten-Volume.
// Aufruf: spur-dev run modules/spur/test/e2e/ablauf.mjs
import { access } from 'node:fs/promises'
import Path from 'node:path'
import { db } from '../../../../app/src/infrastructure/mongodb.mjs'
import ProjectDeleter from '../../../../app/src/Features/Project/ProjectDeleter.mjs'
import { projektAnlegen } from '../../scripts/lib/projekt-anlegen.mjs'
import { ablageFreigeben, quelleAusFixture } from '../../scripts/seed.mjs'
import { ablageWurzel } from '../../app/src/QuellenManager.mjs'
import { quellen } from '../../app/src/sammlungen.mjs'

const owner = await db.users.findOne({ email: 'e2e-a@example.org' })
const projekt = await projektAnlegen(owner._id, `E2E Ablauf ${Date.now()}`, {
  'main.tex': 'x',
})
await quelleAusFixture(projekt._id, owner._id, 'smith2024.pdf')
const ordner = Path.join(ablageWurzel(), String(projekt._id))
await access(ordner)

await ProjectDeleter.promises.deleteProject(projekt._id)
await ProjectDeleter.promises.expireDeletedProject(projekt._id)

const ordnerDa = await access(ordner).then(
  () => true,
  () => false
)
const eintraege = await (await quellen()).countDocuments({ projectId: projekt._id })
await ablageFreigeben()
if (ordnerDa || eintraege) {
  console.error(`FEHLER: Ordner noch da: ${ordnerDa}, Einträge: ${eintraege}`)
  process.exit(1)
}
console.log('projectExpired: Ordner und Einträge entfernt')
process.exit(0)
