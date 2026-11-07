import Helpers from './lib/helpers.mjs'
import { getCollectionInternal } from './lib/mongodb.mjs'

const tags = ['server-ce', 'server-pro']

// Höchstens ein offener Lauf je Projekt und Bot, auch bei gleichzeitigen doc_edit-Aufrufen.
const indexes = [
  {
    key: { projectId: 1, botId: 1 },
    name: 'projectId_1_botId_1_offen',
    unique: true,
    partialFilterExpression: { status: 'offen' },
  },
]

async function up() {
  await Helpers.addIndexesToCollection(await getCollectionInternal('spurRuns'), indexes)
}

async function down() {
  await Helpers.dropIndexesFromCollection(await getCollectionInternal('spurRuns'), indexes)
}

export default { tags, migrate: up, rollback: down }
