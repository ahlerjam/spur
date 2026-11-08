import EditorRealTimeController from '../../../../app/src/Features/Editor/EditorRealTimeController.mjs'

// Meldungen an offene Editoren des Projekts. Sie tragen nur IDs; die Panels laden selbst nach,
// damit über den Socket nichts geht, was die Rechteprüfung der Routen umgeht.
export function zitateGeaendert(quelle) {
  EditorRealTimeController.emitToRoom(String(quelle.projectId), 'spur:zitate', {
    quelleId: String(quelle._id),
  })
}

export function quelleGeaendert(quelle) {
  EditorRealTimeController.emitToRoom(String(quelle.projectId), 'spur:quellen', {
    quelleId: String(quelle._id),
  })
}
