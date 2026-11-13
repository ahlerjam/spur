import { expect } from 'chai'
import { useState } from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import LadeKnopf from '@modules/spur/frontend/js/lade-knopf'

function Formular({ dauer }: { dauer: Promise<void> }) {
  const [laedt, setLaedt] = useState(false)
  return (
    <>
      <LadeKnopf
        variant="primary"
        isLoading={laedt}
        onClick={async () => {
          setLaedt(true)
          await dauer
          setLaedt(false)
        }}
      >
        Speichern
      </LadeKnopf>
      <button type="button">Anderes</button>
      <p>Text</p>
    </>
  )
}

// Chrome lässt den Fokus von einem gesperrten Knopf auf die Seite fallen; jsdom nicht. Das holen die Tests nach.
function fokusFaellt() {
  document.body.tabIndex = -1
  document.body.focus()
  document.body.removeAttribute('tabindex')
}

function starten() {
  let fertig = () => {}
  render(<Formular dauer={new Promise<void>(resolve => { fertig = resolve })} />)
  const knopf = screen.getByRole('button', { name: 'Speichern' })
  knopf.focus()
  fireEvent.click(knopf)
  return { knopf, fertig }
}

describe('LadeKnopf', function () {
  it('gibt den Fokus nach dem Laden an den Knopf zurück', async function () {
    const { knopf, fertig } = starten()
    await waitFor(() => expect(knopf).to.have.property('disabled', true))
    fokusFaellt()
    expect(document.activeElement).to.equal(document.body)
    fertig()
    await waitFor(() => expect(knopf).to.have.property('disabled', false))
    await waitFor(() => expect(document.activeElement).to.equal(knopf))
  })

  it('nimmt den Fokus nicht, wenn man inzwischen woanders ist', async function () {
    const { knopf, fertig } = starten()
    await waitFor(() => expect(knopf).to.have.property('disabled', true))
    const anderes = screen.getByRole('button', { name: 'Anderes' })
    anderes.focus()
    fertig()
    await waitFor(() => expect(knopf).to.have.property('disabled', false))
    expect(document.activeElement).to.equal(anderes)
  })

  it('nimmt den Fokus nicht, wenn man während des Ladens in den Text geklickt hat', async function () {
    const { knopf, fertig } = starten()
    await waitFor(() => expect(knopf).to.have.property('disabled', true))
    fokusFaellt()
    fireEvent.pointerDown(screen.getByText('Text'))
    fertig()
    await waitFor(() => expect(knopf).to.have.property('disabled', false))
    expect(document.activeElement).to.equal(document.body)
  })

  it('reicht die Referenz weiter', function () {
    let referenz: HTMLButtonElement | null = null
    render(
      <LadeKnopf ref={el => { referenz = el }} variant="secondary">
        Knopf
      </LadeKnopf>
    )
    expect(referenz).to.equal(screen.getByRole('button', { name: 'Knopf' }))
  })
})
