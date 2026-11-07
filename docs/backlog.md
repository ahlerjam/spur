# Backlog

Zurückgestellt, nicht verworfen. Vor neuen Plänen hier nachsehen.

## Claude-Anbindung
- Connector für claude.ai, Desktop und Mobile; braucht OAuth und öffentliche Erreichbarkeit
- Knopf startet Cloud-Session über Scheduled Task mit API-Trigger
- Serverseitiger Agent mit eigenem API-Key
- Andere LLMs über MCP
- Fertige Workflows zusätzlich als MCP-Prompts

## Proaktivität
- Weitere fünf Schalter: Paper-Vorschläge, Zitate vormarkieren, Stil, PDF-Optik, Paraphrasen
- Stufe Auto für proaktive Funktionen
- Obergrenze pro Projekt

## Versionierung
- Echte Agent-Branches mit Git-Fenster
- Gezieltes Direktschreiben ohne Track Change

## Forschung und Daten
- Peer-Review-Antwort: Gutachterpunkte, Antwortbrief, Vergleich zur eingereichten Fassung
- Betreuerzugang, Gliederung mit zugeordneten Quellen
- Abgabecheck vor der Einreichung
- Codebuch mit Intercoder-Übereinstimmung
- Pseudonymisierung und Datenschutz-Schalter pro Quelle
- Audio- und Videotranskription
- Literatur-Alerts, systematischer Review
- Skriptausführung auf dem Server

## Betrieb
- Semantische Suche über Postgres mit pgvector, falls Brute Force nicht mehr reicht
- Kurze Tokens mit OAuth

## Vor dem jeweiligen Plan ins Image
- P2: `@huggingface/transformers` für die semantische Suche
- P4: `tesseract-ocr` mit Sprachdaten

## Ungeklärt
- Link-Resolver für TIB und LUH
- Marken- und Logo-Regeln von Overleaf für Forks; rechtlich prüfen lassen
- Consumer Terms Abschnitt 11 für EWR-Nutzer in der Hochschulforschung
