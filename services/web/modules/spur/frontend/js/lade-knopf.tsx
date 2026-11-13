import { forwardRef, type MouseEvent, useEffect, useImperativeHandle, useRef } from 'react'
import OLButton, { type OLButtonProps } from '@/shared/components/ol/ol-button'

// Overleafs Knopf ist gesperrt, solange er lädt, und der Browser lässt dabei den Fokus auf die Seite fallen.
// Hatte der Knopf beim Auslösen den Fokus, bekommt er ihn nach dem Laden zurück, außer man hat inzwischen woanders
// hingeklickt oder den Fokus selbst versetzt.
// `tools/tests/oberflaeche.test.mjs` sorgt dafür, dass spur ladende Knöpfe nur über diesen Baustein baut.
const LadeKnopf = forwardRef<HTMLButtonElement, OLButtonProps>(({ isLoading = false, onClick, ...props }, ref) => {
  const eigen = useRef<HTMLButtonElement>(null)
  const hatteFokus = useRef(false)
  useImperativeHandle(ref, () => eigen.current!, [])

  const ausloesen = (event: MouseEvent<HTMLButtonElement>) => {
    hatteFokus.current = document.activeElement === eigen.current
    onClick?.(event)
  }

  useEffect(() => {
    if (isLoading) {
      const woanders = (event: PointerEvent) => {
        if (event.target !== eigen.current) hatteFokus.current = false
      }
      document.addEventListener('pointerdown', woanders, true)
      return () => document.removeEventListener('pointerdown', woanders, true)
    }
    if (!hatteFokus.current) return
    hatteFokus.current = false
    const frei = document.activeElement === null || document.activeElement === document.body
    if (eigen.current?.isConnected && frei) eigen.current.focus()
  }, [isLoading])

  return <OLButton {...props} onClick={ausloesen} isLoading={isLoading} ref={eigen} />
})

LadeKnopf.displayName = 'LadeKnopf'

export default LadeKnopf
