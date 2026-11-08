import Helpers from './lib/helpers.mjs'
import { getCollectionInternal } from './lib/mongodb.mjs'

const tags = ['server-ce', 'server-pro']

// P2: Eine DOI steht höchstens einmal je Projekt auf der Beschaffungsliste; Protokoll neueste zuerst.
const indexes = {
  spurAcquisitions: [{ key: { projectId: 1, doi: 1 }, name: 'projectId_1_doi_1', unique: true }],
  spurSearchLog: [{ key: { projectId: 1, datum: -1 }, name: 'projectId_1_datum_-1' }],
}

const SAMMLUNGEN = [...Object.keys(indexes), 'spurDrossel', 'spurPaperCache']

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
