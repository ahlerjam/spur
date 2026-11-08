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

## /simplify (c823be1f51..HEAD)
Der Plan-Commit liegt vor 90 Commits aus P2 und P4, die danach in diesen Zweig kamen; geprüft wurde deshalb nur der Diff dieses Laufs ab `c823be1f51`.
- Umgesetzt: `anfrage.mjs` mit `projektId`, `menschId` und einer lesenden Bot-Suche `botVon` (vorher dreifach); das Vorschläge-Panel sucht den Bot je Abfrage einmal (`Vorschlaege.panel`); `ausloesen` bricht bei Schalter Aus ab, bevor es zählt, und nimmt `daten` immer als Funktion; `erledigen` liefert nur den Vorschlag; `@claude` sucht in der Schleife nur die Ranges und liest die Dokumente einmal, Threads parallel; die Workflow-Liste im Panel ohne Text; ein `useAbfrage`-Hook für beide Panels; `admin`-Middleware einmal.
- Nicht umgesetzt: Hook statt `res.json`-Hülle im Compile-Beobachter (ADR 0001: keine neuen Kern-Patches); gemeinsamer Cursor für `seit` (siehe Vorschläge); Löschlisten aus einem Sammlungsregister ableiten (berührt P1/P2-Code); `ARTEN` vom Server ans Panel liefern; `useAktion`-Helfer für die vielen try/catch in allen Panels (weit über den Diff hinaus).
- `tsc --noEmit` meldet in spur nur Fehler, die vor diesem Lauf schon bestanden (`ref` am Auftragsfeld in `claude-panel.tsx`, Testdaten in `ocr.test.tsx` und `zitate.test.tsx`).

## /code-review medium c823be1f51..HEAD
- Umgesetzt: „Übernehmen“ stellt den Vorschlag wieder auf offen, wenn der Auftrag nicht angelegt werden kann; `suggest` lehnt ab 100 offenen Vorschlägen je Projekt mit `vorschlaege_voll` ab (so viele zeigt das Panel); Formatierung eines Typs.
- Nicht umgesetzt: Tageslimit atomar zählen (gleichzeitige Auslöser überschreiten es höchstens um wenige); Herkunft der `doc_id` bei der Tipp-Pause prüfen (betrifft nur das eigene Limit, `doc_read` prüft die Rechte); Suche nach der Kommentarstelle bis 10 s ist gewollt; Compile-Log auch bei „success“ lesen ist gewollt (LaTeX-Fehler mit PDF); `fokus` stammt aus dem eigenen Claude Code der Person.
- Abgleich mit Spec und Schritten: Zustände des Chats (nicht verbunden, wartet, antwortet, lange Unterhaltung) und der Vorschläge (aus, keine, mehrere, Tageslimit) sind gebaut; Tastatur (Strg+Enter, Knöpfe) und `role="log"` für Screenreader. Offen bleibt nur der Handtest aus „Menschlich zu prüfen“.

## Security-Review (Subagent; `/security-review` findet ohne `origin/HEAD` keinen Vergleichsstand)
- Umgesetzt: Index `users.spur.botFuer` (jede Panel-Abfrage sucht den Bot); `@claude` höchstens 20 je Person und Minute, vor der Suche in den Ranges (eine Erwähnung mit erfundener Thread-ID kostet sonst 10 s Docstore-Abfragen); Rate-Limit für `tipp-pause` (10 je Minute).
- Nicht umgesetzt: Tageslimit atomar (Überschreitung nur um gleichzeitige Auslöser, nur beim eigenen Bot); `doc_id` der Tipp-Pause gegen das Projekt prüfen (`doc_read` prüft); übernommene Vorschläge stärker kennzeichnen (Auftrag trägt `vorschlag_id` und „Bitte diesen Vorschlag umsetzen“); `null`-Filter in `spurSettings` (keine andere Dokumentart betroffen).
- Gefunden, nicht aus P3: `recherche.test.mjs` „vergibt arXiv-Fenster im Abstand von 3 Sekunden, auch parallel“ schlug in einem vollen Lauf unter Last einmal fehl, danach viermal grün (Zeitmessung).

## Ansichten (360 und 1280 px)
Chat nicht verbunden, lange Unterhaltung mit Lauf-Karte, Workflows, Vorschläge mit Karten, Kommentar-Thread mit Antwort „Claude (Ada)“, Workflow-Admin: kein horizontaler Überlauf, keine Konsolenfehler.
- Behoben nach den Bildern: Uhrzeit in der Sprache der Oberfläche ohne Sekunden; Claude-Akzent grün statt blau (blau liest sich wie Fokus); Vorschläge-Panel einspaltig (Auswahlen waren bei 1280 px abgeschnitten, das Limit-Feld wenige Pixel breit), „Projekt: Aus“ statt „Projekt-Standard: Aus“; Admin-Seite mit Overleafs Navigationsleiste (`header-footer-react`) und Abstand darunter, „Standard“ als Text statt Badge mit zu wenig Kontrast.
- Gesehen, so gelassen: Die Reihenfolge „Antwort 098, 097, 099“ im Testbild kommt aus 100 parallel gesendeten `reply` in derselben Millisekunde (nur Testdaten).
