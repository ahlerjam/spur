# 0005: Quellen liegen außerhalb des Projektbaums

## Context and Problem Statement
Quellen im Projektordner lösen volle Compile-Syncs aus, belasten History und Git, und extrahierter Text sprengt das Compile-Limit von 7 MB.

## Considered Options
- Eigene Ablage im Daten-Volume plus MongoDB
- Ordner `quellen/` im Projekt
- Begleitprojekt

## Decision Outcome
Dateien liegen in `/var/lib/overleaf/data/spur/`, Metadaten und Text je Seite in MongoDB. Rechte kommen aus der Projektrolle, Aufräumen läuft über `projectExpired`.

### Consequences
- Backup ist Volume plus Mongo.
- Quellen sind nicht in Git- oder ZIP-Exporten; „Quellen exportieren“ und „aus anderem Projekt holen“ ersetzen das.
- Beim Klonen weist spur auf die fehlenden Quellen hin.
- Upload-Grenzen von nginx und web gelten weiter.
