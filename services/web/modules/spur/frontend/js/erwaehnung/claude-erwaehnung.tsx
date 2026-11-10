import { type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

// Wie ERWAEHNT auf dem Server (Erwaehnung.mjs): @claude als eigenes Wort, nicht in mail@claude.de oder @claudette.
const ERWAEHNT = /(^|[^\w@.])(@claude)(?![\w-])/gi

export const erwaehnt = (text: string) => new RegExp(ERWAEHNT.source, 'i').test(text)

export function hervorheben(text: string): ReactNode[] {
  const teile: ReactNode[] = []
  let rest = 0
  for (const treffer of text.matchAll(ERWAEHNT)) {
    const start = treffer.index + treffer[1].length
    if (start > rest) teile.push(text.slice(rest, start))
    teile.push(
      <span key={start} className="spur-claude-erwaehnung">
        {treffer[2]}
      </span>
    )
    rest = start + treffer[2].length
  }
  if (rest < text.length) teile.push(text.slice(rest))
  return teile
}

export function ClaudeHinweis({ text }: { text: string }) {
  const { t } = useTranslation()
  return (
    <div className="spur-claude-hinweis" role="status">
      {erwaehnt(text) && t('spur_claude_wird_benachrichtigt')}
    </div>
  )
}

export default { highlight: hervorheben, InputHint: ClaudeHinweis }
