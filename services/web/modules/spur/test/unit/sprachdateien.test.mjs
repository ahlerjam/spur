import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const laden = sprache =>
  JSON.parse(readFileSync(new URL(`../../../../locales/${sprache}.json`, import.meta.url), 'utf8'))
const de = laden('de')
const en = laden('en')
const spur = sprache => Object.keys(sprache).filter(k => k.startsWith('spur_'))
const platzhalter = text => [...text.matchAll(/__(\w+)__/g)].map(m => m[1]).sort()

describe('Sprachdateien', () => {
  it('jeder spur-Schlüssel steht in de.json und en.json', () => {
    expect(spur(de).filter(k => !(k in en))).toEqual([])
    expect(spur(en).filter(k => !(k in de))).toEqual([])
  })

  it('Platzhalter sind in beiden Sprachen gleich', () => {
    const abweichend = spur(de)
      .filter(k => k in en)
      .filter(k => platzhalter(de[k]).join() !== platzhalter(en[k]).join())
    expect(abweichend).toEqual([])
  })

  it('kein deutscher spur-Text siezt', () => {
    const anrede = /\b(Sie|Ihr|Ihre|Ihren|Ihrem|Ihrer|Ihres|Ihnen)\b/
    const siezend = spur(de)
      .filter(k => anrede.test(de[k]))
      .map(k => `${k}: ${de[k]}`)
    expect(siezend).toEqual([])
  })
})
