// Die Werkzeuge des MCP-Servers stehen in werkzeuge.mjs als Schlüssel `  name: {` des Objekts WERKZEUGE.
import { readFileSync } from 'node:fs'

export function werkzeugeImCode() {
  const quelle = readFileSync(new URL('../../services/web/modules/spur/app/src/mcp/werkzeuge.mjs', import.meta.url), 'utf8')
  const block = quelle.slice(quelle.indexOf('export const WERKZEUGE = {'))
  return new Set([...block.matchAll(/^ {2}([a-z_]+): \{$/gm)].map(m => m[1]))
}
