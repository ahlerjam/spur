import Helpers from './lib/helpers.mjs'
import { getCollectionInternal } from './lib/mongodb.mjs'

const tags = ['server-ce', 'server-pro']

const indexes = {
  spurRuns: [{ key: { projectId: 1, botId: 1, _id: -1 }, name: 'projectId_1_botId_1__id_-1' }],
  spurEdits: [
    { key: { botId: 1, schluessel: 1 }, name: 'botId_1_schluessel_1', unique: true },
    { key: { am: 1 }, name: 'am_1', expireAfterSeconds: 30 * 24 * 60 * 60 },
  ],
  spurEvents: [{ key: { botId: 1, zugestellt: 1, _id: 1 }, name: 'botId_1_zugestellt_1__id_1' }],
  spurMessages: [{ key: { projectId: 1, botId: 1, _id: -1 }, name: 'projectId_1_botId_1__id_-1' }],
}

async function up() {
  for (const [name, liste] of Object.entries(indexes)) {
    await Helpers.addIndexesToCollection(await getCollectionInternal(name), liste)
  }
}

async function down() {
  for (const name of [...Object.keys(indexes), 'spurHeartbeats']) {
    await (await getCollectionInternal(name)).drop().catch(error => {
      if (error.codeName !== 'NamespaceNotFound') throw error
    })
  }
}

export default { tags, migrate: up, rollback: down }
