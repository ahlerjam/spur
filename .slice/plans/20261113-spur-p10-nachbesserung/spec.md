Type: web, api

# spur P10: Nachbesserung nach der Abnahme von P8 und P9

## Zweck
Die lokale Prüfung von PR #7 (P8 Korrekturen, P9 Oberflächen) am laufenden System fand einige Stellen, die verwirren oder unfertig wirken, und einen wackeligen Unit-Test (Entscheidung D9). Dieser Plan behebt sie, damit der Owner PR #7 mergen kann.

## Nutzer
Forschende, die mit spur und Claude schreiben (Laptop ab 1280 px, schmale Panels um 210 px); Admins.

## Was Nutzer danach können
- Im Prüfbericht eine Zahl für „markiert“ lesen, die in Filter und Kopfzeile dasselbe meint.
- Mit Claude Sätze mit Uhrzeiten und Softwareversionen schreiben, ohne dass der Lauf „Zahl ohne Beleg“ meldet.
- Im Claude-Panel erkennen, dass nur noch rote Zitate offen sind, und rote Zitate nie aus Versehen mit annehmen.
- Editor, Log-Bereich und Projektliste ohne englische Reste benutzen.
- Als Admin Projekte in „Grenzen“ suchen und blättern und den Speicher kleiner Projekte ablesen.

## Context
Befunde aus der Verifikation am 2026-11-13 (Playwright und MCP gegen `spur-dev`, Testdaten aus `vorbereiten.mjs`):
- Prüfbericht, Projekt „E2E Bericht“: Filter „Alle 9 | Markiert 6 | Ohne Quelle 2 | Nicht prüfbar 1“, Kopfzeile „Zitierstellen: 6 geprüft, davon 3 markiert, 2 ohne Quelle, 1 nicht prüfbar“, Dateizeile „8 Stellen, 6 markiert“. Der Filter zählt ohne Quelle und nicht prüfbar zu „markiert“, die Kopfzeile nicht. `check_report` liefert `zaehlung.markiert` (P8 f2).
- `doc_edit` meldet in `zahlen_ohne_beleg` weiter `9` aus „um 9 Uhr“ und `3.12` aus „Python 3.12“; nicht gemeldet werden `12.11.2026`, `14:30`, `Version 1.2.3`, `2026-11-12T09:30`, `2024`, `12--14`.
- Claude-Panel, Projekt „E2E Automatik“ mit Auto-Annahme an, nach einer normalen und einer roten Änderung (`\parencite{unbekannt}`, DOI unbekannt): Oben steht der ausgegraute Knopf „Nichts offen“, die Lauf-Karte zeigt „1 offen“, „Bitte prüfen“ mit dem roten Zitat und darunter „Alle annehmen“. Ob „Alle annehmen“ das rote Zitat mit annimmt, ist ungeprüft.
- Sprache: Tab-Titel im Editor „E2E P8 DOI - Online LaTeX Editor spur“, in der Projektliste „Deine Projekte - spur, Online-LaTeX-Editor“; im Log-Bereich „Raw Logs“ (`raw_logs` in `de.json`); aria-label „Hide file tree“ (Schlüssel `hide_file_tree` fehlt in `de.json`). `tools/tests/sprache.test.mjs` führt die geprüften Flächen.
- Admin → Grenzen: Die Projekttabelle listet alle Projekte (lokal rund 100) ohne Suche und Blättern; die Nutzertabelle hat Suche und 50 je Seite (P9 f9). Speicher steht für alle kleinen Projekte als „0 GB“.
- Prüfbericht bei 1440 px mit Standardbreite der Seitenleiste (~210 px): Die Filtergruppe bricht in „Alle 4 | Markiert 1“ und darunter je eine volle Zeile „Ohne Quelle 4“ und „Nicht prüfbar 0“ um.
- D9 (`.slice/decisions.md`): Der Test „lässt einen zweiten gleichzeitigen Aufruf warten, bis der erste fertig ist“ in `texPaketeHinzufuegen.test.mjs` war in 2 von 5 Läufen von `spur-dev test` rot (`erster.dateien` hatte nicht 5 Einträge).

## Decisions
Owner-Entscheidungen (2026-11-13): alle Befunde beheben, lokal bauen, Ergebnis in PR #7.
Annahmen (vom Owner bestätigt):
- „Markiert“ heißt überall: alle Stellen, die der Filter „Markiert“ zeigt. Die Kopfzeile beginnt mit dieser Zahl und schlüsselt danach auf. `zaehlung.markiert` in `check_report` bekommt dieselbe Bedeutung; der Vertrag nennt die Änderung.
- Nicht gemeldet werden: Uhrzeiten mit „Uhr“ (`9 Uhr`, `9.30 Uhr`, `9:30 Uhr`), Versionen direkt nach einem Software-Namen in Großschreibung oder bekannten Namen (`Python 3.12`, `R 4.3.1`, `SPSS 29`, `LaTeX2e`, `Node 20`). Weiter gemeldet: `3.14`, `12,5`, `1.250`, `240`, `37,5 Prozent`.
- Claude-Panel: Der Knopf oben heißt je nach Stand „Alles Offene jetzt annehmen (N)“, „Nur rote Zitate offen (N)“ (ausgegraut, mit Hinweis, dass sie einzeln geprüft werden) oder „Nichts offen“. „Alle annehmen“ in der Lauf-Karte fragt, wenn rote Zitate dabei sind: Dialog „N rote Zitate mit annehmen?“ mit „Nur die anderen“ (Standard, Fokus) und „Alle annehmen“. Ohne rote Zitate keine Rückfrage.
- Tab-Titel im Editor: „<Projektname> – spur“; Projektliste bleibt wie sie ist oder folgt demselben Muster („Deine Projekte – spur“), Hauptsache einheitlich.
- Admin-Projekttabelle: Suche nach Projektname oder Eigentümer, 50 je Seite wie die Nutzertabelle. Speicher in der kleinsten sinnvollen Einheit mit deutscher Zahl (`512 KB`, `3,4 MB`, `1,2 GB`); Grenzen bleiben in GB einstellbar.
- D9: zuerst die Ursache finden. Liegt sie in der Sperre von `hinzufuegen`, wird der Code behoben; liegt sie nur im Test, der Test. Danach 10 Läufe in Folge grün.
- Builder: Sonnet, lokal mit `spur-dev`.

## Quality bar
- Jede Änderung ist am laufenden System über die Oberfläche bzw. über MCP geprüft, nicht nur per Unit-Test.
- Schmale (210 px) und breite Seitenleiste, helles und dunkles Farbschema sehen sauber aus.
- Tastatur: Dialog per Tab bedienbar, Esc schließt, Fokus kehrt zurück.
- Keine neuen englischen Texte; neue Texte als Schlüssel in `de.json` und `en.json`.
- `spur-dev test` grün, Abdeckung nicht schlechter als vorher; volle E2E-Suite am Ende grün.
