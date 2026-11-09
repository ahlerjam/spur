import { meldung } from '../meldungen.mjs'

export class WerkzeugFehler extends Error {
  constructor(code, schluessel, werte) {
    super(meldung(schluessel, werte))
    this.code = code
  }
}
