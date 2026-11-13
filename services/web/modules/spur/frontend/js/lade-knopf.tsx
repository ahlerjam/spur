import { forwardRef, useEffect, useRef } from 'react'
import OLButton, { type OLButtonProps } from '@/shared/components/ol/ol-button'

// Overleafs Knopf ist gesperrt, solange er lädt, und der Browser lässt dabei den Fokus auf die Seite fallen.
// Hatte der Knopf den Fokus, bekommt er ihn nach dem Laden zurück, sofern niemand ihn inzwischen woanders hingesetzt hat.
const LadeKnopf = forwardRef<HTMLButtonElement, OLButtonProps>(({ isLoading = false, ...props }, ref) => {
  const eigen = useRef<HTMLButtonElement | null>(null)
  const laedtZuletzt = useRef(false)
  const hatteFokus = useRef(false)

  // Beim Rendern steht das alte DOM noch: Hier hat der Knopf den Fokus noch, bevor `disabled` ihn nimmt.
  if (isLoading && !laedtZuletzt.current) hatteFokus.current = eigen.current !== null && document.activeElement === eigen.current
  laedtZuletzt.current = isLoading

  useEffect(() => {
    if (isLoading || !hatteFokus.current) return
    hatteFokus.current = false
    const knopf = eigen.current
    const frei = document.activeElement === null || document.activeElement === document.body
    if (knopf?.isConnected && frei) knopf.focus()
  }, [isLoading])

  return (
    <OLButton
      {...props}
      isLoading={isLoading}
      ref={el => {
        eigen.current = el
        if (typeof ref === 'function') ref(el)
        else if (ref) ref.current = el
      }}
    />
  )
})

LadeKnopf.displayName = 'LadeKnopf'

export default LadeKnopf
