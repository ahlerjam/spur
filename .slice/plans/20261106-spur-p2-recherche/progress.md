# Fortschritt 20261106-spur-p2-recherche

## Needs decision
- f6: Mit welchem Werkzeug füllt Claude eine Matrixzelle als Vorschlag? `docs/mcp-vertrag.md` nennt für P2 keines, `suggest` gehört zu P3.
  Interim: neues Werkzeug `matrix_suggest` (Projekt, Quelle, Spalte, Text). Es legt nur einen Vorschlag an, den die Person in der Matrix bestätigt. Im Vertrag ist es als P2-Ergänzung eingetragen.
  Options: A (empfohlen): `matrix_suggest` behalten und später in `suggest` (P3) aufgehen lassen | B: sofort ein allgemeines `suggest` mit Ziel „matrix“

## Recipe changes
- Das Setup-Skript der Cloud-Umgebung (`tools/spur-dev/cloud-setup.sh`) war in dieser Session nicht gelaufen: kein `spur-dev`, kein Docker-Daemon. Der Builder hat die Schritte des Skripts selbst ausgeführt: `dockerd` gestartet, `bash tools/spur-dev/spur-dev install --cloud` aus dem unveränderten Worktree, die drei Images gezogen.
- Das run-code-Werkzeug von Playwright bricht nach 60 s ab und kann die ganze E2E-Datei nicht ausführen. In dieser VM startet Chromium aus der Bash. Der Builder führt `spur-e2e.js` deshalb mit einem Läufer im Scratchpad aus, der wie `test/e2e/run.mjs` arbeitet, Playwright aber aus `/opt/node-tools` lädt.

## Menschlich zu prüfen
- Cloud-Umgebung: Warum ist das Setup-Skript nicht gelaufen (Umgebungs-Cache)?

## Entscheidungen
- E2E-Schlüssel: P1 belegt `f1` bis `f15` in `spur-e2e.js`. Die Features dieses Plans heißen dort `p2f1` bis `p2f10`.
- Paper-Fake: Die Wurzel bleibt `SPUR_PAPER_API_BASE` aus `dev-schalter.json` (Standard aus P1: `…/spur/dev/crossref`). Crossref liegt wie bisher unter `…/works`, die anderen Dienste unter `…/arxiv`, `…/openalex`, `…/s2` und `…/unpaywall`, Antworten im Format der echten APIs aus `test/fixtures/papers.json`. Steuerung (Ausfall eines Dienstes) und Abrufprotokoll gibt es nur mit `SPUR_DEV=1` und nur im Speicher des Web-Prozesses.
- Keys: Ohne `OPENALEX_API_KEY` oder `SEMANTIC_SCHOLAR_API_KEY` bleibt der Dienst aus, und das Panel nennt ihn mit Hinweis (OpenAlex verweigert ohne Key, Semantic Scholar antwortet ohne Key fast immer mit 429). Mit Paper-Fake braucht kein Dienst einen Key.
- Drossel über die ganze Installation: Zeitfenster je Dienst als Mongo-Dokument (`spurDrossel`), atomar mit `findOneAndUpdate` vergeben. arXiv 3 s, Semantic Scholar 1 s, OpenAlex 0,1 s. Liegt das nächste freie Fenster mehr als 20 s in der Zukunft, meldet der Dienst „Limit erreicht“.
- Cache: Antworten je URL (ohne Key) 24 h in `spurPaperCache`, nur Metadaten.
