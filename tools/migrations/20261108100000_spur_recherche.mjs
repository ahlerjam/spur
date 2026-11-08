import Helpers from './lib/helpers.mjs'
import { getCollectionInternal } from './lib/mongodb.mjs'

const tags = ['server-ce', 'server-pro']

// P2: Eine DOI steht höchstens einmal je Projekt auf der Beschaffungsliste, je Quelle und Zitat gibt es eine
// Notiz, je Quelle und Spalte eine Matrixzelle; das Protokoll liest neueste zuerst.
const indexes = {
  spurAcquisitions: [{ key: { projectId: 1, doi: 1 }, name: 'projectId_1_doi_1', unique: true }],
  spurSearchLog: [{ key: { projectId: 1, datum: -1 }, name: 'projectId_1_datum_-1' }],
  spurNotes: [{ key: { projectId: 1, quelleId: 1, zitatId: 1 }, name: 'projectId_1_quelleId_1_zitatId_1', unique: true }],
  spurJobs: [
    { key: { projectId: 1, art: 1, status: 1 }, name: 'projectId_1_art_1_status_1' },
    { key: { projectId: 1, botId: 1, art: 1, status: 1, fertigAm: -1 }, name: 'projectId_1_botId_1_art_1_status_1_fertigAm_-1' },
  ],
  spurMatrixCells: [
    { key: { projectId: 1, quelleId: 1, spalteId: 1 }, name: 'projectId_1_quelleId_1_spalteId_1', unique: true },
  ],
}

const SAMMLUNGEN = [...Object.keys(indexes), 'spurDrossel', 'spurPaperCache', 'spurMatrix']

async function up() {
  for (const [name, liste] of Object.entries(indexes)) {
    await Helpers.addIndexesToCollection(await getCollectionInternal(name), liste)
  }
}

async function down() {
  for (const name of SAMMLUNGEN) {
    await (await getCollectionInternal(name)).drop().catch(error => {
      if (error.codeName !== 'NamespaceNotFound') throw error
    })
  }
}

export default { tags, migrate: up, rollback: down }
