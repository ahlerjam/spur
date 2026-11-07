import Helpers from './lib/helpers.mjs'
import { getCollectionInternal } from './lib/mongodb.mjs'

const tags = ['server-ce', 'server-pro']

const indexes = [
  { key: { quelleId: 1 }, name: 'quelleId_1' },
  { key: { projectId: 1 }, name: 'projectId_1' },
]

async function up() {
  await Helpers.addIndexesToCollection(await getCollectionInternal('spurQuotes'), indexes)
}

async function down() {
  await Helpers.dropIndexesFromCollection(await getCollectionInternal('spurQuotes'), indexes)
}

export default { tags, migrate: up, rollback: down }
