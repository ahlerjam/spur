const EINTRAG = /@([a-zA-Z]+)\s*\{\s*([^,\s]+)\s*,/g

function feldWert(rumpf, name) {
  const m = new RegExp(`\\b${name}\\s*=\\s*[{"]`, 'i').exec(rumpf)
  if (!m) return null
  const start = m.index + m[0].length
  const auf = m[0].at(-1)
  let tiefe = 1
  for (let i = start; i < rumpf.length; i++) {
    const c = rumpf[i]
    if (auf === '"' && c === '"' && rumpf[i - 1] !== '\\') return rumpf.slice(start, i)
    if (auf === '{' && c === '{') tiefe++
    if (auf === '{' && c === '}' && --tiefe === 0) return rumpf.slice(start, i)
  }
  return null
}

export function bibLesen(text) {
  const eintraege = new Map()
  for (const m of text.matchAll(EINTRAG)) {
    if (/^(comment|string|preamble)$/i.test(m[1])) continue
    const rumpf = text.slice(m.index + m[0].length)
    const naechster = rumpf.search(/\n\s*@[a-zA-Z]+\s*\{/)
    const felder = naechster < 0 ? rumpf : rumpf.slice(0, naechster)
    eintraege.set(m[2], { key: m[2], doi: feldWert(felder, 'doi')?.trim() ?? null })
  }
  return eintraege
}
