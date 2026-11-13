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
    `${JS}/features/source-editor/components/toolbar`,
    `${JS}/features/source-editor/components/editor-switch.tsx`,
    `${JS}/features/file-tree/components/file-tree-action-buttons.tsx`,
    `${JS}/features/file-tree/components/file-tree-toolbar.tsx`,
  ],
  Leiste: [`${JS}/features/ide-react/components/rail`],
  'Review-Panel': [`${JS}/features/review-panel`],
  'PDF-Bereich': [`${JS}/features/pdf-preview/components`],
  'Editor-Einstellungen': [`${JS}/features/ide-settings`],
  Projektliste: [`${JS}/features/project-list/components`],
  Kontomenü: [`${JS}/shared/components/navbar`],
  Dateibaum: [`${JS}/features/file-tree`],
  'Teilen-Dialog': [`${JS}/features/share-project-modal`],
  Verlauf: [`${JS}/features/history`],
  Chat: [`${JS}/features/chat`],
  Wortzahl: [`${JS}/features/word-count-modal`],
  Befehlspalette: [`${JS}/features/command-palette`],
}

function dateien(pfad) {
  if (!statSync(pfad).isDirectory()) return /\.(tsx?|jsx?)$/.test(pfad) && !/\.test\.|stories/.test(pfad) ? [pfad] : []
  return readdirSync(pfad).flatMap(name => dateien(join(pfad, name)))
}

export function schluesselIn(quelltext) {
  return [...quelltext.matchAll(/(?:\bt\(\s*|i18nKey=)['"]([a-z0-9_]+)['"]/g)].map(treffer => treffer[1])
}

test('schluesselIn findet t()-Aufrufe mit einfachen und doppelten Anführungszeichen', () => {
  assert.deepEqual(schluesselIn(`t('file') + t("insert", { x }) + translate('view') + t(variable) + <Trans i18nKey="viewing_x" />`), ['file', 'insert', 'viewing_x'])
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

test('bekannte englische Reste sind übersetzt', () => {
  const de = JSON.parse(readFileSync(join(WEB, 'locales/de.json'), 'utf8'))
  assert.equal(de.raw_logs, 'Rohprotokoll')
  assert.equal(de.raw_logs_description, 'Rohprotokoll vom LaTeX-Compiler')
  assert.equal(de.hide_file_tree, 'Dateibaum ausblenden')
  assert.equal(de.show_file_tree, 'Dateibaum einblenden')
  assert.equal(de.resize, 'Größe ändern')
  assert.equal(de.close_dialog, 'Dialog schließen')
  assert.equal(de.more_actions, 'Weitere Aktionen')
  assert.equal(de.none, 'Keine')
  assert.equal(de.project_files_history, 'Verlauf der Projektdateien')
  assert.equal(de.project_history_labels, 'Projektverlauf und Marken')
})
