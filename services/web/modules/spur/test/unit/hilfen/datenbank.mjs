// Eigene Mongo-Datenbank je Testdatei auf dem Server der Dev-Umgebung, nie die echte (sharelatex).
// Die Indizes entsprechen tools/migrations/*spur*: Eindeutigkeit und Textsuche gehören zum Verhalten.
import { randomUUID } from 'node:crypto'
import mongodb from 'mongodb-legacy'

export const { ObjectId } = mongodb

const INDIZES = {
  spurSources: [{ key: { projectId: 1, key: 1 }, unique: true }],
  spurSourcePages: [
    { key: { quelleId: 1, seite: 1 }, unique: true },
    { key: { projectId: 1, text: 'text' }, default_language: 'none' },
  ],
  spurCheckSections: [{ key: { projectId: 1, hash: 1 }, unique: true }],
  spurEdits: [{ key: { botId: 1, schluessel: 1 }, unique: true }],
  spurAcquisitions: [{ key: { projectId: 1, doi: 1 }, unique: true }],
  spurNotes: [{ key: { projectId: 1, quelleId: 1, zitatId: 1 }, unique: true }],
  spurMatrixCells: [{ key: { projectId: 1, quelleId: 1, spalteId: 1 }, unique: true }],
  spurRuns: [
    {
      key: { projectId: 1, botId: 1 },
      unique: true,
      partialFilterExpression: { status: 'offen' },
    },
  ],
}

export async function testDatenbank() {
  const url = new URL(process.env.OVERLEAF_MONGO_URL ?? 'mongodb://mongo/test')
  url.pathname = `/spur-unit-${randomUUID().slice(0, 8)}`
  const client = new mongodb.MongoClient(url.toString())
  await client.connect()
  const db = client.db()
  for (const [name, liste] of Object.entries(INDIZES)) {
    await db.collection(name).createIndexes(liste)
  }
  return {
    db,
    // Ersatz für app/src/infrastructure/mongodb.mjs
    mongodbModul: {
      ObjectId,
      db: new Proxy({}, { get: (_, name) => db.collection(name) }),
      getCollectionInternal: async name => db.collection(name),
    },
    async leeren() {
      for (const { name } of await db.listCollections().toArray()) {
        await db.collection(name).deleteMany({})
      }
    },
    async schliessen() {
      await db.dropDatabase()
      await client.close()
    },
  }
}

// Fester Schalter-Ersatz: `schalter.zeit` bestimmt jetzt().
export function schalterAttrappe() {
  const schalter = {
    zeit: new Date('2026-11-07T10:00:00Z'),
    paperApiBasis: undefined,
    IST_DEV: false,
  }
  schalter.modul = {
    IST_DEV: false,
    jetzt: () => new Date(schalter.zeit),
    paperApiBasis: () => schalter.paperApiBasis,
    semantikAn: () => schalter.semantik ?? false,
    fakeEmbeddings: () => true,
  }
  return schalter
}
