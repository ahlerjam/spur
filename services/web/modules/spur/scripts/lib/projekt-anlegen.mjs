import ProjectCreationHandler from '../../../../app/src/Features/Project/ProjectCreationHandler.mjs'
import ProjectEntityUpdateHandler from '../../../../app/src/Features/Project/ProjectEntityUpdateHandler.mjs'
import ProjectGetter from '../../../../app/src/Features/Project/ProjectGetter.mjs'

export async function projektAnlegen(ownerId, name, dateien) {
  const project = await ProjectCreationHandler.promises.createBlankProject(
    ownerId,
    name
  )
  const { rootFolder } = await ProjectGetter.promises.getProject(project._id, {
    rootFolder: true,
  })
  for (const [path, inhalt] of Object.entries(dateien)) {
    const { doc } = await ProjectEntityUpdateHandler.promises.upsertDoc(
      project._id,
      rootFolder[0]._id,
      path,
      inhalt.split('\n'),
      'spur-seed',
      ownerId
    )
    if (path === 'main.tex') {
      await ProjectEntityUpdateHandler.promises.setRootDoc(project._id, doc._id)
    }
  }
  return project
}
