# Fortschritt 20261109-spur-p5-abnahme

## Recipe changes
- `spur-dev up` aus diesem Worktree (hängt ihn ein), `services/web/modules/spur/dev-schalter.json` = `{"SPUR_PAPER_API_BASE": "http://127.0.0.1/spur/dev/crossref", "SPUR_FAKE_AGENT": "1"}`.
- `/opt/node-tools` gibt es auf diesem Rechner nicht, Chromium startet nicht aus der Bash-Sandbox. Die Suite läuft im Playwright-MCP-Server: `.playwright-mcp/mach-wrapper.sh [f1,f2]` (gitignoriert) erzeugt `start.js`, das `spur-e2e.js` startet, ohne zu warten, und das Ergebnis an `page.__e2e` hängt; `poll.js` fragt es in Aufrufen unter 60 s ab. Nach jeder Änderung an `spur-e2e.js` den Wrapper neu erzeugen.
- Zwischen zwei Werkzeugaufrufen steht der Playwright-Server still, die Wanduhr läuft weiter. Wartende Schleifen der Suite (`panelSichern`, 30 s nach `Date.now()`) laufen dann in den Timeout. `poll.js` wartet deshalb bis zu 55 s aktiv; Aufrufe dicht hintereinander, nichts anderes dazwischen.

## Rauchtest vor dem Bauen
- Gesamtlauf auf dem Stand vor P5 (440 s): 33/34 ok, `p3f2 FEHLER: Panel Review panel: nicht sichtbar nach 30 s`.
- Ursache (zwei Teile): Erstens fror der Playwright-Server zwischen meinen Aufrufen ein (siehe Recipe changes). Zweitens sendet Overleaf die Kommentar-Op gesammelt etwa 2 s nach dem Thread-Text (gemessen: `/project/<id>/ranges` zeigt den Kommentar nach 2 s); p3f2 meldete Bo sofort ab, und die Op ging verloren (Thread da, Range leer, Ada sah „No comments“). Behoben im Test: p3f2 wartet nach dem Absenden, bis `/ranges` den Kommentar enthält (Abfrage per `page.request`, höchstens 20 s). Ein erster Versuch mit `waitForFunction` und async-Prädikat wirkte nicht, weil das zurückgegebene Promise sofort als wahr gilt.

## Entscheidungen
- f2: „Tags“ als englischer Wert von `organize_tags` macht Overleafs Test `tags-list.test.tsx` rot (erwartete „Organize Tags“). Der Test erwartet jetzt „Tags“, weil die Umbenennung gewollt ist; ein Eintrag in der Upstream-Liste mit Herkunft spur ist nicht erlaubt.
- Frontend-Tests: `deutschAktivieren` merkte sich die Sprache beim Definieren statt im `before`; danach blieb die ganze Mocha-Sitzung auf Deutsch, und `tags-list.test.tsx` scheiterte im selben Lauf. Jetzt im `before`.

## Bauweise
- f1: Schriftzug „spur“ als Text im Toolbar-Stil (`toolbar-spur-schriftzug`), Link mit `aria-label` „spur, zur Projektliste“. Das Overleaf-„O“ kam außerdem im Ladebildschirm, im leeren PDF-Bereich und auf den Passwortseiten vor; dort steht jetzt ebenfalls „spur“ (Entscheidung „überall einheitlich“). Ladebildschirm: zwei Lagen des Schriftzugs, die volle füllt sich von unten wie vorher das Logo.
- f3: `BefehlKasten` (Befehl plus eigener Kopierknopf) im Token-Dialog und im Claude-Panel; Befehle brechen im Kasten um (`pre-wrap`, `overflow-wrap: anywhere`).
- f5: `meldung(schluessel, werte)` in `app/src/meldungen.mjs` liest `de.json` oder `en.json` nach `Settings.i18n.defaultLng` (`OVERLEAF_SITE_LANGUAGE`), andere Sprachen fallen auf Englisch zurück. `Problem(status, typ, schluessel, werte)` und `WerkzeugFehler(code, schluessel, werte)` übersetzen beim Erzeugen; die Installation hat eine feste Sprache. 109 Schlüssel `spur_fehler_*`. Ein kaputtes Seitenbild zeigt jetzt die Meldung des Servers als Hinweis (`Seitenbild`), in Panel und großer Ansicht.
- f6: Bei 1280 px war das Seitenpanel standardmäßig 185 px breit; dort passen Zurück, „Seite 345 (PDF-Seite 1 von 8)“ und zwei Knöpfe nicht in eine Zeile. spur-Panels starten jetzt mit 25 % statt 15 % (Overleaf macht dasselbe für sein Workbench-Panel mit 20 %, `rail-panel.tsx`), Zurück, Vorherige und Nächste Seite sind Icon-Knöpfe mit Namen. Große Ansicht: `OLModal` über die ganze Fläche (Overleafs Stile kennen `modal-fullscreen` nicht), Zoom 75–200 %, Bild und Text nebeneinander, unter 768 px untereinander. Fokus geht nach Esc und „Schließen“ über die FocusTrap von `OLModal` zurück auf „Groß öffnen“.
- f7: Eingaben stehen am Workflow (`eingaben: ['thema', 'anzahl']` in `standardtexte.mjs`). Thema und Anzahl hängt `promptText` als Zeilen unter den (von Admins änderbaren) Text; geprüft wird auf dem Server (Fehler `thema`, `anzahl`) und gleich im Formular. `paper_search` liefert `abstract` aus arXiv (summary), OpenAlex (invertierter Index), Crossref (JATS ohne Tags) und Semantic Scholar, sonst leer. Duplikate meldeten `source_add` (`quelle_vorhanden`) und `acquisition_add` (`beschaffung_vorhanden`) schon vorher.
- E2E: `E2E Leer P5` legt `vorbereiten.mjs` an (leeres Projekt für p5f4). Ältere Schritte mit neuen Texten angepasst (Token-Dialog, Du-Texte, „Ein Zitat belegen sie nicht.“); `getByLabel('Projekt')` jetzt mit `exact`, weil der Link „spur, zur Projektliste“ sonst mittrifft.

## Tests zuerst
- Rot gesehen: `sprachdateien.test.mjs` (19 Siezer), `claude-verbinden.test.tsx` (3 neu), Workflow- und MCP-Tests für „Quellen sammeln“ (15 rot), Frontend-Test der großen Ansicht (Esc, Fokus).
- Vor dem Code geschrieben, aber nicht rot ausgeführt: `meldungen.test.mjs` (das Modul fehlte noch; die Umstellung der 109 Stellen lief danach), Abstract-Tests in `recherche.test.mjs`, Formular-Test im Claude-Panel.

## f4 Du-Form
- Test `test/unit/sprachdateien.test.mjs` zuerst rot: 19 siezende `spur_`-Schlüssel (darunter `spur_du: Sie` und `spur_von_ihnen: von Ihnen` für Absender im Chat und an Zitaten), die Spec schätzte 20.
- humanizer-de, Modus sachlich, Sammelcheck über alle neuen und geänderten deutschen Texte (f1, f3, f4): Muster 0, Register 0 (keine gemischte Anrede), Unicode 0. Zwei Rhythmus-Treiber (`subject_initial_ratio` 0,884, gleich lange Absätze) entstehen, weil die Prüfdatei eine Liste einzelner UI-Sätze ist; laut Carve-out kein Befund. Eine Änderung aus der Prüfung: „Sie belegen kein Zitat“ (dritte Person, aber wie Anrede gelesen) heißt jetzt „Ein Zitat belegen sie nicht.“

## Englische Texte (humanizer)
- Audit aller 131 neuen oder geänderten Einträge in `en.json` (f2, f3, f5, f6, f7): keine Gedankenstriche, keine „not X but Y“-Muster, keine Werbe- oder Füllwörter, keine Chat-Reste. Geändert: „a number from 1 or “max”“ → „a number of 1 or more, or “max”“ (zweimal), „The direction is …“ → „The direction must be …“, „Open large“ → „Open in large view“. Gerade und typografische Anführungszeichen bleiben wie in Overleafs `en.json` gemischt (laut Skill allein kein Befund).

## Needs decision
