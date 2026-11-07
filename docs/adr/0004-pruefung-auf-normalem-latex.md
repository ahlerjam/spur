# 0004: Prüfung liest normales LaTeX

## Context and Problem Statement
Halluzinierte Zitate sollen deterministisch auffallen. Eigene Makros oder Zitat-IDs würden Projekte an spur binden und Handzitate nicht erfassen.

## Considered Options
- Prüfung auf normalem LaTeX mit Lezer-Grammatik
- Eigenes Makro mit Zitat-ID
- Prüfung nur beim Einfügen

## Decision Outcome
Normales LaTeX. Der Prüfer erkennt das Zitierpaket aus der Präambel und läuft einmal zentral auf dem Server. Der Wortlaut wird gegen die Quelle zum Beleg verglichen, die Zuordnung läuft erst über DOI, dann über den Key.

### Consequences
- Der tragende Schutz ist der projektweite Prüfbericht, unabhängig vom Schreiber. Die Schreibsperre wirkt nur auf Claudes Weg, nicht auf Uploads oder Git.
- Status bleiben getrennt: Wortlaut, Seite, Referenz, Retraction.
- Nicht erkannte Formen melden „nicht prüfbar“, bei Claude rot ohne automatisches Annehmen.
- Geprüft werden Wörtlichkeit und Existenz, nicht die Aussage einer Paraphrase.
