import { randomBytes } from 'node:crypto'
import Settings from '@overleaf/settings'
import { fetchNothing, RequestFailedError } from '@overleaf/fetch-utils'
import { Problem } from '../probleme.mjs'
import { testSchalter } from '../schalter.mjs'

const TIMEOUT_MS = 30000

// Format wie RangesTracker.generateIdSeed: 18 Hex-Zeichen, das Schema im document-updater prüft es.
const neuerSeed = () => randomBytes(9).toString('hex')

// Wendet Ops über den spur-Endpunkt des document-updater an. Mit `tracked` als Track Change.
export async function spurUpdate(projectId, docId, op, version, { userId, tracked }) {
  const url = `${Settings.apis.documentupdater.url}/project/${projectId}/doc/${docId}/spur-update`
  try {
    if (testSchalter('SPUR_DOKUPDATER_500')) {
      throw new RequestFailedError(url, { method: 'POST' }, new Response('Testschalter', { status: 500 }), null)
    }
    await fetchNothing(
      url,
      {
        method: 'POST',
        json: {
          op,
          v: version,
          meta: { user_id: String(userId), source: 'spur', ...(tracked ? { tc: neuerSeed() } : {}) },
        },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      }
    )
  } catch (error) {
    if (error instanceof RequestFailedError && error.response.status === 409) {
      throw new Problem(409, 'konflikt', 'spur_fehler_doc_geaendert')
    }
    if (error instanceof RequestFailedError && error.response.status === 404) {
      throw new Problem(404, 'doc_fehlt', 'spur_fehler_doc_fehlt')
    }
    throw error
  }
}
