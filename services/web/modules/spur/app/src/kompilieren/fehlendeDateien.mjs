// Dateien, die LaTeX laut Log nicht gefunden hat. Ohne Node-Abhängigkeiten: Der Log-Bereich im Editor nutzt es auch.
const MAX_ZEILE = 79
const MUSTER = [
  [/^! LaTeX Error: File `([^']+)' not found\./, ([, datei]) => datei],
  [/^! Package biblatex Error: (Citation |Bibliography )?[Ss]tyle '([^']+)' not found\./, ([, art, stil]) => `${stil}.${art === 'Citation ' ? 'cbx' : 'bbx'}`],
  [/^! Font [^=\s]+=(\S+)(?: at \S+| scaled \d+)? not loadable: Metric \(TFM\) file not found\./, ([, font]) => `${font}.tfm`],
]

// TeX bricht Logzeilen nach 79 Zeichen um; eine volle Zeile geht in der nächsten weiter.
function zeilen(log) {
  const ergebnis = []
  let offen = ''
  for (const zeile of log.split('\n')) {
    offen += zeile
    if (zeile.length === MAX_ZEILE) continue
    ergebnis.push(offen)
    offen = ''
  }
  if (offen) ergebnis.push(offen)
  return ergebnis
}

export function fehlendeDateien(log) {
  const dateien = []
  for (const zeile of zeilen(log)) {
    for (const [muster, datei] of MUSTER) {
      const treffer = muster.exec(zeile)
      if (treffer && !dateien.includes(datei(treffer))) dateien.push(datei(treffer))
    }
  }
  return dateien
}
