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

const WORTZEICHEN = /[\p{L}\p{N}_]/u
const MAX_ERGAENZUNG = 40

// Auszug für die Lauf-Karte: Beginnt oder endet eine Änderung mitten im Wort (die Ops sind
// minimal), wird sie um den Rest des Wortes aus dem Text ergänzt. Eine Löschung steht nicht mehr im
// Text, ein Einschub schon.
export function auszug(text, op, max = 200) {
  const inhalt = op.i ?? op.d
  const ende = op.p + (op.i?.length ?? 0)
  let links = op.p
  if (WORTZEICHEN.test(inhalt[0] ?? '')) {
    while (links > 0 && op.p - links < MAX_ERGAENZUNG && WORTZEICHEN.test(text[links - 1])) links--
  }
  let rechts = ende
  if (WORTZEICHEN.test(inhalt.at(-1) ?? '')) {
    while (rechts < text.length && rechts - ende < MAX_ERGAENZUNG && WORTZEICHEN.test(text[rechts])) rechts++
  }
  return (text.slice(links, op.p) + inhalt + text.slice(ende, rechts)).slice(0, max)
}
