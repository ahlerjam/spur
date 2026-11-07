import { Writable } from 'node:stream'

// Antwort-Attrappe, die sich wie Express' res verhält und zugleich ein Writable ist (für pipeline).
export class Antwort extends Writable {
  constructor({ schreiben } = {}) {
    super({ write: schreiben ?? ((stueck, _kodierung, weiter) => (this.inhalt.push(stueck), weiter())) })
    this.inhalt = []
    this.kopfzeilen = {}
    this.statusCode = 200
    this.body = undefined
  }

  status(code) {
    this.statusCode = code
    return this
  }

  type(art) {
    this.kopfzeilen['Content-Type'] = art
    return this
  }

  attachment(name) {
    this.kopfzeilen['Content-Disposition'] = `attachment; filename="${name}"`
    return this
  }

  setHeader(name, wert) {
    this.kopfzeilen[name] = wert
    return this
  }

  json(daten) {
    this.body = daten
    return this
  }

  sendStatus(code) {
    this.statusCode = code
    return this
  }
}

export const anfrage = (felder = {}) => ({ params: {}, query: {}, body: {}, session: {}, ...felder })
