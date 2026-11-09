import { meldung } from './meldungen.mjs'

// Fehler nach RFC 9457. Der Typ bleibt je Fehlerklasse stabil; der Text kommt aus den Sprachdateien.
export class Problem extends Error {
  constructor(status, typ, schluessel, werte) {
    super(meldung(schluessel, werte))
    this.status = status
    this.typ = typ
  }
}

export function problemSenden(res, problem) {
  res
    .status(problem.status)
    .type('application/problem+json')
    .json({
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
