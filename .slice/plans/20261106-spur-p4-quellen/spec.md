Type: web, api

# spur P4: Mehr Quellen und Team

## Zweck
Teams arbeiten gemeinsam an Quellen, nehmen auch Scans und Webseiten auf und erschließen Interviews thematisch.

## Nutzer
Wie P1, zusätzlich Kolleginnen und Kollegen im selben Projekt und Forschende mit qualitativen Daten.

## Was Nutzer können
- Markierungen und Zitate für andere sichtbar machen, kommentieren und zuweisen.
- Scans per OCR und Webseiten als datierte Schnappschüsse aufnehmen.
- Interviews mit Codes versehen, wobei Claude Vorschläge macht und Menschen entscheiden.

## Zustände der Oberfläche
Markierungen: keine, viele, von anderen. OCR: läuft, fertig, unsicher. Codes: leer, Vorschläge offen.

## Decisions
- Es gelten `docs/adr`, `docs/mcp-vertrag.md` und die Entscheidungen aus P1 bis P3.
- Markierungen gehören zum Projekt, Rechte aus der Projektrolle.
- OCR nutzt Tesseract im Image. OCR-Text trägt den Status „OCR, Sichtprüfung nötig“; Zitate daraus zeigen nie „exakt“ ohne menschliche Bestätigung.
- Web-Schnappschüsse speichern Text, URL, Abrufdatum und Hash.
- Codes hängen an Textsegmenten mit Positionsangabe. KI-Vorschläge bleiben offen, bis ein Mensch sie annimmt.
- Keine Sonderregeln für Interviews. Hinweis steht in der README.

## Testbarkeit
Wie P1. Fixtures: `scan.pdf` mit bekanntem Satz, statische Testseite im Fake-Server, `interview.vtt`.

## Quality bar
Wie P1. Bei OCR-Unsicherheit steht der Status in Text, nicht nur als Farbe.
