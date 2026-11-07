// Reine Auswertung für upstream.mjs: Abgleich mit der Liste bekannter Fehler und Herkunft im Dreier-Vergleich.

const schluessel = t => `${t.suite}\0${t.datei}\0${t.test}`

export const ersteZeile = fehler => (fehler.split('\n').find(z => z.trim()) || '').trim()

// Vorschlag für neue Einträge; die Gründe der Liste werden danach von Hand geschärft.
export function grundAusFehler(fehler) {
  if (/Cannot find (module|package)/.test(fehler)) return 'Ein Modul fehlt im Dev-Image oder gehört zu Overleaf Server Pro.'
  return ersteZeile(fehler).slice(0, 200) || 'Ohne Fehlermeldung gescheitert.'
}

export function auswerten(tests, bekannt) {
  const bekanntIndex = new Set(bekannt.map(schluessel))
  const fehlgeschlagen = tests.filter(t => t.status === 'failed')
  return {
    bestanden: tests.filter(t => t.status === 'passed').length,
    fehlgeschlagen: fehlgeschlagen.length,
    bekannt: fehlgeschlagen.filter(t => bekanntIndex.has(schluessel(t))).length,
    neu: fehlgeschlagen.filter(t => !bekanntIndex.has(schluessel(t))),
    jetztGruen: tests.filter(t => t.status === 'passed' && bekanntIndex.has(schluessel(t))),
  }
}

export function zusammenfassung(a) {
  return `bestanden: ${a.bestanden}, fehlgeschlagen: ${a.fehlgeschlagen}, bekannt: ${a.bekannt}, neu: ${a.neu.length}`
}

// Herkunft eines Fehlers auf spur: scheitert er schon auf main, kommt er von Overleaf; sonst, wenn er auf
// ext-ce scheitert, von overleaf-cep. Was nur auf spur scheitert, kommt nicht auf die Liste.
export function herkunftBestimmen(main, extCe, agent, alt, ausgeschlossen = []) {
  const gescheitert = lauf => new Set(lauf.filter(t => t.status === 'failed').map(schluessel))
  const aufMain = gescheitert(main)
  const aufExtCe = gescheitert(extCe)
  const alteGruende = new Map(alt.map(b => [schluessel(b), b.grund]))
  const liste = []
  const nurSpur = []
  const ausgeschlosseneDatei = t => ausgeschlossen.some(a => a.suite === t.suite && a.datei === t.datei)
  for (const t of agent.filter(t => t.status === 'failed' && !ausgeschlosseneDatei(t))) {
    const k = schluessel(t)
    const herkunft = aufMain.has(k) ? 'overleaf' : aufExtCe.has(k) ? 'overleaf-cep' : null
    if (!herkunft) {
      nurSpur.push(t)
      continue
    }
    liste.push({
      suite: t.suite,
      datei: t.datei,
      test: t.test,
      herkunft,
      grund: alteGruende.get(k) || grundAusFehler(t.fehler),
    })
  }
  return { liste, nurSpur }
}
