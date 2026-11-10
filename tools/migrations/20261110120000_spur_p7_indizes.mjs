import Helpers from './lib/helpers.mjs'
import { getCollectionInternal } from './lib/mongodb.mjs'

const tags = ['server-ce', 'server-pro']

// Upload-Links werden über den Hash des Tokens gesucht (öffentlicher Endpunkt) und verfallen nach dem Ablauf;
// TeX-Pakete sind je Projekt und Paket genau einmal gebucht.
const INDIZES = {
  spurUploadLinks: [
    { key: { hash: 1 }, name: 'hash_1', unique: true },
    { key: { ablauf: 1 }, name: 'ablauf_1', expireAfterSeconds: 24 * 3600 },
  ],
  spurTexPackages: [{ key: { projectId: 1, paket: 1 }, name: 'projectId_1_paket_1', unique: true }],
}

async function up() {
  for (const [name, indizes] of Object.entries(INDIZES)) {
    await Helpers.addIndexesToCollection(await getCollectionInternal(name), indizes)
  }
}

async function down() {
  for (const [name, indizes] of Object.entries(INDIZES)) {
    await Helpers.dropIndexesFromCollection(await getCollectionInternal(name), indizes)
  }
}

export default { tags, migrate: up, rollback: down }
