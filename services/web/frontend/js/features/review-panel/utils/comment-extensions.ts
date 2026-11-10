import { FC, ReactNode } from 'react'
import importOverleafModules from '../../../../macros/import-overleaf-module.macro'

// Module may highlight parts of a comment and show hints under a comment input.
export type CommentExtension = {
  highlight: (text: string) => ReactNode[]
  InputHint: FC<{ text: string }>
}

export const commentExtensions = (
  importOverleafModules('reviewPanelComments') as {
    import: { default: CommentExtension }
  }[]
).map(({ import: { default: extension } }) => extension)

export function highlightComment(text: string): ReactNode[] {
  return commentExtensions.reduce<ReactNode[]>(
    (parts, { highlight }) =>
      parts.flatMap(part => (typeof part === 'string' ? highlight(part) : [part])),
    [text]
  )
}
