export const VERSUCHE = 3
const PAUSEN_MS = [1000, 2000, 4000]
const RETRY_AFTER_MAX_MS = 10000

// Pause vor dem nächsten Versuch: wie der Server mit Retry-After (Sekunden) verlangt, höchstens 10 s; sonst 1, 2, 4 s.
export function pauseMs(retryAfter, versuch) {
  const sekunden = retryAfter == null || retryAfter === '' ? NaN : Number(retryAfter)
  if (Number.isFinite(sekunden) && sekunden >= 0) return Math.min(sekunden * 1000, RETRY_AFTER_MAX_MS)
  return PAUSEN_MS[Math.min(versuch, PAUSEN_MS.length) - 1]
}
