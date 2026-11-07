const istWort = zeichen => zeichen !== undefined && /[\p{L}\p{N}_]/u.test(zeichen)

// Kleinste Änderung in ganzen Wörtern: gemeinsamer Anfang und gemeinsames Ende bleiben unangetastet,
// aber die Grenze liegt nie mitten im Wort. Sonst zeigten Editor, Review-Panel und Lauf-Karte
// Bruchstücke wie „mit altem Wor“ → „geglätte“.
export function opsFuer(start, alt, neu) {
  let vorn = 0
  while (vorn < alt.length && vorn < neu.length && alt[vorn] === neu[vorn]) vorn++
  while (vorn > 0 && istWort(alt[vorn - 1]) && (istWort(alt[vorn]) || istWort(neu[vorn]))) vorn--
  let hinten = 0
  while (
    hinten < alt.length - vorn &&
    hinten < neu.length - vorn &&
    alt[alt.length - 1 - hinten] === neu[neu.length - 1 - hinten]
  ) {
    hinten++
  }
  while (
    hinten > 0 &&
    istWort(alt[alt.length - hinten]) &&
    (istWort(alt[alt.length - hinten - 1]) || istWort(neu[neu.length - hinten - 1]))
  ) {
    hinten--
  }
  const geloescht = alt.slice(vorn, alt.length - hinten)
  const eingefuegt = neu.slice(vorn, neu.length - hinten)
  const p = start + vorn
  return [
    ...(geloescht ? [{ p, d: geloescht }] : []),
    ...(eingefuegt ? [{ p, i: eingefuegt }] : []),
  ]
}

// Wie der Editor: absteigend nach Position, Löschungen per Undo wieder einfügen.
export function umkehrOps(changes) {
  return [...changes]
    .sort((a, b) => b.op.p - a.op.p)
    .map(c =>
      c.op.i !== undefined ? { p: c.op.p, d: c.op.i, u: true } : { p: c.op.p, i: c.op.d, u: true }
    )
}

// Text um eine angenommene Änderung. Eine angenommene Löschung steht nicht mehr im Text,
// ein Einschub schon; der Kontext liegt jeweils außen herum.
const KONTEXT = 40

export function kontextUm(text, op) {
  const ende = op.p + (op.i?.length ?? 0)
  return { vor: text.slice(Math.max(0, op.p - KONTEXT), op.p), nach: text.slice(ende, ende + KONTEXT) }
}

// Höchstens so viele Treffer werden verglichen; mehr Wiederholungen ergeben einen Konflikt.
const MAX_TREFFER = 100

// Sucht die Stelle einer angenommenen Änderung im heutigen Text: Kontext davor, Einschub, Kontext
// danach. Bei mehreren Treffern gilt der nächste zur alten Position; ohne Treffer ein Konflikt.
// Treffer überlappen nicht, sonst wüchse die Suche bei sich wiederholendem Text quadratisch.
export function heutigePosition(text, eintrag) {
  const muster = eintrag.vor + (eintrag.op.i ?? '') + eintrag.nach
  let beste = null
  let treffer = 0
  for (let i = text.indexOf(muster); i !== -1; i = text.indexOf(muster, i + Math.max(1, muster.length))) {
    if (++treffer > MAX_TREFFER) return null
    const p = i + eintrag.vor.length
    if (beste === null || Math.abs(p - eintrag.op.p) < Math.abs(beste - eintrag.op.p)) beste = p
  }
  return beste
}
