import { createRequire } from 'node:module'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

// Dieselbe Auflösung wie in sendSchutz.mjs: die send-Fassungen, die Express und serve-static nutzen.
const ausExpress = createRequire(createRequire(import.meta.url).resolve('express'))
const serveStatic = createRequire(ausExpress.resolve('serve-static'))
const prototypen = [...new Set([ausExpress('send'), serveStatic('send')])].map(
  send => send.SendStream?.prototype ?? Object.getPrototypeOf(send({ headers: {} }, '/'))
)
const urspruenglich = prototypen.map(proto => proto.stream)

let original

beforeEach(async () => {
  // Stellt das, was Overleafs gepatchtes send unter Node 24 tut: Pipe in eine schon abgebrochene Antwort wirft.
  original = vi.fn(() => 'gesendet')
  for (const proto of prototypen) proto.stream = original
  vi.resetModules()
  await import('../../app/src/sendSchutz.mjs')
})
afterAll(() => {
  prototypen.forEach((proto, i) => (proto.stream = urspruenglich[i]))
})

const sendStream = (proto, res) => Object.assign(Object.create(proto), { res })
const abbruch = () => Object.assign(new Error('Cannot pipe to a closed or destroyed stream'), { code: 'ERR_STREAM_UNABLE_TO_PIPE' })

describe('Download-Schutz für statische Dateien', () => {
  it('streamt nicht in eine Antwort, die der Browser schon abgebrochen hat', () => {
    for (const proto of prototypen) {
      expect(sendStream(proto, { destroyed: true }).stream('/js/app.js', {})).toBeUndefined()
    }
    expect(original).not.toHaveBeenCalled()
  })

  it('streamt auch nicht in eine Antwort, die schon beendet ist', () => {
    for (const proto of prototypen) {
      expect(sendStream(proto, { destroyed: false, writableEnded: true }).stream('/js/app.js', {})).toBeUndefined()
    }
    expect(original).not.toHaveBeenCalled()
  })

  it('fängt den späten Wurf ab, wenn der Browser mitten im Start abbricht', () => {
    original.mockImplementation(() => {
      throw abbruch()
    })
    for (const proto of prototypen) {
      const strom = sendStream(proto, { destroyed: false, writableEnded: false })
      expect(() => strom.stream('/js/app.js', {})).not.toThrow()
    }
  })

  it('reicht andere Fehler weiter', () => {
    original.mockImplementation(() => {
      throw new Error('Platte kaputt')
    })
    const strom = sendStream(prototypen[0], { destroyed: false, writableEnded: false })
    expect(() => strom.stream('/js/app.js', {})).toThrow('Platte kaputt')
  })

  it('sendet eine offene Antwort unverändert mit Pfad und Optionen', () => {
    const res = { destroyed: false, writableEnded: false }
    const strom = sendStream(prototypen[0], res)
    expect(strom.stream('/js/app.js', { start: 5 })).toBe('gesendet')
    expect(original).toHaveBeenCalledWith('/js/app.js', { start: 5 })
    expect(original.mock.contexts[0]).toBe(strom)
  })
})
