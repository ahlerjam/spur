# 0002: Claude schreibt immer als Track Change

## Context and Problem Statement
`setDocument` zeigt Live-Nutzern ein Modal, hat keine Versionsprüfung und überschreibt parallele Eingaben. Claude muss schreiben können, ohne Mitarbeitende zu stören, und Läufe müssen zurücknehmbar sein.

## Considered Options
- Ein Schreibweg: Ops mit Version, immer als Track Change
- Zwei Wege: Direktschreiben und Track Changes
- Eigene Agent-Branches in einem internen Git-Repo

## Decision Outcome
Ein Schreibweg über einen neuen document-updater-Endpunkt mit Ops und Version unter dem bestehenden Apply-Pfad. Jeder Mensch hat einen eigenen Bot-Nutzer, der kein Projektmitglied ist. „Automatisch annehmen“ ist die Sammelannahme am Laufende ohne rote Status. Annehmen ist Menschen vorbehalten, Claude hat dafür kein Tool.

### Consequences
- Rücknahme offener Läufe per Reject, angenommener Läufe als neuer Track Change. Das History-Label ist nur der letzte Ausweg.
- Die Lauf-Karte liest live aus den Ranges. Die Grenzen direkt aufeinanderfolgender Läufe desselben Bots bleiben unscharf.
- Echte Branches gibt es nicht. Wer getrennt arbeiten will, klont das Projekt.
