import nodemailer from 'nodemailer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Antwort, anfrage } from './hilfen/express.mjs'

let Settings

beforeEach(() => {
  vi.resetModules()
  Settings = {}
  vi.doMock('@overleaf/settings', () => ({ default: Settings }))
})

describe('emailIsConfigured', () => {
  const pruefen = async email => {
    Settings.email = email
    const { emailIsConfigured } = await import('../../../../app/src/Features/Email/EmailConfiguration.mjs')
    return emailIsConfigured()
  }

  it('braucht Absender und Transport', async () => {
    expect(await pruefen(undefined)).toBe(false)
    expect(await pruefen({ fromAddress: 'spur@example.org', parameters: {} })).toBe(false)
    expect(await pruefen({ parameters: { host: 'smtp.example.org' } })).toBe(false)
    expect(await pruefen({ fromAddress: 'spur@example.org', parameters: { host: 'smtp.example.org' } })).toBe(true)
  })

  it('erkennt SES als Transport', async () => {
    expect(await pruefen({ fromAddress: 'a@b.org', parameters: { AWSAccessKeyID: 'k' } })).toBe(true)
    expect(await pruefen({ fromAddress: 'a@b.org', driver: 'ses', parameters: {} })).toBe(true)
  })
})

describe('Mail-Fake', () => {
  let Fake

  beforeEach(async () => {
    Fake = await import('../../app/src/dev/MailFake.mjs')
  })

  afterEach(async () => {
    await Fake.mailFakeAus()
  })

  const steuern = async an => {
    const res = new Antwort()
    await Fake.mailFakeSteuern(anfrage({ body: { an } }), res)
    return res
  }

  const gelesen = () => {
    const res = new Antwort()
    Fake.mailFakeLesen(anfrage(), res)
    return res.body
  }

  it('richtet Mail auf einen lokalen SMTP-Empfänger ein und nimmt Mails an', async () => {
    const original = { fromAddress: 'echt@example.org', parameters: { host: 'echt' } }
    Settings.email = original
    expect((await steuern(true)).statusCode).toBe(204)
    expect(Settings.email.fromAddress).toBe('spur@example.org')
    const { host, port } = Settings.email.parameters
    await nodemailer
      .createTransport({ host, port, ignoreTLS: true })
      .sendMail({ from: 'spur@example.org', to: 'neu@example.org', subject: 'Hallo', text: 'Zeile' })
    const { mails } = gelesen()
    expect(mails).toHaveLength(1)
    expect(mails[0].an).toEqual(['neu@example.org'])
    expect(mails[0].text).toContain('Subject: Hallo')

    expect((await steuern(false)).statusCode).toBe(204)
    expect(Settings.email).toBe(original)
    expect(gelesen().mails).toEqual([])
  })

  it('lehnt Unsinn ab', async () => {
    expect((await steuern('ja')).statusCode).toBe(422)
  })
})
