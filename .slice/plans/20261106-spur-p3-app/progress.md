# Fortschritt 20261106-spur-p3-app

Alle fünf Features bestehen ihre E2E-Schritte (`p3f1` bis `p3f5` in `services/web/modules/spur/test/e2e/spur-e2e.js`).

## Recipe changes
- Wie in P2 und P4: Das Setup-Skript der Cloud-Umgebung war nicht gelaufen (kein `spur-dev`, Docker ohne Images). Der Builder hat den unveränderten Stand mit `bash tools/spur-dev/spur-dev install --cloud` installiert und `dockerd` gestartet; `spur-dev up` zog die Images.
- E2E: Chromium startet in dieser VM aus der Bash. Ein Läufer im Scratchpad wie `test/e2e/run.mjs` lädt Playwright aus `/opt/node-tools` und führt `spur-e2e.js` aus (optional `about:blank#p3f1,p3f2`).
- `spur-dev run …/vorbereiten.mjs` gibt viele Log-Zeilen aus; `| tail -1` reicht (keine Sandbox in der Cloud-VM).

## Entscheidungen
- E2E-Schlüssel `p3f1` bis `p3f5`. Eigene Konten `e2e-p3a` (Ada) und `e2e-p3b` (Bo) mit festen Test-Tokens `spur_e2e_p3a` und `spur_e2e_p3b`, Projekte „E2E Chat“, „E2E Kommentar“, „E2E Vorschläge“, „E2E Workflows“.
- f1 verlangt „kein Eingabefeld“ ohne Verbindung. Das ändert P1-Verhalten: Der Teil von `f10`, der den leeren Auftrag prüft, läuft deshalb erst nach `warteStarten`. Die Prüfungen selbst sind unverändert.
- Ein Chat-Text aus dem Panel bleibt `task_created` (wie in P1; `f10` prüft das). `chat_message` bleibt im Vertrag reserviert.
- Workflow-Knöpfe gibt es wie das Eingabefeld nur mit Verbindung. Im Chat steht für einen Workflow „Workflow: <Titel>“, der volle Text geht nur in das Ereignis.
- Kommentare und Compiles beobachtet spur per `appMiddleware` (`Beobachter.mjs`), ohne Overleafs Controller anzupassen (ADR 0001: wenige Kern-Patches). Ein Kommentar zählt nach der Antwort 204; ein Compile über die JSON-Antwort mit dem Build aus `outputFiles` (Overleaf CE liefert kein `buildId` oben).
- Overleaf schickt die Kommentar-Nachricht vor der Kommentar-Op. spur sucht die Stelle deshalb bis zu 10 s (20 × 500 ms) in den Ranges; findet es sie nicht, geht das Ereignis ohne Dokument und Stelle hinaus.
- `@claude` zählt als eigenes Wort (nicht in `mail@claude.de` oder `@claudette`), ohne Rücksicht auf Groß- und Kleinschreibung. Ohne eigenes Claude (kein Bot) passiert nichts.
- Auto-Compiles lösen keine Vorschläge aus, nur Compiles per Knopf; sonst fräße das automatische Kompilieren das Tageslimit.
- Compile-Fehler: Fehler laut LaTeX-Log (`fehlerAusLog`), auch wenn Overleaf den Compile als „success“ meldet.
- Tipp-Pause: Eine CodeMirror-Erweiterung meldet 60 s nach der letzten eigenen Eingabe (`input`/`delete`) einmal `tipp-pause`; der Server prüft Schalter und Limit. Wechselt die Person vor Ablauf das Dokument, entfällt die Meldung.
- Projekt-Standard setzen dürfen Schreibende (`readAndWrite`, Owner), die eigene Einstellung alle Mitglieder. „Neue Mitglieder“ prüft die E2E mit Bo, der vor dem Setzen des Standards keine eigene Einstellung hatte.
- Tageslimit: je Person, für alle Projekte zusammen, Tag ab Mitternacht der Serverzeit (`jetzt()`). Gezählt werden erzeugte `suggest_trigger`, nicht abgewiesene Auslöser.
- Vorschläge legt Claude schon mit Leserecht ab (`suggest` schreibt nichts ins Dokument); „Übernehmen“ legt einen normalen Auftrag an, den Lauf startet erst `doc_edit` mit den Rechten der Person.
- MCP-Prompts haben ein optionales Argument `fokus` (ein Wort, höchstens 60 Zeichen), das eine Zeile „Fokus: …“ anhängt. Ohne Argument ist der Text gleich dem des Panel-Knopfs.
- Workflow-Admin unter `/spur/admin/workflows` (nur Site-Admins); Texte in `spurWorkflows`, ohne Zwischenspeicher gelesen.
- Neue Sammlungen `spurSuggestions`, `spurWorkflows`; Indizes in `tools/migrations/20261108200000_spur_app.mjs`. Vorschläge gehen beim Löschen von Konto und Projekt mit.

## Gefundene Fehler (mit Test behoben)
- Chat-Verlauf sortierte nach `_id`. Panel (web) und MCP (web-api) erzeugen ObjectIds mit eigenem Zufallsteil; in derselben Sekunde stand eine Antwort vor der Frage. Jetzt nach `am`.

## Menschlich zu prüfen
- f5, Schritt 2 mit installiertem Plugin: In Claude Code 2.1.319 meldet `claude -p --mcp-config` mit einem Server namens `spur` die Befehle `mcp__spur__literaturueberblick`, `mcp__spur__methodenteil` und `mcp__spur__folien`; laut Doku (code.claude.com/docs/en/mcp.md, „Use MCP prompts as commands“) zeigt das Menü sie als `/spur:literaturueberblick (MCP)` usw. Über das Plugin (`--plugin-dir plugins/spur`) startete der Server headless nicht, weil `userConfig` (Adresse, Token) fehlt; ob das Menü bei Plugin-Servern `spur` oder `plugin:spur:spur` zeigt, sagt die Doku nicht. Bitte einmal im Terminal mit installiertem Plugin `/` tippen und die Namen ansehen.
- Weckweg je Meilenstein (laut Spec): `@claude` im Kommentar und ein Fehler-Compile mit Schalter „Vorschlag“ wecken eine wartende echte Claude-Session; Claude antwortet im Thread beziehungsweise legt einen Vorschlag mit `suggest` ab.

## Needs decision
- f5: Soll das Menü in Claude Code `/spur:…` zeigen, auch wenn Claude Code Plugin-Server anders benennt?
  Interim: Server im Plugin heißt `spur`, Prompts heißen wie in der Spec; nicht weiter angepasst.
  Options: A (empfohlen) so lassen und nach dem Handtest entscheiden | B Prompts zusätzlich als Plugin-Befehle ausliefern (widerspricht „keine Workflow-Skills im Plugin“)

## Vorschläge
- `events_since` sortiert nach `_id`. Solange alle Ereignisse im web-Prozess entstehen, ist das sicher; entstünden Ereignisse auch in web-api (MCP), könnte ein Cursor ein Ereignis aus derselben Sekunde überspringen. Dann einen monotonen Zähler je Bot einführen.
- Bot-Namen folgen nicht, wenn eine Person ihren Vornamen ändert (Bot heißt weiter „Claude (alter Name)“).
