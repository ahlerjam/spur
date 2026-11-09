import EditorController from '../../../../../app/src/Features/Editor/EditorController.mjs'
import * as PruefManager from '../pruefung/PruefManager.mjs'
import { laeufe } from '../sammlungen.mjs'
import { offenlegungText, texAbschnitt } from './text.mjs'

export const DATEI = '/ki-offenlegung.tex'

export async function text(projectId, { modell } = {}) {
  const [liste, docs] = await Promise.all([
    (await laeufe()).find({ projectId, aenderungen: { $gt: 0 } }).sort({ gestartet: 1 }).toArray(),
    PruefManager.dokumente(projectId),
  ])
  const pfade = new Map(docs.map(d => [String(d.docId), d.pfad]))
  const eintraege = liste.map(l => ({
    status: l.status,
    zusammenfassung: l.zusammenfassung,
    gestartet: l.gestartet,
    pfade: l.docs.map(id => pfade.get(String(id)) ?? 'gelöschte Datei'),
  }))
  return { text: offenlegungText(eintraege, { modell }), leer: !eintraege.some(e => e.status !== 'offen') }
}

export async function alsTex(projectId, userId, { modell }) {
  const { text: inhalt, leer } = await text(projectId, { modell })
  await EditorController.promises.upsertDocWithPath(projectId, DATEI, texAbschnitt(inhalt).split('\n'), 'spur', userId)
  return { pfad: DATEI.slice(1), leer }
}
