Type: web, api

# spur P5: Nachbesserungen aus der Abnahme

## Zweck
Der Owner hat P1 bis P4 am laufenden System abgenommen und eine Liste von Nachbesserungen festgelegt. Dieser Plan setzt sie um, bevor PR #2 gemergt wird. Alle Inhalte sind in der Abnahme entschieden; der Lauf stellt keine Rückfragen zu ihnen.

## Nutzer
Wie P1 bis P4: Forschende, die in spur schreiben, ihre Quellen verwalten und ihr eigenes Claude Code anbinden. Dazu Betreiber, die spur nach README installieren.

## Was Nutzer danach können
- spur überall als „spur“ erkennen, ohne Overleaf-Logo.
- Projekte mit „Stichwörter“ ordnen, ohne dass das Seitenmenü seitlich rollt.
- Claude Code mit einer klaren Anleitung in drei Schritten verbinden, jeden Befehl einzeln kopieren.
- In spur durchgehend geduzt werden, wie in Overleaf.
- Fehlermeldungen von spur in der Sprache der Installation lesen, Deutsch oder Englisch.
- Eine Quelle groß öffnen, darin blättern, zoomen und Zitate markieren.
- Claude mit dem Workflow „Quellen sammeln“ zu einem Thema Literatur suchen, bewerten und aufnehmen lassen.
- README und Doku auf Englisch lesen.

## Context
- Kopf von Projektliste und Einstellungen zeigt `nav.title` als Text, wenn kein `custom_logo` gesetzt ist. Der Editor zeigt oben links Overleafs Logo über CSS (`--redesign-toolbar-logo-url`) in `ToolbarLogos`; dafür gibt es keinen Schalter.
- Rechte Fußzeile kommt aus `nav.right_footer` in den Web-Defaults („spur auf GitHub“). Die Zeile „Overleaf CE+“ steht fest im Seitenmenü-Code von overleaf-cep. „Stichwörter organisieren“ ist Overleafs Übersetzung von `organize_tags`; der lange Text macht das Seitenmenü bei 1280 px 267 statt 221 px breit.
- Der Token-Dialog („Claude verbinden“ in den Kontoeinstellungen) zeigt heute alle drei Befehle in einem Block mit einem Kopierknopf. Das Claude-Panel zeigt den Startbefehl; im schmalen Panel wird er abgeschnitten.
- 20 deutsche spur-Texte siezen, Overleaf duzt.
- 88 Stellen `new Problem(status, typ, detail)` im Modul mit fest deutschem `detail`. Das Frontend zeigt `detail` direkt, MCP gibt es als Werkzeugfehler weiter. Overleaf übersetzt serverseitig über `req.i18n`; die Sprache gilt für die ganze Installation (`OVERLEAF_SITE_LANGUAGE`). Problems entstehen oft ohne `req` in Managern.
- Quellen-Vorschau: Werkzeugleiste mit Zurück, Seitenangabe, Vorherige/Nächste Seite; darunter Seitenbild, Seitentext und Zitate (Markieren über Textauswahl im Seitentext).
- Workflows: Definition in den Standardtexten, MCP-Prompts, Routen, Admin-Seite und Panel lesen die Liste dynamisch. Fest eingetragene Namenslisten gibt es in README, MCP-Vertrag, Befehlsnamen-Test, Unit- und Frontend-Tests und der E2E-Suite.
- Doku auf Deutsch: README, `CLAUDE.md`, `docs/backlog.md`, `docs/mcp-vertrag.md`, fünf ADRs, die Plugin-Anleitung (SKILL.md).
- E2E: eine Datei mit `features.<id>`; neue Features als `p5f1` …; viele Schritte klicken auf deutsche Texte.

## Decisions
Owner-Entscheidungen aus der Abnahme (2026-11-09):
- Logo: überall einheitlich „spur“, auch im Editor statt des Overleaf-Logos. Grund: Overleafs Logo-Seite verlangt eine Rückfrage vor der Nutzung, und das Logo darf keine Unterstützung durch Overleaf nahelegen. Die Herkunft zeigt die Zeile „Overleaf CE+ · spur“.
- Seitenmenü: Überschrift „Stichwörter“ (englisch „Tags“); unterste Zeile „Overleaf CE+ · spur“; Fußzeile rechts „spur @ GitHub“ mit Link auf https://github.com/ahlerjam/spur.
- Token-Dialog: Anleitung in drei Schritten mit eigenem Befehlskasten und Kopierknopf je Befehl. Texte (mit humanizer-de geprüft, so übernehmen):
  - Überschrift „So verbindest du Claude Code“, darunter „Deinen Schlüssel siehst du nur jetzt. Kopiere die Befehle, bevor du die Seite verlässt.“
  - „1. spur bei Claude Code bekannt machen“ – „Das brauchst du nur einmal pro Rechner.“
  - „2. spur mit deinem Konto verbinden“ – „Der Befehl enthält deinen persönlichen Schlüssel. Gib ihn nicht weiter.“
  - „3. Claude Code starten“ – „Starte damit Claude Code im Terminal. Claude darf dann in spur schreiben, ohne bei jedem Schritt nachzufragen. Den Befehl brauchst du bei jedem Start; er steht auch im Claude-Panel deines Projekts.“
  - Knopf „Kopieren“, danach „Kopiert“. Englische Fassung sinngemäß, mit humanizer geprüft.
  - Lange Befehle brechen im Kasten um und werden nie abgeschnitten; dasselbe gilt für den Startbefehl im Claude-Panel, der denselben Kasten mit Kopierknopf bekommt.
- Anrede: alle deutschen spur-Texte duzen. Neue und geänderte deutsche Texte mit dem Skill humanizer-de prüfen (Modus sachlich).
- Fehlermeldungen: alle Meldungen des spur-Servers kommen aus den Sprachdateien, Deutsch und Englisch, und folgen der Sprache der Installation, nicht dem Browser. Das gilt auch für Fehler, die Claude über MCP sieht. Jede Meldung bekommt einen eigenen Sprachschlüssel; Werte wie Zahlen oder Namen werden als Platzhalter eingesetzt. Der Fehlercode (`typ`) bleibt unverändert, er ist Teil des Vertrags.
- Quelle groß öffnen: Knopf „Groß öffnen“ in der Quellen-Vorschau. Die große Ansicht liegt über dem Editor, hat Blättern, Zoom (Schritte 75 %, 100 %, 125 %, 150 %, 200 %; Start 100 %) und Zitat-Markieren wie im Panel; Esc oder „Schließen“ beenden sie, der Fokus geht zurück auf „Groß öffnen“. Die Werkzeugleiste im Panel passt bei 1280 px und Standardbreite des Panels in eine Zeile.
- Workflow „Quellen sammeln“ (Schlüssel `quellen_sammeln`, Befehl `/plugin:spur:spur:quellen_sammeln`): Eingaben Thema (Pflicht, Freitext) und Anzahl (Zahl ab 1 oder „max“, Standard 20). Ablauf im Workflow-Text:
  1. Suche zum Thema in allen Recherche-Diensten, mehrere Suchbegriffe; Zitationen der stärksten Treffer in beide Richtungen folgen.
  2. Vorauswahl nach Relevanz zum Thema und Zitationszahl; Paper, die schon Quelle im Projekt oder auf der Beschaffungsliste sind, überspringen.
  3. Abstract jedes vorausgewählten Papers lesen und als „wichtig“ oder „nicht wichtig“ bewerten, mit einem Satz Begründung.
  4. Wichtige frei verfügbare Paper als Quelle aufnehmen, wichtige nicht freie auf die Beschaffungsliste setzen, bis die Anzahl erreicht ist; bei „max“ ohne Obergrenze, in Etappen.
  5. Lauf mit Zusammenfassung beenden: wie viele gefunden, bewertet, aufgenommen, auf die Beschaffungsliste gesetzt; je Paper Titel, Entscheidung und Begründung; Hinweis, dass als Nächstes „Literaturüberblick“ passt.
  Der Text folgt den Regeln der anderen Workflows (Quellentext nicht vertrauenswürdig, nichts erfinden). Admins können ihn wie die anderen ändern.
- Doku: README, alle Dateien unter `docs/`, `CLAUDE.md` und die Plugin-Anleitung auf Englisch, mit dem Skill humanizer geprüft. Das Backlog behält alle Einträge, auch die schon erledigten zu Transformers und Tesseract. Die Installation in der README nennt Voraussetzungen, `make start`, das erste Admin-Konto, Einstellungen, Sprache, öffentlichen Betrieb mit Sandbox und HTTPS, Backup.
- Annahmen (ohne Rückfrage getroffen):
  - Der Schriftzug „spur“ im Editor ist Text im Stil der Toolbar, kein neues Bild; Klick führt wie bisher zur Projektliste, mit zugänglichem Namen „spur, zur Projektliste“.
  - Liefern die Recherche-Werkzeuge kein Abstract, werden `paper_search` oder `paper_lookup` um das Abstract erweitert (aus den Diensten, die es liefern), mit Tests; Paper ohne Abstract bewertet Claude nach Titel und kennzeichnet das in der Zusammenfassung.
  - „max“ heißt ohne feste Obergrenze; Antworten bleiben unter der Grenze von 10.000 Tokens, Claude arbeitet in Etappen.
  - Doku-Dateien bekommen englische Namen; alle Links darauf werden mitgeändert. Code-Kommentare bleiben deutsch.
  - Bestehende E2E-Schritte, die auf deutsche Texte klicken, werden an die neuen Texte angepasst; ihr Sinn bleibt gleich.
  - Recherche-Dienste und Claude laufen im Test mit den vorhandenen Fakes (`SPUR_FAKE_AGENT=1`, Paper-Fake), wie in P2 und P3. Der echte Lauf mit Claude ist Handprüfung nach dem Merge.

## Quality bar
- Web: alles per Tastatur bedienbar mit sichtbarem Fokus; Kontrast mindestens 4,5:1; jedes Feld hat ein Label; Klickziele mindestens 24 × 24 px; kein horizontales Rollen bei 360 px; keine Konsolenfehler; keine nativen `alert`/`confirm`/`prompt`. Nach Schließen eines Dialogs geht der Fokus an eine sinnvolle Stelle.
- Jede Ansicht hat ihren leeren, ladenden und Fehlerzustand; Fehlermeldungen sagen, was passiert ist und was zu tun ist.
- Aussehen nach dem Skill `taste`, im Overleaf-Stil.
- Texte: deutsch geduzt, mit humanizer-de geprüft; englische Texte und Doku mit humanizer geprüft.
- API und MCP: Fehlercodes bleiben stabil; nur die Meldungstexte werden übersetzt.

### Tests (TDD)
- Jede Änderung an Server- oder Frontend-Logik beginnt mit einem roten Test (vitest im Modul, Frontend-Tests wie bisher).
- Ein Test prüft, dass jeder `spur_`-Schlüssel in `de.json` und `en.json` steht.
- Ein Test prüft, dass keine spur-Fehlermeldung mehr als fester Text im Code steht und jede Meldung in beiden Sprachen vorliegt.
- Ein Test prüft, dass kein deutscher spur-Text siezt („Sie“, „Ihr“, „Ihre“, „Ihnen“ als Anrede).
- Die fest eingetragenen Workflow-Listen (README, MCP-Vertrag, Befehlsnamen-Test, Unit-, Frontend- und E2E-Tests) kennen den vierten Workflow.
- Die E2E-Suite bekommt `p5f1` bis `p5f8` und läuft nach dem Zurücksetzen der Testdaten vollständig grün, auch alle älteren Features.
- Overleafs eigene Suiten bleiben grün bis auf die bekannte Upstream-Liste.
