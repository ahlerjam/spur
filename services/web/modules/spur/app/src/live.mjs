import EditorRealTimeController from '../../../../app/src/Features/Editor/EditorRealTimeController.mjs'

// Meldungen an offene Editoren des Projekts. Sie tragen nur IDs; die Panels laden selbst nach,
// damit über den Socket nichts geht, was die Rechteprüfung der Routen umgeht.
// `an` nennt bei Zuweisungen die betroffene Person, damit nur ihr Hinweis nachlädt.
const melden = ereignis => (quelle, an) =>
  EditorRealTimeController.emitToRoom(String(quelle.projectId), ereignis, {
    quelleId: String(quelle._id),
    ...(an ? { an: String(an) } : {}),
  })

export const zitateGeaendert = melden('spur:zitate')
export const quelleGeaendert = melden('spur:quellen')
