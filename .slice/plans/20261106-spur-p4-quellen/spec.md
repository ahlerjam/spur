Type: web, api

# spur P4: Mehr Quellen und Team

## Zweck
Teams arbeiten gemeinsam an Quellen und nehmen auch Scans und Webseiten auf.

## Nutzer
Wie P1, zusätzlich Kolleginnen und Kollegen im selben Projekt.

## Was Nutzer können
- Markierungen und Zitate für andere sichtbar machen, kommentieren und zuweisen.
- Scans per OCR und Webseiten als datierte Schnappschüsse aufnehmen.
- Beim Hochladen von Transkripten einen Hinweis zum Datenschutz sehen.

## Zustände der Oberfläche
Markierungen: keine, viele, von anderen. OCR: läuft, fertig, unsicher.

## Decisions
- Es gelten `docs/adr`, `docs/mcp-vertrag.md` und die Entscheidungen aus P1. P4 läuft parallel zu P2 und baut nur auf P1 auf.
- Markierungen gehören zum Projekt, Rechte aus der Projektrolle.
- OCR nutzt Tesseract im Image. OCR-Text trägt den Status „OCR, Sichtprüfung nötig“; Zitate daraus zeigen nie „exakt“ ohne menschliche Bestätigung.
- Web-Schnappschüsse speichern Text, URL, Abrufdatum und Hash.
- Kein Codieren von Interviews in spur. Interviews sind Verantwortung der Nutzer; spur zeigt nur einen Hinweis beim Upload von Transkripten und in der README.
- Keine Sonderregeln für Interviews.

## Testbarkeit
Wie P1. Fixtures: `scan.pdf` mit bekanntem Satz, statische Testseite im Fake-Server, `interview.vtt` aus P1.

## Quality bar
Wie P1. Bei OCR-Unsicherheit steht der Status in Text, nicht nur als Farbe.

### Tests (TDD)
- Test zuerst: Für jede neue oder geänderte Server-Logik entsteht zuerst ein roter Unit-Test (vitest unter `modules/spur/test/unit`), dann der Code, der ihn grün macht. Jeder behobene Fehler bekommt zuerst einen Test, der ihn nachstellt.
- Jede neue Oberfläche bekommt Frontend-Tests im Stil von Overleafs Frontend-Tests (Komponente rendern, bedienen, Ergebnis prüfen), dazu ihre Schritte in der E2E-Suite `test/e2e/spur-e2e.js`.
- Jedes Feature erweitert die E2E-Suite um seine Schritte; die Suite läuft nach `vorbereiten.mjs` vollständig grün.
- Overleafs eigene Suiten (web Unit, Frontend, document-updater) bleiben grün bis auf die Liste bekannter Upstream-Fehler im Repo; ein neuer roter Test dort ist ein Fehler dieses Plans.
