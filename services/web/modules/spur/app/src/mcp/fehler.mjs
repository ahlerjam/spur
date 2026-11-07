export class WerkzeugFehler extends Error {
  constructor(code, detail) {
    super(detail)
    this.code = code
  }
}
