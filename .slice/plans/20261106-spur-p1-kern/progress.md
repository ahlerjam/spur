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

- f10 Langlauf: `SPUR_TOKEN=… node services/web/modules/spur/test/fake-client.mjs wait 700` gegen `http://localhost:8080/spur/mcp` (nginx): 23 Fortschrittsmeldungen von 30 s bis 690,1 s, größter Abstand 30,1 s, Ende nach 700,2 s mit Ergebnis, Exit 0.

## Recipe changes
- `spur-dev migrate up` schlägt fehl („Unrecognized command up“). Richtig ist `spur-dev migrate migrate -t server-ce`, `rollback` entsprechend. `CLAUDE.md` und Spec nennen die falsche Form.
- f5 `projectExpired`: `spur-dev run modules/spur/test/e2e/ablauf.mjs` → „projectExpired: Ordner und Einträge entfernt“.
- f5 Dump und Migration: vor `spur-dev dump` 305 Quellen, 629 Seiten, 3 Indizes. `spur-dev migrate rollback -t server-ce 20261107090000_spur_sources` → keine `spurS*`-Sammlungen mehr. `spur-dev migrate migrate -t server-ce`, `spur-dev restore` → wieder 305, 629, 3; `smith2024.pdf` lädt mit 200 und 4554 Byte `%PDF-1.5`.
- Extraktion mit `pdftotext -raw`: Die Standardausgabe setzt Trennungen am Zeilenende stillschweigend zusammen (auch echte Bindestriche wie „well-known“), dann gäbe es nie „mit Trennungstoleranz“. `-raw` folgt der Inhaltsreihenfolge, bei mehrspaltigen PDFs aus LaTeX ist das spaltenweise.
- f8 Mongo: `oauthAccessTokens` mit `scope: spur_mcp` enthält nur `accessToken` als SHA-256 (64 Zeichen, kein Klartext); Bots „Claude (e2e-a)“ und „Claude (e2e-leser)“ ohne Passwort, 0 Projektmitgliedschaften; nach Kontolöschung von `e2e-weg` kein Bot ohne Mensch mehr.
- f9 nginx: `curl -X POST http://localhost:8080/spur/mcp` → 401 (RFC 9457 `urn:spur:problem:token`), mit `Origin: https://evil.example` → 403. `claude plugin validate plugins/spur` und `claude plugin validate .` → „Validation passed with warnings“ (einzige Anmerkung: Installationszeile in der README, ergänzt).
- f9 Hinweis: `doc_edit`, `doc_create`, `run_status`, `run_finish` stehen in `tools/list`, antworten aber mit `nicht_verfuegbar`, bis f11 bis f15 gebaut sind.

## Fortsetzung (Resume mit neuem Turn-Budget)
- f10: Claude-Panel in der Rail (Status, Startbefehl, Auftrag, Verlauf, Lauf-Karte). Aufträge wecken wartende `wait_for_event`-Aufrufe im selben Prozess sofort, sonst spätestens nach 5 s; Herzschlag alle 5 s, „verbunden“ gilt 45 s. Fake-Client: `services/web/modules/spur/test/fake-client.mjs`.
- f11: Neuer document-updater-Endpunkt `POST /project/:id/doc/:doc_id/spur-update` (ADR 0002, erlaubter Kern-Patch) wendet Ops mit Version unter der Projektsperre über den normalen `applyUpdate`-Pfad an: OT gegen parallele Eingaben, Track Changes über `meta.tc`, Verteilung an Live-Clients ohne Modal. Läufe merken sich ihre tc-Seeds; daran erkennt spur die Changes eines Laufs. Vor dem ersten Schreiben legt spur das History-Label „Claude: Lauf“ an.
- f12: Prüf-Sperre prüft nur Zitate, die den geänderten Bereich berühren.
- f13 bis f15: Annehmen über den vorhandenen `acceptChanges`; Ablehnen wie im Editor (absteigend, Undo-Flag `u`), ohne geöffneten Editor; Rücknahme angenommener Läufe als neue Track Changes der Person, bei Überschneidung „Konflikt in Zeile …“ ohne Änderung. Automatik je Person und Projekt, nur per Browser-Session (PUT mit CSRF).

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
- Hinweis f8: `oauthAccessTokens` hat aus Overleaf einen TTL-Index (`accessTokenExpiresAt`, 86400 s). spur zeigt „Token abgelaufen, bitte erneuern“ deshalb einen Tag lang; danach verschwindet der Eintrag aus der Liste. Vorschlag: eigenes Feld für den sichtbaren Ablauf, falls der Hinweis länger stehen soll.

## Ansichten (taste, Quality bar)
- Screenshots bei 360 und 1280 px: Login, Editor mit Quellen-Panel, Quellenvorschau, Prüfbericht, Einstellungen mit „Claude verbinden“. Kein horizontaler Scroll in beiden Breiten.
- Behoben nach Sichtprüfung: abgeschnittene Knöpfe und Badges im Panel, doppelte „Zurück“-Beschriftung und unklare Seitenangabe in der Vorschau („Seite 347 (PDF-Seite 3 von 8)“), zerbrochenes Layout von „Claude verbinden“ bei 1280 px.
- Claude-Panel mit Lauf-Karte (f10–f15) bei 1280 und 360 px: Der Startbefehl stand als Wortspalte über die ganze Panelhöhe und schob die Karte aus dem Bild; jetzt einzeilig mit Scrollbalken und Knopf „Befehle kopieren“. Rote Auszüge wie `\footfullcite{…}` ragten aus der Karte; jetzt mit Umbruch. Bei 360 px gilt dieselbe Enge der IDE wie unten (Panel 47 px breit, Karte 23 px). Owner-Ansicht bei 1280 px geprüft: Annehmen je Änderung, „Alle annehmen“, „Lauf ablehnen“, Automatik-Schalter, Label-Hinweis.
- Offen (Kern, nicht im Diff): Bei 360 px ist die Overleaf-IDE mit Rail, Editor und PDF so eng, dass Panels nur wenige Zeichen breit sind; das gilt auch für Overleafs eigenen Dateibaum. Auf der Login-Seite zeigt Overleafs Registrierungsmodul den Schlüssel „sign_up“ statt eines Textes. Vorschlag: mobiles Layout der IDE und fehlende Übersetzung in einem eigenen Plan.
- `spur-dev test` bricht nach den Modul-Tests ab, sobald der Diff `services/document-updater` berührt: „Unbound variable TEST_NAME_PATTERN“ im `yarn run test:unit` des document-updater. `spur-dev` sollte `TEST_NAME_PATTERN=` setzen. Die Modul-Tests laufen davor vollständig.

## /simplify (f10 bis f15)
- Umgesetzt: ein gemeinsamer Client `spurUpdate` (Fehlerabbildung 409 `konflikt` und 404 `doc_fehlt`, Timeout; vorher bekam „Ablehnen“ bei Konflikten 500); document-updater erkennt Konflikte am Fehlertyp (`DeleteMismatchError`, sharejs-Versionsfehler) statt per Regex und liefert nur 204; `doc_edit` prüft Zitate nur, wenn im berührten Bereich eines steht; `doc_create` über `EditorController`, damit offene Editoren die Datei sehen; Docs eines Laufs parallel laden; Status-Abfragen parallel und Poll pausiert bei verstecktem Tab; `NotFoundError` statt leerem `catch`; ungültige Lauf-ID ergibt 404; totes `labelId`, Seed-Reste und leere Skip-Liste entfernt; Index `spurRuns` trägt `letzterLauf`.
- Nicht umgesetzt: gemeinsamer Hook für Fehlerzustand im Frontend (Umbau ohne Verhaltensgewinn); Zähler `aenderungen` bleibt, weil die Karte die Zahl der Bearbeitungen zeigt, auch nach Annahme; Bot-ID-Cache im Prozess; Long-Poll per Change Stream; `beforeunload` im Test bleibt unterdrückt, `gespeichert()` prüft den Serverstand.

## /code-review medium 46c92846db..HEAD (zweite Runde, nach f15)
- Behoben: `doc_create` auf vorhandenen Pfad leerte die Datei ungetrackt, jetzt `konflikt` (E2E f11); `doc_create` und `quote_mark` verlangen wie im Web readAndWrite/owner, `doc_edit` bleibt für `review` (E2E f13); Annehmen/Ablehnen auf abgeschlossenen Läufen ergibt 409 `lauf_abgeschlossen` (E2E f13); Idempotenz reserviert den Schlüssel vor dem Schreiben (Unique-Index statt findOne/insertOne) und lehnt einen Schlüssel aus einem anderen Projekt ab; `.bib`-Felder aus Crossref und Dateiname werden maskiert; `quelleKopieren` räumt Seiten, Zitate und Datei bei Fehlern weg; Migration `20261107130000_spur_quotes_index` (Indizes `quelleId`, `projectId`, `down` getestet), Rollbacks der beiden spur-Migrationen löschen jetzt alle spur-Sammlungen.
- Nicht übernommen: Veraltete Positionen bei „Lauf rückgängig“ – getrackte Löschungen stehen nicht im Text, das Annehmen verschiebt also keine Positionen. Spätere Edits fängt der Konfliktvergleich nur für Einschübe; eine Löschung setzt „Lauf rückgängig“ ungeprüft wieder ein, und hat jemand davor editiert, landet der Text an falscher Stelle (bekannte Grenze). Fix-Vorschlag: beim Annehmen den Kontext vor `op.p` speichern und beim Rückgängigmachen vergleichen. `.mcp.json` steht unter Needs decision. Pro `doc_edit` mit Zitat lädt `bereichPruefen` den Projektkontext neu (Crossref ist gecacht); ein Laufcache wäre Optimierung, kein Fehler.
- Ein vollständig angenommener oder abgelehnter, noch offener Lauf wechselt den Status; `run_finish` meldet danach `kein_lauf`, der nächste `doc_edit` beginnt einen neuen Lauf.

## /security-review (zweite Runde, Subagent, Befunde ≥ 8)
- Automatik nahm nach Herabstufung auf `review` weiter an: `nachLaufende` prüft jetzt die aktuelle Rolle (readAndWrite/owner, kein Link-Nutzer).
- MCP-Token blieben nach Kontosperre gültig: `ClaudeZugang.pruefen` weist gesperrte und fehlende Konten ab (wie `GitBridgePATManager`).
- Unbegrenzt viele gleichzeitige `wait_for_event`: pro Bot nur noch ein offener Long-Poll, ein neuer beendet den älteren. `max_sekunden` bleibt bei 3600, weil f10 über 11 Minuten verlangt.
- E2E nach den Fixes: f1–f15 ok; Unit-Tests 26 grün.

## Abschluss
- Letzter E2E-Lauf nach der letzten Code-Änderung (Panel-CSS): f1–f15 ok.
