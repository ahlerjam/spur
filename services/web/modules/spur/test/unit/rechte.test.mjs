import { beforeEach, describe, expect, it, vi } from 'vitest'
import { berechtigung } from './hilfen/berechtigung.mjs'

const ANNA = '65a000000000000000000001'
const ADMIN = '65a000000000000000000002'
const PROJEKT = '65b000000000000000000001'
const FREMD = '65b000000000000000000002'

let rechte
let recht

beforeEach(async () => {
  recht = berechtigung()
  vi.resetModules()
  recht.anmelden(vi)
  rechte = await import('../../app/src/rechte.mjs')
})

describe('rolleFuerClaude', () => {
  it.each(['readOnly', 'review', 'readAndWrite', 'owner'])('gibt die Stufe %s eines Mitglieds weiter', async stufe => {
    recht.vergeben(ANNA, PROJEKT, { stufe })
    expect(await rechte.rolleFuerClaude(ANNA, PROJEKT)).toBe(stufe)
  })

  it('gibt keine Rolle in einem Projekt ohne Zugriff', async () => {
    recht.projektOhneRechte(FREMD)
    expect(await rechte.rolleFuerClaude(ANNA, FREMD)).toBeNull()
  })

  it('gibt einem Admin kein Sonderrecht in fremden Projekten', async () => {
    recht.stand.admins.add(ADMIN)
    recht.projektOhneRechte(FREMD)
    expect(await rechte.rolleFuerClaude(ADMIN, FREMD)).toBeNull()
  })

  it('behandelt ein unbekanntes Projekt wie ein fremdes, auch für Admins', async () => {
    recht.stand.admins.add(ADMIN)
    expect(await rechte.rolleFuerClaude(ADMIN, FREMD)).toBeNull()
    expect(await rechte.rolleFuerClaude(ANNA, FREMD)).toBeNull()
  })

  it('zählt einen reinen Leselink nicht, auch nicht für Admins', async () => {
    recht.vergeben(ANNA, PROJEKT, { stufe: 'readOnly', tokenMember: true, invited: false })
    recht.vergeben(ADMIN, PROJEKT, { stufe: 'readOnly', tokenMember: true, invited: false })
    recht.stand.admins.add(ADMIN)
    expect(await rechte.rolleFuerClaude(ANNA, PROJEKT)).toBeNull()
    expect(await rechte.rolleFuerClaude(ADMIN, PROJEKT)).toBeNull()
  })

  it('lässt Lesen zu, wenn jemand eingeladen ist und zusätzlich den Leselink hat', async () => {
    recht.vergeben(ANNA, PROJEKT, { stufe: 'readOnly', tokenMember: true, invited: true })
    expect(await rechte.rolleFuerClaude(ANNA, PROJEKT)).toBe('readOnly')
  })

  it('reicht unerwartete Fehler weiter', async () => {
    vi.resetModules()
    vi.doMock('../../../../app/src/Features/Authorization/AuthorizationManager.mjs', () => ({
      default: { promises: { getPrivilegeLevelForProject: async () => Promise.reject(new Error('Mongo weg')) } },
    }))
    const neu = await import('../../app/src/rechte.mjs')
    let fehler
    try {
      await neu.rolleFuerClaude(ANNA, PROJEKT)
    } catch (e) {
      fehler = e
    }
    expect(fehler.message).toBe('Mongo weg')
  })
})

describe('rolleImVertrag', () => {
  it('benennt die Stufen nach dem MCP-Vertrag', () => {
    expect(['readOnly', 'review', 'readAndWrite', 'owner'].map(rechte.rolleImVertrag)).toEqual([
      'read',
      'review',
      'write',
      'owner',
    ])
    expect(rechte.rolleImVertrag(null)).toBeNull()
  })
})
