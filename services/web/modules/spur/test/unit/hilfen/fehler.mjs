// Fängt den Fehler eines Aufrufs. `expect(...).rejects` taugt hier nicht: Overleafs Bootstrap
// lädt chai-as-promised, das die Prüfung auf dem Promise statt auf dem Fehler ausführt.
export async function fehlerVon(aufruf) {
  try {
    await (typeof aufruf === 'function' ? aufruf() : aufruf)
  } catch (error) {
    return error
  }
  throw new Error('Es wurde kein Fehler geworfen')
}
