import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'
import OLButton, { type OLButtonProps } from '@/shared/components/ol/ol-button'

// Overleafs Knopf ist gesperrt, solange er lädt, und der Browser lässt dabei den Fokus auf die Seite fallen.
// Hatte der Knopf den Fokus, bekommt er ihn nach dem Laden zurück, sofern niemand ihn inzwischen woanders hingesetzt hat.
// `tools/tests/oberflaeche.test.mjs` sorgt dafür, dass spur ladende Knöpfe nur über diesen Baustein baut.
const LadeKnopf = forwardRef<HTMLButtonElement, OLButtonProps>(({ isLoading = false, ...props }, ref) => {
  const eigen = useRef<HTMLButtonElement>(null)
  const hatteFokus = useRef(false)
  useImperativeHandle(ref, () => eigen.current!, [])

  // Beim Rendern steht das alte DOM noch: Hier hat der Knopf den Fokus noch, bevor `disabled` ihn nimmt.
  if (isLoading) hatteFokus.current ||= eigen.current !== null && document.activeElement === eigen.current

  useEffect(() => {
    if (isLoading || !hatteFokus.current) return
    hatteFokus.current = false
    const frei = document.activeElement === null || document.activeElement === document.body
    if (eigen.current?.isConnected && frei) eigen.current.focus()
  }, [isLoading])

  return <OLButton {...props} isLoading={isLoading} ref={eigen} />
})

LadeKnopf.displayName = 'LadeKnopf'

export default LadeKnopf
