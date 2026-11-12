// Overleaf erlaubt je Projekt Settings.maxEntitiesPerProject Einträge (Ordner, Dokumente, Dateien) und wirft
// sonst TooManyFilesError. spur prüft vorab, um eine klare Meldung zu geben statt eines halben Ergebnisses.
import Settings from '@overleaf/settings'
import ProjectGetter from '../../../../app/src/Features/Project/ProjectGetter.mjs'

export const maxEintraege = () => Settings.maxEntitiesPerProject

function zaehlen(ordner) {
  if (!ordner) return 0
  const unter = ordner.folders ?? []
  return unter.length + (ordner.docs?.length ?? 0) + (ordner.fileRefs?.length ?? 0) + unter.reduce((s, o) => s + zaehlen(o), 0)
}

export async function anzahlEintraege(projectId) {
  const projekt = await ProjectGetter.promises.getProject(projectId, { rootFolder: 1 })
  return zaehlen(projekt?.rootFolder?.[0])
}
