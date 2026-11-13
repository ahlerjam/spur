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
    </>
  )
}

describe('LadeKnopf', function () {
  it('gibt den Fokus nach dem Laden an den Knopf zurück', async function () {
    let fertig = () => {}
    render(<Formular dauer={new Promise<void>(resolve => { fertig = resolve })} />)
    const knopf = screen.getByRole('button', { name: 'Speichern' })
    knopf.focus()
    fireEvent.click(knopf)
    await waitFor(() => expect(knopf).to.have.property('disabled', true))
    // Der Browser lässt den Fokus von einem gesperrten Knopf fallen.
    knopf.blur()
    fertig()
    await waitFor(() => expect(knopf).to.have.property('disabled', false))
    await waitFor(() => expect(document.activeElement).to.equal(knopf))
  })

  it('nimmt den Fokus nicht, wenn man inzwischen woanders ist', async function () {
    let fertig = () => {}
    render(<Formular dauer={new Promise<void>(resolve => { fertig = resolve })} />)
    const knopf = screen.getByRole('button', { name: 'Speichern' })
    knopf.focus()
    fireEvent.click(knopf)
    await waitFor(() => expect(knopf).to.have.property('disabled', true))
    const anderes = screen.getByRole('button', { name: 'Anderes' })
    anderes.focus()
    fertig()
    await waitFor(() => expect(knopf).to.have.property('disabled', false))
    expect(document.activeElement).to.equal(anderes)
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
