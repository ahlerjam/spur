import { stringify } from 'csv-stringify/sync'

// Tabellenprogramme führen Zellen mit =, +, - oder @ am Anfang als Formel aus.
const formel = wert => typeof wert === 'string' && /^[=+\-@\t\r]/.test(wert)

export function csv(spalten, zeilen) {
  return stringify(
    zeilen.map(zeile => zeile.map(wert => (formel(wert) ? `'${wert}` : wert))),
    { header: true, columns: spalten }
  )
}
