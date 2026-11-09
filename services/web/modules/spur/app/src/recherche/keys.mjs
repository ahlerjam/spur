// Erster Nachname ohne Akzente plus Jahr, wie viele Literaturverwaltungen: „keller2014“.
export function keyVorschlag(meta) {
  const name = (meta.autoren?.[0]?.family ?? meta.titel ?? 'quelle')
    .normalize('NFKD')
    .replace(/[^a-zA-Z0-9]/g, '')
    .toLowerCase()
  return `${name || 'quelle'}${meta.jahr ?? ''}`
}

export function freierKey(basis, belegt) {
  if (!belegt.has(basis)) return basis
  for (const buchstabe of 'abcdefghijklmnopqrstuvwxyz') {
    if (!belegt.has(`${basis}${buchstabe}`)) return `${basis}${buchstabe}`
  }
  return `${basis}-${Date.now()}`
}
