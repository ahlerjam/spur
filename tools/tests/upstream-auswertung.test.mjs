// node --test tools/tests
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { auswerten, herkunftBestimmen, zusammenfassung } from './upstream-auswertung.mjs'

const t = (datei, name, status, fehler = '') => ({ suite: 'web', datei, test: name, status, fehler })
const b = (datei, name, herkunft = 'overleaf', grund = 'Grund.') => ({ suite: 'web', datei, test: name, herkunft, grund })

test('trennt bekannte von neuen Fehlern', () => {
  const a = auswerten(
    [t('a.mjs', 'x', 'passed'), t('a.mjs', 'y', 'failed'), t('b.mjs', 'z', 'failed', 'kaputt'), t('b.mjs', 's', 'skipped')],
    [b('a.mjs', 'y')]
  )
  assert.equal(a.bestanden, 1)
  assert.equal(a.fehlgeschlagen, 2)
  assert.equal(a.bekannt, 1)
  assert.deepEqual(a.neu.map(x => x.test), ['z'])
  assert.equal(zusammenfassung(a), 'bestanden: 1, fehlgeschlagen: 2, bekannt: 1, neu: 1')
})

test('meldet bekannte Tests, die grün sind, ohne sie als Fehler zu zählen', () => {
  const a = auswerten([t('a.mjs', 'y', 'passed')], [b('a.mjs', 'y'), b('a.mjs', 'fehlt')])
  assert.deepEqual(a.jetztGruen.map(x => x.test), ['y'])
  assert.equal(a.neu.length, 0)
  assert.equal(zusammenfassung(a), 'bestanden: 1, fehlgeschlagen: 0, bekannt: 0, neu: 0')
})

test('Herkunft: zuerst main, dann ext-ce; nur auf spur ist kein Listeneintrag', () => {
  const main = [t('a.mjs', 'o', 'failed', 'm'), t('a.mjs', 'c', 'passed'), t('a.mjs', 's', 'passed')]
  const ext = [t('a.mjs', 'o', 'failed'), t('a.mjs', 'c', 'failed', 'cep'), t('a.mjs', 's', 'passed'), t('e.mjs', 'n', 'failed', 'neu in cep')]
  const agent = [
    t('a.mjs', 'o', 'failed', 'Fehler o'),
    t('a.mjs', 'c', 'failed', 'Fehler c'),
    t('a.mjs', 's', 'failed', 'Fehler s'),
    t('e.mjs', 'n', 'failed', 'Fehler n'),
    t('a.mjs', 'g', 'passed'),
  ]
  const { liste, nurSpur } = herkunftBestimmen(main, ext, agent, [b('a.mjs', 'o', 'overleaf', 'Alter Grund.')])
  assert.deepEqual(
    liste.map(x => [x.test, x.herkunft, x.grund]),
    [
      ['o', 'overleaf', 'Alter Grund.'],
      ['c', 'overleaf-cep', 'Fehler c'],
      ['n', 'overleaf-cep', 'Fehler n'],
    ]
  )
  assert.deepEqual(nurSpur.map(x => x.test), ['s'])
})

test('Dateien der Ausschlussliste kommen nicht auf die Liste', () => {
  const lauf = [t('a.mjs', 'x', 'failed', 'f'), t('b.mjs', 'y', 'failed', 'f')]
  const { liste, nurSpur } = herkunftBestimmen(lauf, lauf, lauf, [], [{ suite: 'web', datei: 'a.mjs', grund: 'Pro.' }])
  assert.deepEqual(liste.map(x => x.datei), ['b.mjs'])
  assert.equal(nurSpur.length, 0)
})

test('Grund aus bekanntem Fehlerbild, sonst erste Fehlerzeile', () => {
  const agent = [
    t('a.mjs', 'x', 'failed', 'Error: Cannot find module \'oauth2-server\'\n  at …'),
    t('a.mjs', 'y', 'failed', '\nAssertionError: expected 1 to equal 2\n  at …'),
  ]
  const { liste } = herkunftBestimmen(agent, agent, agent, [])
  assert.match(liste[0].grund, /^[^\n]+$/)
  assert.equal(liste[1].grund, 'AssertionError: expected 1 to equal 2')
})
