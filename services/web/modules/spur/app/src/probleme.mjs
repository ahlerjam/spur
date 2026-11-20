import { meldung } from './meldungen.mjs'

// Fehler nach RFC 9457. Der Typ bleibt je Fehlerklasse stabil; der Text kommt aus den Sprachdateien.
export class Problem extends Error {
  // zusatz: weitere Felder der Antwort (RFC 9457, extension members), etwa `versucht` bei pdf_fehlt.
  constructor(status, typ, schluessel, werte, zusatz) {
    super(meldung(schluessel, werte))
    this.status = status
    this.typ = typ
    this.zusatz = zusatz
  }
}

export function problemSenden(res, problem) {
  res
    .status(problem.status)
    .type('application/problem+json')
    .json({
      // Zusatzfelder zuerst: Sie dürfen die Kernfelder nach RFC 9457 nicht überschreiben.
      ...problem.zusatz,
      type: `urn:spur:problem:${problem.typ}`,
      title: problem.typ,
      status: problem.status,
      detail: problem.message,
    })
}

export function mitProblemen(handler) {
  return async (req, res, next) => {
    try {
      await handler(req, res)
    } catch (error) {
      if (error instanceof Problem) problemSenden(res, error)
      else next(error)
    }
  }
}
