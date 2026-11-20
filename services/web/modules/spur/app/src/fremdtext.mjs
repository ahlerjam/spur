import _ from 'lodash'
import sanitizeHtml from 'sanitize-html'

// Bereinigtes HTML nur mit den erlaubten Tags. sanitize-html löst alle Entities auf und maskiert im Text danach nur
// &, <, > und " wieder; textAus macht das rückgängig.
export const ohneTags = (html, allowedTags = []) => sanitizeHtml(html, { allowedTags, allowedAttributes: {} })
export const textAus = bereinigt => _.unescape(bereinigt)

// Crossref liefert Titel und Namen mit HTML-Entities und Tags (`&amp;`, `<i>`, `<sub>`). Ungültige Zeichennummern
// werden zu U+FFFD, das pdfLaTeX nicht setzen kann: weglassen. Ohne & und < gibt es nichts aufzulösen.
export const klartext = html => (/[&<]/.test(html) ? textAus(ohneTags(html)).replace(/�/g, '') : html).trim()
