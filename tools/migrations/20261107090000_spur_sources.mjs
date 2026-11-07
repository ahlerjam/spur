import Helpers from './lib/helpers.mjs'
import { getCollectionInternal } from './lib/mongodb.mjs'

const tags = ['server-ce', 'server-pro']

const indexes = {
  spurSources: [
    { key: { projectId: 1, key: 1 }, name: 'projectId_1_key_1', unique: true },
    { key: { projectId: 1, dateiname: 1 }, name: 'projectId_1_dateiname_1' },
  ],
  spurSourcePages: [
    { key: { quelleId: 1, seite: 1 }, name: 'quelleId_1_seite_1', unique: true },
    {
      key: { projectId: 1, text: 'text' },
      name: 'projectId_1_text_text',
      default_language: 'none',
    },
  ],
  spurCheckSections: [
    { key: { projectId: 1, hash: 1 }, name: 'projectId_1_hash_1', unique: true },
    {
      key: { erstelltAm: 1 },
      name: 'erstelltAm_1',
      expireAfterSeconds: 7 * 24 * 60 * 60,
    },
  ],
}

async function up() {
  for (const [name, liste] of Object.entries(indexes)) {
    await Helpers.addIndexesToCollection(await getCollectionInternal(name), liste)
  }
}

async function down() {
  for (const name of [...Object.keys(indexes), 'spurCrossref']) {
    await (await getCollectionInternal(name)).drop().catch(error => {
      if (error.codeName !== 'NamespaceNotFound') throw error
    })
  }
}

export default { tags, migrate: up, rollback: down }
