import { expect } from 'chai'
import sinon from 'sinon'
import { fireEvent, render, screen } from '@testing-library/react'
import EinladungsLink from '@modules/spur/frontend/js/einladung/einladungs-link'
import { deutschAktivieren } from './helpers/deutsch'

const URL = 'http://localhost:8080/user/activate?token=abc&user_id=1'

describe('Einladungslink', function () {
  deutschAktivieren()

  // jsdom kennt navigator.clipboard nicht; jeder Test setzt es selbst.
  const zwischenablage = (wert: unknown) =>
    Object.defineProperty(navigator, 'clipboard', { value: wert, configurable: true })

  afterEach(function () {
    sinon.restore()
    zwischenablage(undefined)
  })

  it('sagt ohne Mail, dass der Admin den Link selbst weitergibt, und kopiert ihn', async function () {
    const schreiben = sinon.stub().resolves()
    zwischenablage({ writeText: schreiben })
    render(<EinladungsLink url={URL} perMail={false} />)
    screen.getByText('E-Mail ist nicht eingerichtet – gib den Link selbst weiter.')
    expect(screen.getByLabelText<HTMLInputElement>('Einladungslink').value).to.equal(URL)
    fireEvent.click(screen.getByRole('button', { name: 'Kopieren' }))
    await screen.findByRole('button', { name: 'Kopiert' })
    expect(schreiben.calledWith(URL)).to.equal(true)
  })

  it('nennt den Mailversand und lässt den Link kopierbar', function () {
    render(<EinladungsLink url={URL} perMail />)
    screen.getByText('Einladung per E-Mail verschickt')
    screen.getByRole('button', { name: 'Kopieren' })
  })

  it('kopiert ohne Clipboard-API über die Auswahl im Feld', async function () {
    zwischenablage(undefined)
    const befehl = sinon.stub().returns(true)
    Object.defineProperty(document, 'execCommand', { value: befehl, configurable: true })
    render(<EinladungsLink url={URL} perMail={false} />)
    fireEvent.click(screen.getByRole('button', { name: 'Kopieren' }))
    await screen.findByRole('button', { name: 'Kopiert' })
    expect(befehl.calledWith('copy')).to.equal(true)
  })
})
