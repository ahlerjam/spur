// Reine Auswertung für upstream.mjs: Abgleich mit der Liste bekannter Fehler und Herkunft im Dreier-Vergleich.

const schluessel = t => `${t.suite}\0${t.datei}\0${t.test}`

export const ersteZeile = fehler => (fehler.split('\n').find(z => z.trim()) || '').trim()

// Vorschlag für neue Einträge; die Gründe der Liste werden danach von Hand geschärft.
export function grundAusFehler(fehler) {
  if (/Cannot find (module|package)/.test(fehler)) return 'Ein Modul fehlt im Dev-Image oder gehört zu Overleaf Server Pro.'
  return ersteZeile(fehler).slice(0, 200) || 'Ohne Fehlermeldung gescheitert.'
}

export const dateiNormal = datei => datei.replace(/^\.\//, '').replace(/\/$/, '')

// Pfad ist der Ordner selbst oder liegt darunter (Pfade ohne Schrägstrich am Ende, siehe dateiNormal).
export const unterOrdner = (pfad, ordner) => pfad === ordner || pfad.startsWith(`${ordner}/`)

// Dateiargumente vor dem Lauf: ein Tippfehler darf nicht als „0 bestanden, neu: 0“ grün durchgehen.
// `ausgeschlossen` enthält nur die Einträge dieser Suite.
export function dateienPruefen(suite, dateien, existiert, ausgeschlossen) {
  const fehler = []
  for (const d of dateien) {
    if (!existiert(d)) fehler.push(`${d}: nicht gefunden (Pfad relativ zum Dienst)`)
    else if (ausgeschlossen.some(a => a.datei === d)) fehler.push(`${d}: ist ausgeschlossen (tools/tests/upstream-ausschluss.json)`)
    else if (suite === 'du' && !['test/unit', 'test/acceptance'].some(o => unterOrdner(d, o))) {
      fehler.push(`${d}: liegt nicht unter test/unit/ oder test/acceptance/`)
    }
  }
  return fehler
}

// Dateiargumente (auch Ordner), zu denen nach dem Lauf kein einziger Test gehört.
export function dateienOhneTests(dateien, tests) {
  return dateien.filter(d => !tests.some(t => unterOrdner(t.datei, d)))
}

// Lädt eine Suite oder ein Teil davon nicht, ist das Ergebnis unbrauchbar, nie ein bekannter Fehler.
export function suiteLadefehler(tests) {
  const ursache = fehler => (fehler.split('\n').find(z => /Error\b/.test(z)) || ersteZeile(fehler)).trim()
  return tests.filter(t => t.datei === '(Suite)').map(t => `${t.test}: ${ursache(t.fehler)}`)
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
