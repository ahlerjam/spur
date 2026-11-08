import Helpers from './lib/helpers.mjs'
import { getCollectionInternal } from './lib/mongodb.mjs'

const tags = ['server-ce', 'server-pro']

// Der Chat-Verlauf sortiert nach am und _id (Inbox.verlauf); mit _id im Index endet die Abfrage nach
// 501 Einträgen, statt den ganzen Verlauf im Speicher zu sortieren. Ersetzt den Index nur nach am.
const neu = [{ key: { projectId: 1, botId: 1, am: -1, _id: -1 }, name: 'projectId_1_botId_1_am_-1__id_-1' }]
const alt = [{ key: { projectId: 1, botId: 1, am: -1 }, name: 'projectId_1_botId_1_am_-1' }]

async function up() {
  const nachrichten = await getCollectionInternal('spurMessages')
  await Helpers.addIndexesToCollection(nachrichten, neu)
  await Helpers.dropIndexesFromCollection(nachrichten, alt)
}

async function down() {
  const nachrichten = await getCollectionInternal('spurMessages')
  await Helpers.addIndexesToCollection(nachrichten, alt)
  await Helpers.dropIndexesFromCollection(nachrichten, neu)
}

export default { tags, migrate: up, rollback: down }
