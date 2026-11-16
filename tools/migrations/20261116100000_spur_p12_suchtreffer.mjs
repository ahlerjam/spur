import Helpers from './lib/helpers.mjs'
import { getCollectionInternal } from './lib/mongodb.mjs'

const tags = ['server-ce', 'server-pro']

// P12: Ein Treffer steht je Projekt genau einmal im Suchprotokoll (Dubletten über DOI oder Titel und Jahr).
// paper_exclude per Titel sucht über den Titelschlüssel, den neuesten Treffer zuerst.
const INDIZES = [
  { key: { projectId: 1, schluessel: 1 }, name: 'projectId_1_schluessel_1', unique: true },
  { key: { projectId: 1, titelSchluessel: 1, erstmals: -1 }, name: 'projectId_1_titelSchluessel_1_erstmals_-1' },
]

async function up() {
  await Helpers.addIndexesToCollection(await getCollectionInternal('spurSearchHits'), INDIZES)
}

async function down() {
  await Helpers.dropIndexesFromCollection(await getCollectionInternal('spurSearchHits'), INDIZES)
}

export default { tags, migrate: up, rollback: down }
