// Kleinste Änderung: gemeinsamer Anfang und gemeinsames Ende bleiben unangetastet.
export function opsFuer(start, alt, neu) {
  let vorn = 0
  while (vorn < alt.length && vorn < neu.length && alt[vorn] === neu[vorn]) vorn++
  let hinten = 0
  while (
    hinten < alt.length - vorn &&
    hinten < neu.length - vorn &&
    alt[alt.length - 1 - hinten] === neu[neu.length - 1 - hinten]
  ) {
    hinten++
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
