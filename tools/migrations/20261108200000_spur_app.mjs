import Helpers from './lib/helpers.mjs'
import { getCollectionInternal } from './lib/mongodb.mjs'

const tags = ['server-ce', 'server-pro']

// P3: Tageslimit zählt suggest_trigger je Bot ab Tagesbeginn, das Panel liest offene Vorschläge,
// der Chat seinen Verlauf nach Zeit und die Schalter je Projekt und Person.
const indexes = {
  spurEvents: [{ key: { botId: 1, typ: 1, am: 1 }, name: 'botId_1_typ_1_am_1' }],
  spurMessages: [{ key: { projectId: 1, botId: 1, am: -1 }, name: 'projectId_1_botId_1_am_-1' }],
  spurSettings: [{ key: { projectId: 1, userId: 1 }, name: 'projectId_1_userId_1' }],
  spurSuggestions: [{ key: { projectId: 1, botId: 1, status: 1, am: -1 }, name: 'projectId_1_botId_1_status_1_am_-1' }],
}

async function up() {
  for (const [name, liste] of Object.entries(indexes)) {
    await Helpers.addIndexesToCollection(await getCollectionInternal(name), liste)
  }
}

async function down() {
  for (const name of ['spurEvents', 'spurMessages', 'spurSettings']) {
    await Helpers.dropIndexesFromCollection(await getCollectionInternal(name), indexes[name])
  }
  await Helpers.dropCollection('spurSuggestions')
  await Helpers.dropCollection('spurWorkflows')
}

export default { tags, migrate: up, rollback: down }
