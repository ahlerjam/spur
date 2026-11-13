// node --test tools/tests/sprache.test.mjs
// Die deutsche Oberfläche ist auf den Flächen, die man täglich sieht, vollständig deutsch: Jeder Sprachschlüssel, den
// diese Flächen verwenden, steht in de.json. Der Rest der fehlenden Schlüssel steht im Backlog.
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

const WEB = fileURLToPath(new URL('../../services/web/', import.meta.url))
const JS = 'frontend/js'

export const FLAECHEN = {
  Menüleiste: [
    `${JS}/features/ide-react/components/toolbar`,
    `${JS}/shared/components/menu-bar`,
    `${JS}/features/source-editor/hooks/use-toolbar-menu-editor-commands.tsx`,
    `${JS}/features/source-editor/components/tabs`,
    `${JS}/features/file-tree/components/file-tree-action-buttons.tsx`,
  ],
  Leiste: [`${JS}/features/ide-react/components/rail`],
  'Review-Panel': [`${JS}/features/review-panel`],
  'PDF-Bereich': [`${JS}/features/pdf-preview/components`],
  'Editor-Einstellungen': [`${JS}/features/ide-settings`],
  Projektliste: [`${JS}/features/project-list/components`],
  Kontomenü: [`${JS}/shared/components/navbar`],
}

function dateien(pfad) {
  if (!statSync(pfad).isDirectory()) return /\.(tsx?|jsx?)$/.test(pfad) && !/\.test\.|stories/.test(pfad) ? [pfad] : []
  return readdirSync(pfad).flatMap(name => dateien(join(pfad, name)))
}

export function schluesselIn(quelltext) {
  return [...quelltext.matchAll(/\bt\(\s*['"]([a-z0-9_]+)['"]/g)].map(treffer => treffer[1])
}

test('schluesselIn findet t()-Aufrufe mit einfachen und doppelten Anführungszeichen', () => {
  assert.deepEqual(schluesselIn(`t('file') + t("insert", { x }) + translate('view') + t(variable)`), ['file', 'insert'])
})

test('jeder Schlüssel der täglichen Flächen steht in de.json', () => {
  const de = JSON.parse(readFileSync(join(WEB, 'locales/de.json'), 'utf8'))
  const fehlend = {}
  for (const [flaeche, pfade] of Object.entries(FLAECHEN)) {
    const schluessel = new Set(
      pfade.flatMap(pfad => dateien(join(WEB, pfad))).flatMap(datei => schluesselIn(readFileSync(datei, 'utf8')))
    )
    const fehlt = [...schluessel].filter(s => !(s in de)).sort()
    if (fehlt.length) fehlend[flaeche] = fehlt
  }
  assert.deepEqual(fehlend, {})
})
