// node --test tools/tests/oberflaeche.test.mjs
// Gestaltungswerte kommen aus Overleafs Variablen; eigene Werte stehen benannt oben in spur.scss. Jede Regel steht
// einmal, sonst gewinnt je nach Reihenfolge eine andere. Ein Wort je Aktion: Schließen, Speichern und Kopieren
// kommen aus Overleafs Schlüsseln `close`, `save`, `copy`.
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

const WEB = fileURLToPath(new URL('../../services/web/', import.meta.url))
const SCSS = readFileSync(join(WEB, 'modules/spur/frontend/stylesheets/spur.scss'), 'utf8')
const FARBE = /#[0-9a-f]{3,8}\b|\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch)\(/i

export function farbenAusserhalbBenannterWerte(scss) {
  return scss
    .split('\n')
    .map((zeile, i) => ({ zeile, nr: i + 1 }))
    .filter(({ zeile }) => !/^\s*\/\//.test(zeile) && !/^\$[\w-]+\s*:/.test(zeile))
    .filter(({ zeile }) => FARBE.test(zeile))
    .map(({ zeile, nr }) => `${nr}: ${zeile.trim()}`)
}

// Selektoren auf oberster Ebene und direkt in @media; Verschachteltes gehört zu seiner Regel.
export function doppelteSelektoren(scss) {
  const ohneKommentare = scss.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  const gesehen = new Map()
  const doppelt = []
  const stapel = []
  let puffer = ''
  for (const zeichen of ohneKommentare) {
    if (zeichen === '{') {
      const kopf = puffer.trim().replace(/\s+/g, ' ')
      puffer = ''
      const regelEbene = stapel.every(eintrag => eintrag.startsWith('@media'))
      if (kopf.startsWith('@media') && regelEbene) {
        stapel.push(kopf)
      } else if (kopf.startsWith('@') || !regelEbene) {
        stapel.push('verschachtelt')
      } else {
        const kontext = stapel.join(' ')
        for (const selektor of kopf.split(',').map(s => s.trim())) {
          const schluessel = `${kontext}|${selektor}`
          if (gesehen.has(schluessel)) doppelt.push(kontext ? `${kontext} ${selektor}` : selektor)
          gesehen.set(schluessel, true)
        }
        stapel.push('regel')
      }
    } else if (zeichen === '}') {
      stapel.pop()
      puffer = ''
    } else if (zeichen === ';') {
      puffer = ''
    } else {
      puffer += zeichen
    }
  }
  return doppelt
}

test('farbenAusserhalbBenannterWerte erkennt Zahlenwerte und lässt benannte Werte stehen', () => {
  const scss = '$spur-schatten: rgb(0 0 0 / 20%);\n.a {\n  color: #fff;\n  background: var(--x);\n}\n// #abc im Kommentar\n'
  assert.deepEqual(farbenAusserhalbBenannterWerte(scss), ['3: color: #fff;'])
})

test('doppelteSelektoren findet Selektoren, die zweimal auf derselben Ebene stehen', () => {
  const scss = '.a, .b { x: 1; }\n.b { y: 2; .c { z: 1; } }\n.c { z: 2; }\n@media (max-width: 1px) { .a { x: 2; } }\n'
  assert.deepEqual(doppelteSelektoren(scss), ['.b'])
})

test('spur.scss nennt Farben nur als benannte Werte', () => {
  assert.deepEqual(farbenAusserhalbBenannterWerte(SCSS), [])
})

test('spur.scss definiert keine Klasse doppelt', () => {
  assert.deepEqual(doppelteSelektoren(SCSS), [])
})

const DOPPELTE_SCHLUESSEL = [
  'spur_schliessen',
  'spur_speichern',
  'spur_workflow_speichern',
  'spur_kopieren',
  'spur_kopiert',
]

function dateien(pfad) {
  if (!statSync(pfad).isDirectory()) return [pfad]
  return readdirSync(pfad).flatMap(name => dateien(join(pfad, name)))
}

test('Schließen, Speichern und Kopieren kommen je aus einem Sprachschlüssel', () => {
  for (const sprache of ['de', 'en']) {
    const texte = JSON.parse(readFileSync(join(WEB, `locales/${sprache}.json`), 'utf8'))
    assert.deepEqual(
      DOPPELTE_SCHLUESSEL.filter(schluessel => schluessel in texte),
      [],
      `${sprache}.json`
    )
  }
  const code = dateien(join(WEB, 'modules/spur/frontend/js'))
    .filter(datei => /\.(tsx?|js)$/.test(datei))
    .filter(datei => DOPPELTE_SCHLUESSEL.some(s => readFileSync(datei, 'utf8').includes(`'${s}'`)))
  assert.deepEqual(code, [])
})

// Ein ladender OLButton ist `disabled` und verliert den Fokus; spur baut ladende Knöpfe darum über LadeKnopf.
export function ladendeOLButtons(quelltext) {
  return [...quelltext.matchAll(/<OLButton\b[^>]*?\bisLoading=/gs)].length
}

test('ladendeOLButtons findet isLoading auch über mehrere Zeilen und lässt andere Knöpfe stehen', () => {
  assert.equal(ladendeOLButtons('<OLButton\n  variant="primary"\n  isLoading={x}\n>'), 1)
  assert.equal(ladendeOLButtons('<OLButton onClick={f}>a</OLButton><LadeKnopf isLoading={x} />'), 0)
})

test('spur nutzt für ladende Knöpfe LadeKnopf statt OLButton', () => {
  const treffer = dateien(join(WEB, 'modules/spur/frontend/js'))
    .filter(datei => /\.tsx$/.test(datei) && !datei.endsWith('/lade-knopf.tsx'))
    .filter(datei => ladendeOLButtons(readFileSync(datei, 'utf8')) > 0)
  assert.deepEqual(treffer, [])
})
