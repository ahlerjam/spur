import { beforeEach, describe, expect, it, vi } from 'vitest'

const BASIS = '../../../admin-tools/app/src/ActivationLink.mjs'
const ID = '64b000000000000000000001'
let konfiguriert
let gesendet
let nutzer
let Link

beforeEach(async () => {
  vi.resetModules()
  konfiguriert = false
  gesendet = []
  nutzer = { email: 'neu-p7@example.org' }
  let n = 0
  vi.doMock('@overleaf/logger', () => ({ default: { warn: () => {} } }))
  vi.doMock('@overleaf/settings', () => ({ default: { siteUrl: 'https://spur.example.org' } }))
  vi.doMock('../../../../app/src/models/User.mjs', () => ({
    User: { findById: () => ({ lean: async () => nutzer }) },
  }))
  vi.doMock('../../../../app/src/Features/Security/OneTimeTokenHandler.mjs', () => ({
    default: { promises: { getNewToken: async () => `token${++n}` } },
  }))
  vi.doMock('../../../../app/src/Features/Email/EmailHandler.mjs', () => ({
    default: { promises: { sendEmail: async (art, optionen) => gesendet.push({ art, ...optionen }) } },
  }))
  vi.doMock('../../../../app/src/Features/Email/EmailConfiguration.mjs', () => ({
    emailIsConfigured: () => konfiguriert,
  }))
  Link = await import(BASIS)
})

describe('Einladungslink', () => {
  it('gibt ohne Mail-Einrichtung den Link zurück und schickt nichts', async () => {
    const ergebnis = await Link.inviteUser(ID)
    expect(ergebnis).toEqual({
      activationUrl: `https://spur.example.org/user/activate?token=token1&user_id=${ID}`,
      emailSent: false,
    })
    expect(gesendet).toEqual([])
  })

  it('schickt mit Mail-Einrichtung die Mail und gibt den Link trotzdem zurück', async () => {
    konfiguriert = true
    const ergebnis = await Link.inviteUser(ID)
    expect(ergebnis.emailSent).toBe(true)
    expect(gesendet).toEqual([
      { art: 'registered', to: 'neu-p7@example.org', setNewPasswordUrl: ergebnis.activationUrl },
    ])
  })

  it('gibt den Link auch zurück, wenn der Versand scheitert', async () => {
    konfiguriert = true
    gesendet = { push: () => Promise.reject(new Error('SMTP aus')) }
    const ergebnis = await Link.inviteUser(ID)
    expect(ergebnis.emailSent).toBe(false)
    expect(ergebnis.activationUrl).toMatch(/\/user\/activate\?token=token1/)
  })

  it('erzeugt bei jedem Aufruf einen neuen Link', async () => {
    const erster = await Link.createActivationLink(ID)
    const zweiter = await Link.createActivationLink(ID)
    expect(erster).not.toBe(zweiter)
  })

  it('meldet ein unbekanntes Konto', async () => {
    nutzer = null
    const fehler = await Link.createActivationLink(ID).catch(e => e)
    expect(fehler.message).toMatch(/does not exist/)
  })
})
