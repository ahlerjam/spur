# Fortschritt 20261106-spur-p1-kern

## Needs decision
- f1, f8, f9, f10: Der Guard `guard-features.mjs post` meldet nach jedem Bash-Aufruf „features.json changed beyond the passes fields“. Grund: `d487908589` und `57ac447007` haben den Plan nach `d37369ca3f` geändert, ohne neuen Commit `slice: plan 20261106-spur-p1-kern` (`run/SKILL.md:33-34`). Soll die Plan-Markierung nachgezogen werden?
  Interim: Der Build folgt dem HEAD-Stand von `features.json` und ändert dort nur `passes`. Weder wird die alte Fassung wiederhergestellt noch legt der Builder selbst einen `slice: plan`-Commit an, denn damit würde er die Referenz des Guards verschieben, der ihn überwacht. Die Hook-Meldungen bleiben stehen; sie halten nichts auf, weil der Hook nach der Ausführung läuft.
  Options: A (empfohlen): Owner oder Orchestrator legt für künftige Läufe nach jeder Planänderung den Commit `slice: plan <id>` an | B: Guard vergleicht künftig mit dem Stand beim Laufstart

- f8, f9: Die Berechtigungsregeln des Laufs verbieten dem Builder, `plugins/spur/.mcp.json` zu schreiben. Ohne diese Datei installiert der angezeigte Befehl das Plugin samt Token, aber Claude Code bekommt keinen spur-Server. Soll der Owner die Datei anlegen?
  Interim: Plugin mit `plugin.json` (`userConfig` für `server_url` und `token`) und Skill; `claude plugin validate` besteht. Die MCP-Serverdefinition fehlt.
  Options: A (empfohlen): Owner legt `plugins/spur/.mcp.json` an mit `{"mcpServers":{"spur":{"type":"http","url":"${user_config.server_url}","headers":{"Authorization":"Bearer ${user_config.token}"}}}}` | B: Regel für Builder-Läufe lockern
- Kern-Patch außerhalb der Liste in ADR 0001: `ProjectDuplicator.mjs` feuert den neuen Hook `projectDuplicated` (eine Zeile), damit ein Klon den Hinweis „Quellen wurden nicht mitkopiert“ zeigt. Behalten?
  Interim: Hook-Zeile im Kern.
  Options: A (empfohlen): Hook behalten und ADR 0001 um ihn ergänzen | B: Modul-Lösung über `preDuplicateProject` plus Abgleich von Besitzer und Name, ohne Kern-Patch

## Menschlich zu prüfen
- f1: `make start` läuft im Builder nicht, und der Builder pusht nicht. `Publish` und `Smoke` sind deshalb noch nicht in der CI gelaufen. Bitte nach dem Merge `Publish` und danach `Smoke` starten. Lokal geprüft: `smoke-compile.mjs` im Stack, YAML-Syntax, `make -n start`. Nicht geprüft: der Inhalt der von `make start` erzeugten `.env`, weil der Builder `.env`-Dateien nicht lesen darf; das prüft der Schritt „Secret prüfen“ in `Smoke`.
- Hinweis zum Worktree: Ein Prüfbefehl des Builders lief wegen eines gescheiterten `mktemp` im Worktree-Wurzelordner und führte dort `make .env` aus. Dort liegt jetzt eine gitignorierte `.env`. Der Builder konnte sie weder lesen noch ihre Herkunft klären und hat sie nicht gelöscht. Falls dort vorher eine eigene `.env` lag, wurde sie vermutlich überschrieben. Sie wird nicht committet und von `spur-dev` nicht benutzt.

## Entscheidungen
- Finish-Basis: Die Skill-Formel ergibt `d37369ca3f^`. Dieser Diff enthält auch die Owner-Commits (Lockfile, MCP-Pakete, nginx). `/simplify` und `/code-review` laufen deshalb auf `46c92846db..HEAD`, also nur auf der Arbeit dieses Laufs.
- Sprache: Die Spec nennt deutsche Texte, die Sprache gilt pro Installation, und der Dev-Stack setzt keine. `settings.defaults.js` setzt deshalb `OVERLEAF_SITE_LANGUAGE` auf `de`, wenn nichts gesetzt ist; `OVERLEAF_SITE_LANGUAGE=en` stellt um.
- PageLabels: `pdfjs-dist` ist im Produktions-Image nicht vorhanden, gelesen wird mit `qpdf --json` aus dem Basis-Image.
- Vorschau: Seitenbild per `pdftocairo` plus markierbarer Text aus Mongo.
- Fehlertexte des Servers (`detail`) sind deutsch und werden noch nicht übersetzt (Vorschlag: Typ auf Sprachschlüssel abbilden).

## Testprotokoll
- f2 Parser: 2 097 228 Zeichen in 511 ms, 24 967 Zitate (`spur-dev test`, Test „parst ein 2-MB-Dokument“).

## Recipe changes
- `spur-dev migrate up` schlägt fehl („Unrecognized command up“). Richtig ist `spur-dev migrate migrate -t server-ce`, `rollback` entsprechend. `CLAUDE.md` und Spec nennen die falsche Form.
- f5 `projectExpired`: `spur-dev run modules/spur/test/e2e/ablauf.mjs` → „projectExpired: Ordner und Einträge entfernt“.
- f5 Dump und Migration: vor `spur-dev dump` 305 Quellen, 629 Seiten, 3 Indizes. `spur-dev migrate rollback -t server-ce 20261107090000_spur_sources` → keine `spurS*`-Sammlungen mehr. `spur-dev migrate migrate -t server-ce`, `spur-dev restore` → wieder 305, 629, 3; `smith2024.pdf` lädt mit 200 und 4554 Byte `%PDF-1.5`.
- Extraktion mit `pdftotext -raw`: Die Standardausgabe setzt Trennungen am Zeilenende stillschweigend zusammen (auch echte Bindestriche wie „well-known“), dann gäbe es nie „mit Trennungstoleranz“. `-raw` folgt der Inhaltsreihenfolge, bei mehrspaltigen PDFs aus LaTeX ist das spaltenweise.
- f8 Mongo: `oauthAccessTokens` mit `scope: spur_mcp` enthält nur `accessToken` als SHA-256 (64 Zeichen, kein Klartext); Bots „Claude (e2e-a)“ und „Claude (e2e-leser)“ ohne Passwort, 0 Projektmitgliedschaften; nach Kontolöschung von `e2e-weg` kein Bot ohne Mensch mehr.
- f9 nginx: `curl -X POST http://localhost:8080/spur/mcp` → 401 (RFC 9457 `urn:spur:problem:token`), mit `Origin: https://evil.example` → 403. `claude plugin validate plugins/spur` und `claude plugin validate .` → „Validation passed with warnings“ (einzige Anmerkung: Installationszeile in der README, ergänzt).
- f9 Hinweis: `doc_edit`, `doc_create`, `run_status`, `run_finish` stehen in `tools/list`, antworten aber mit `nicht_verfuegbar`, bis f11 bis f15 gebaut sind.

## Offen
- f10: Inbox-Werkzeuge `wait_for_event` (Long-Poll mit Herzschlag und Fortschritt alle 30 s), `events_since` und `reply` sind gebaut und in `tools/list`. Es fehlen das Claude-Panel im Editor (Status „Claude verbunden/nicht verbunden“ samt Startbefehl, Auftrag schreiben, Antworten sehen), die Route zum Anlegen eines Auftrags, der Fake-Client unter `services/web/modules/spur/test` und der Test über 11 Minuten durch nginx. Grund: Turn-Budget des Laufs, Abschlussschritte haben Vorrang.
- f11 bis f15: Nicht begonnen. Sie hängen am neuen Schreibweg über einen document-updater-Endpunkt mit Ops und Version (ADR 0002), an Läufen und an der Lauf-Karte. `doc_edit`, `doc_create`, `run_status` und `run_finish` stehen im Vertrag und in `tools/list`, antworten aber mit `nicht_verfuegbar`.
- E2E: Die offenen Features melden im Lauf „übersprungen“ mit Grund.

## /simplify
- Umgesetzt: Prüfung lädt Seitentexte nur für getroffene Quellen; Flush und Projektabfrage parallel; Cache-Stempel einmal je Bericht; Zeilennummern per Binärsuche; Suche lädt nur Namen der Trefferquellen; `project_list` blättert vor der Rollenabfrage; `dev-schalter.json` nur bei geänderter mtime neu lesen; toter Code (`fakeAgent`, ungenutzte Inbox-Funktionen und Exporte) entfernt; abgeleitete Auswahl im Holen-Dialog; E2E ohne feste Wartezeiten und ohne `removeAllListeners`.
- Nicht umgesetzt:
  - Gemeinsamer Hook für Fehlerzustand in den Panels (rund 20 Stellen): Umbau über 7 Komponenten ohne Verhaltensgewinn, Vorschlag für später.
  - `shared/bibtex/parser` statt eigenem `.bib`-Parser: Import einer `.mts`-Datei aus Server-Code ist im Lauf nicht erprobt; Vorschlag, weil der Regex-Parser bei `@` am Zeilenanfang in Feldern versagen kann.
  - `fetch-json.ts` statt `api.ts`: `api.ts` liest das `detail` aus Problem-JSON und kann PATCH; Umstieg später prüfen.
  - Stub-Werkzeuge entfernen: f9 verlangt alle P1-Tools in `tools/list`.
  - Sprach-Default in `server-ce/config/settings.js`: Die Datei wird im Dev-Stack nicht eingehängt.
  - `setuid` statt `chown` in Skripten: im Container nicht erprobt.
  - Long-Poll über EventEmitter statt Mongo-Abfrage je Sekunde: gehört zu f10.

## /code-review medium 46c92846db..HEAD
- Behoben: leerer Beleg (`\cite{}`) brachte den Bericht zum Absturz; Seitenlabel beim Einfügen wird frisch gelesen; MCP-Abbruch hängt an `res.on('close')`; doppelter Upload liefert 409 und räumt auf; Versatz nur für PDF; Seitenbild für VTT gibt 404 statt 500; DOI ohne Satzzeichen am Ende; Crossref höchstens 5 parallel.
- Nicht umgesetzt: fehlende MCP-Definition im Plugin (siehe Needs decision, Datei für den Builder gesperrt); „Hilfsskripte im Repo“ (`seed.mjs` und `smoke-compile.mjs` verlangt die Spec, alles andere liegt in Testordnern, die die Quality Bar erlaubt).

## /security-review
- Kein Befund mit Confidence ≥ 8. Kandidat mit 7 behoben: MCP-Werkzeuge sperren Leselink-Nutzer wie `blockRestrictedUserFromProject` im Web, `project_list` zeigt keine reinen Leselink-Projekte mehr.
- Info, nicht geändert: Nutzer mit Bearbeiten-Link können Seitenbilder und Seitentext ansehen, nur den PDF-Download nicht (so verlangt es f3). Reviewer dürfen über `quote_mark` markieren (Spec: `review` schreibt).
