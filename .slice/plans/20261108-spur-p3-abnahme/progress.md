# Fortschritt 20261108-spur-p3-abnahme

## Recipe changes
- Stack lief schon (`spur-dev` installiert, Docker bereit). `spur-dev up` mit `services/web/modules/spur/dev-schalter.json` = `{"SPUR_PAPER_API_BASE": "http://127.0.0.1/spur/dev/crossref", "SPUR_FAKE_AGENT": "1"}`.
- `SPUR_FAKE_AGENT` liest kein Code; Claude ersetzt in Tests der Fake-Client `services/web/modules/spur/test/fake-client.mjs` (und dessen Gegenstück im Browser, `warteStarten` in der E2E-Suite). Der Schalter steht trotzdem in der Datei, wie die Spec sagt.
- E2E wie in P3: Läufer im Scratchpad lädt Playwright aus `/opt/node-tools` und führt `spur-e2e.js` aus. Die Abnahme lief mit einem eigenen Skript im Scratchpad, das die Helfer der E2E-Datei verwendet, jeden Schritt am laufenden System ausführt, die Beobachtung ausgibt und bei 360 und 1280 px aufnimmt (Überlauf von Seite und Panel, Konsolenfehler).

## Entscheidungen
- Die Panel-Hilfe steht unter „Workflows“ unter den drei Knöpfen: „Befehle in Claude Code“ und die drei Befehle. Präfix in `frontend/js/claude/workflow-befehl.ts`; die Admin-Seite nutzt ihn auch (vorher `/spur:<name>`). Umbruch nur nach dem Präfix (`<wbr>`), sonst brach der Befehl im schmalen Panel mitten im Wort.
- README: Tabelle der drei Befehle unter „Claude und Ihre Daten“, direkt nach der Plugin-Einrichtung.
- Test für die Befehlsnamen: `tools/tests/befehlsnamen.test.mjs` (`node --test`), weil die README nicht in den Container eingehängt ist; dazu Frontend-Tests für Panel und Admin-Seite.
- `/spur:lauf` in `docs/adr/0003-anbindung-eigenes-claude.md` bleibt: Das ist ein Plugin-Skill (`plugins/spur/skills/spur`), kein Workflow-Prompt; Plugin-Skills heißen in Claude Code `/<plugin>:<skill>`.
- Verlauf im Claude-Panel: höchstens 500 Nachrichten statt 100; gibt es ältere, sagt das Panel „Ältere Nachrichten sind ausgeblendet; angezeigt werden die letzten 500.“ (siehe Gefundene Fehler).

## Gefundene Fehler (mit Test behoben)
- P3-f1, Schritt 3: Der Verlauf lud nur die neuesten 100 Nachrichten. Nach 100 gesendeten Nachrichten mit Antworten fehlten nach dem Neuladen die ersten, ohne Hinweis. Rote Tests in `inbox.test.mjs` (202 Nachrichten vollständig; ab 501 genau 500 und `aeltere`), `spurController.test.mjs` und `claude-panel.test.tsx`; dann `Inbox.verlauf` mit Grenze 500 und Flag `aeltere`. Die E2E prüft nach dem Neuladen jetzt genau 102 Nachrichten samt der ersten Frage statt „mindestens 100“.
- E2E-Helfer `ereignisseVon` las nur die erste Seite von `events_since` (100 Ereignisse). Bei mehr Ereignissen sah die Suite neue nicht (in der Abnahme nach 100 Panel-Nachrichten: „comment_mention: 0 statt 1“). Jetzt folgt er dem Cursor. `werkzeug` meldet eine Antwort ohne `result` mit Status und Text statt eines TypeError.
- Vorschläge-Panel: Die Meldung „Claude hat den Auftrag …“ stand in einem Notification-Kasten, dessen Symbolspalte den Text im schmalen Panel Wort für Wort umbrach (Bild bei 1280 px). Jetzt eine Zeile mit grünem Rand wie beim Tageslimit.

## Nach der unabhängigen Abnahme (f4 wieder offen)
Befund: `spur-e2e.js` nach `vorbereiten.mjs` nicht vollständig grün, `p3f2` scheitert wiederholt („Bo meint …“ im Review-Panel nicht sichtbar); auf Daten eines früheren Laufs scheitern f3, f4, f5, f7, f8, p2f4 bis `vorbereiten.mjs` läuft. f4 auf `passes: false` gesetzt.
- Nachgestellt: Lauf A nach `vorbereiten.mjs`: 33/34, `p2f4 FEHLER: Link: https://doi.org/10.5555/spur.2024.001`. Lauf B direkt danach ohne `vorbereiten.mjs`: 27 Features FEHLER (f3, f4, f5, f7, f8, f10, f11, f13–f15, p2f1, p2f3–p2f10, p4f1–p4f3, p3f1–p3f4).
- Ursache Wiederholung: Die Suite setzt den Zustand von `vorbereiten.mjs` voraus (leere Quellenlisten, Texte, Token, Schalter). Behoben an der Wurzel: `vorbereiten.mjs` exportiert `e2eDatenVorbereiten()`; die Dev-Route `POST /spur/dev/e2e/vorbereiten` (nur mit `SPUR_DEV`, lädt das Testmodul erst beim Aufruf, gleichzeitige Aufrufe teilen einen Lauf) ruft sie im Web-Prozess auf; die Suite ruft die Route vor dem ersten Feature. Unit-Tests in `devSchalter.test.mjs` (204, ein gemeinsamer Lauf, 500 mit Text) und `spurRouter.test.mjs` (Route nur in Dev). Die Tests entstanden vor dem Code, ich habe sie aber nicht rot laufen lassen. Als Skript bleibt `vorbereiten.mjs` gleich (danach `ablageFreigeben`, nur als root nötig).
- Ursache `p2f4`: Der Test las den Bibliothekslink direkt nach „Link zur Bibliothek gespeichert“, bevor die Liste neu geladen hatte. Jetzt wartet er bis 10 s auf den neuen `href`.
- Ursache `p3f2`: Nach dem Laden ist auf einem langsamen Rechner das Review-Panel gewählt, die Leiste aber eingeklappt. Overleaf zeigt den Kommentar dann nur als Marke am Rand, und die trägt auch die Klasse `.review-panel-entry`. Der Test hielt den Eintrag deshalb für sichtbar, und das Antwortfeld blieb unsichtbar. Nachgestellt mit CPU-Drosselung per CDP: alter Test bei 20× `p3f2 FEHLER: locator.click … .review-panel-comment-input … element is not visible`, bei 6× grün. Bild im Fehlerfall: Review-Tab gewählt, Leiste zu, Marke 25 × 16 px am Rand. Behoben: `reviewEintrag` wartet auf den sichtbaren Kommentartext. Das allgemeine `panelSichern(tab, bereit)` klickt den Tab, bis `bereit` sichtbar ist, und einen gewählten Tab erst nach 3 s erneut (eingeklappte Leiste). Ein Zwischenstand, der nur „irgendwie sichtbar“ prüfte, scheiterte bei 20× zweimal und ist verworfen. Mit der Prüfung auf den Text bei 20× viermal `p3f2 ok` (117–127 s).
- Beleg Wiederholbarkeit: Lauf C auf den schmutzigen Daten von Lauf B, ohne `vorbereiten.mjs`: 34/34 ok (504 s). Lauf D direkt danach: 34/34 ok (496 s).

### /simplify auf den Korrekturen (1611ebbaf5..HEAD)
- Umgesetzt: ein allgemeines `panelSichern(tab, bereit)` statt eines nur für das Review-Panel gebauten Helfers (Altitude). Es wählt den Tab, bis `bereit` sichtbar ist, und klickt einen schon gewählten Tab erst nach 3 s erneut. `panelOeffnen`, `reviewEintrag`, der Dateibaum in `bibText`/`texErsetzen` und das Review-Panel in f11 nutzen es. Abfrage alle 250 ms statt 1 s. `p2f4` hat eine einzige Wartebedingung mit Meldung statt `waitFor().catch()` plus zweitem Vergleich. Die Dev-Route hat kein Sperr-Promise mehr (einziger Aufrufer ist die serielle Suite), der Unit-Test dazu entfällt.
- Nicht umgesetzt: Projekte in `e2eDatenVorbereiten` parallel anlegen (Effizienz; das Zurücksetzen dauert 4,4 s je Lauf, parallel wäre es fehleranfälliger); `panelOeffnen` direkt im Review-Fall (der Titel heißt „Überprüfen“, der Tab „Review panel“); die beiden Klicks auf „Quellen“ in p4f3 (Wechsel ohne Neuladen, keine Wiederherstellung).

### /code-review medium 37b2d9db3b..HEAD (nach den Korrekturen)
- Umgesetzt: `panelSichern` zählt die 3 s ab dem Aufruf; vorher klickte es einen schon gewählten Tab beim ersten Durchgang und konnte das Panel schließen.
- Nicht umgesetzt: Dev-Route ohne Anmeldung (nur mit `SPUR_DEV`, wie Zeit-Schalter und Paper-Fake; setzt nur E2E-Konten und -Projekte zurück, dazu `spurVorschlaege`/`spurWorkflows` wie das Skript); Zurücksetzen auch beim Lauf einzelner Features (gewollt: jeder Lauf auf denselben Daten); `ablageFreigeben` nur im Skript (im Web-Prozess gehören neue Dateien schon dem Web-Nutzer); übrige Punkte wie im ersten Review (Verlauf je Abfrage, Notification, `<wbr>`, Index-Kette).

### /code-review medium 37b2d9db3b..HEAD (nach dem Befund zur eingeklappten Leiste)
- Umgesetzt: `panelSichern` klickt einen schon gewählten Tab nur noch, wenn die Leiste eingeklappt ist (kein `.rail-panel-title` sichtbar). Vorher hätte es nach 3 s auch ein offenes, langsam ladendes Panel geschlossen. Danach bei 20× zweimal `p3f2 ok` (132 s, 129 s).
- Nicht umgesetzt (wie oben begründet): Dev-Route ohne Anmeldung nur mit `SPUR_DEV`; Verlauf bis 500 je Abfrage; Index-Kette (Rollback läuft rückwärts, `spur_verlauf_index` stellt den `am`-Index vor `spur_app` wieder her); Seitengröße 100 in `ereignisseVon` (bricht ohne fortschreitenden Cursor ab); Hinweis außerhalb von `role="log"` (Statuszeile, kein Gesprächsinhalt); Notification-Ersatz.

### /simplify und /code-review auf dem Endstand (37b2d9db3b..HEAD, Schwerpunkt 1611ebbaf5..HEAD)
- /simplify: Altitude und Effizienz ohne neue Befunde. Wiederverwendung und Vereinfachung nennen nur Kosmetik: doppelte Lösch-Schleifen und eine Schleife über ein Element in `vorbereiten.mjs` (stammt aus P1/P2, im Diff nur eingerückt), den Namen `geklickt`, `.and()` statt eines verschachtelten Locators in p2f4. Nicht umgesetzt, weil nichts am Verhalten ändert und jede Änderung einen neuen Gesamtlauf bräuchte; siehe Vorschläge.
- /code-review: Umgesetzt ist, dass CI jetzt auch `tools/tests/befehlsnamen.test.mjs` ausführt (vorher nur von Hand); der Schritt meldet 11/11 grün. Nicht umgesetzt: der Main-Guard in `vorbereiten.mjs` (belegt, `spur-dev run` meldet „E2E-Daten bereit“); `ablageFreigeben` nur im Skript (der Web-Prozess legt seine Dateien selbst an); Zählung 102 in p3f1 (die Suite setzt vorher zurück, also deterministisch); die übrigen Punkte wie oben.

## Abnahme
Alle Schritte am laufenden System (http://localhost:8080) ausgeführt; Bilder in der Scratchpad-Ablage `bilder/`, je 360 und 1280 px. In keinem Bild horizontaler Überlauf von Seite oder Panel, keine Konsolenfehler.

### f1 Befehlsnamen
- Schritt 1: Schritt 2 von f5 in `.slice/plans/20261106-spur-p3-app/features.json` lautet jetzt „In Claude Code erscheinen die Workflows bei `/` über das Plugin als `/plugin:spur:spur:literaturueberblick (MCP)`, `/plugin:spur:spur:methodenteil (MCP)` und `/plugin:spur:spur:folien (MCP)`“; sonst nur `passes` geändert.
- Schritt 2: `git grep -n '/spur:' -- ':!.slice'` findet nur Image-Namen (`ghcr.io/…/spur:latest`) und `/spur:lauf` in ADR 0003 (Plugin-Skill, siehe Entscheidungen); `node --test tools/tests/befehlsnamen.test.mjs`: 3 bestanden.
- Schritt 3: `f1.3 Hilfe im Workflows-Panel: ["/plugin:spur:spur:literaturueberblick","/plugin:spur:spur:methodenteil","/plugin:spur:spur:folien"]`; Bild `f1-workflows-hilfe`: 360px und 1280px ohne Überlauf, Konsolenfehler: keine.
- Schritt 4: Claude Code 2.1.319 headless, `claude -p … --output-format stream-json --verbose --plugin-dir <Kopie von plugins/spur mit http://localhost:8080/spur/mcp und Token spur_e2e_p3a>`, Init-Zeile:
  ```
  mcp_servers [{'name': 'plugin:spur:spur', 'status': 'connected', 'source': 'plugin'}]
  slash_commands ['spur:spur', 'mcp__plugin_spur_spur__literaturueberblick', 'mcp__plugin_spur_spur__methodenteil', 'mcp__plugin_spur_spur__folien']
  ```
  Nach der Doku-Regel „/plugin:<plugin>:<server>:<prompt> (MCP)“ zeigt das Menü `/plugin:spur:spur:literaturueberblick (MCP)` usw. (`spur:spur` ist der Plugin-Skill.)
- Schritt 5: siehe „E2E und Tests“.

### f2 Chat und @claude (P3-f1, P3-f2)
- Schritt 1: `f2.1 ohne Verbindung: {"text":"Claude nicht verbunden","startbefehl":"claude --allowedTools \"mcp__plugin_spur_spur__quote_mark …","eingabefelder":0}`; Bild `f2-chat-nicht-verbunden`.
- Schritt 2 (Fake-Client aus dem Repo als eigener Prozess):
  ```
  wait:   {"art":"ergebnis","daten":{"ereignis":{"typ":"task_created","project_id":"6af0bcbadec55679c8502646","daten":{"text":"Fasse Abschnitt 2 zusammen",…}}}}
  events: {"art":"ergebnis","daten":{"ereignisse":[{"typ":"task_created",…,"daten":{"text":"Fasse Abschnitt 2 zusammen",…}}],"cursor":"6af0bcc8be8d51d826d7bb86"}}
  doc_edit (schreibend): {"lauf_id":"6af0bcc8be8d51d826d7bb8b","aenderung":true,"rot":[],"zahlen_ohne_beleg":[]}
  reply:  {"art":"ergebnis","daten":{"nachricht_id":"6af0bccbbe8d51d826d7bb93"}}
  im Panel: {"lauf_karte":1,"antwort":1}
  ```
  Bild `f2-chat-antwort-lauf-karte`.
- Schritt 3: 100 Fragen über das Panel gesendet, jede beantwortet: `{"sekunden":19,"langsamste_frage_ms":309}`. Nach dem Neuladen: `{"nachrichten":202,"fruehere_fehlend":[],"fehlend":[],"frage_nach_antwort":[],"fragen_in_reihenfolge":true,"erste":["Fasse Abschnitt 2 zusammen","Abschnitt 2: Schlaf stärkt das Gedächtnis."],"letzte":["Frage 100","Antwort 100"]}`; kein Hinweis auf ältere Nachrichten; Tippen von 22 Zeichen bei 202 Nachrichten: 105 ms. Bild `f2-chat-lang`. (Vor der Behebung: nur 100 von 202 Nachrichten, siehe Gefundene Fehler.)
- Schritt 4: Bo kommentiert „Bo meint: Das ist zu stark.“, Ada antwortet „@claude prüfe diese Aussage“:
  ```
  Ereignis bei Bot von A: {"typ":"comment_mention","project_id":"6af0bcbadec55679c8502662","daten":{"kommentar_id":"6af0bd4749eec56656000001","nachricht_id":"6af0bd4fb7bbd000081d74e1","text":"@claude prüfe diese Aussage","doc_id":"6af0bcbadec55679c8502666","pfad":"main.tex","stelle":{"position":41,"laenge":41,"zeile":3,"markiert":"Schlaf verdoppelt die Gedächtnisleistung."},"andere_nachrichten":["6af0bd47b7bbd000081d74e0"]}}
  Kommentartext von B im Ereignis: nein
  Ereignisse bei Bot von B: []
  reply: {"nachricht_id":"6af0bd4fb7bbd000081d74e2"}
  Thread: {"autoren":["Bo Berater","Ada Autorin","Claude (Ada)"],"nachrichten":["Bo meint: Das ist zu stark.","@claude prüfe diese Aussage","Die Verdopplung ist in den Quellen nicht belegt."]}
  ```
  Bild `f2-kommentar-thread` (bei 360 px bleibt Overleafs Review-Panel wie in P3 leer, weil der Editor verdeckt ist).
- Schritt 5: diese Liste; der gefundene Fehler steht unter „Gefundene Fehler“.

### f3 Schalter und Vorschläge (P3-f3, P3-f4)
- Schritt 1: `Ada vorher: ["Compile-Fehler: Projekt: Aus","Belegloses Argument: Projekt: Aus"]`; Ada setzt den Projekt-Standard Compile-Fehler auf Vorschlag; `Bo (neues Mitglied, ohne eigene Einstellung): ["Compile-Fehler: Projekt: Vorschlag", …]`; `Bo eigene Einstellung überschreibt: ["Compile-Fehler: Aus", …]`.
- Schritt 2: `Fehler-Compile, Schalter Aus: suggest_trigger bei Bo: 0`; `Schalter Vorschlag: {"anzahl":1,"ereignis":{"typ":"suggest_trigger","daten":{"art":"compile_fehler","fehler":[{"zeile":4,"meldung":"Undefined control sequence.","kontext":"\\kaputtesmakro"}]}}}`.
- Schritt 3: `suggest` zweimal → Karten „Makro unbekannt“, „Beleg fehlt“; `Dokument unverändert: ja`; Verwerfen: „Karte entfernt, 1 Karte(n) übrig“; Übernehmen: `task_created` mit `vorschlag_id` und „Bitte diesen Vorschlag umsetzen (main.tex): Beleg fehlt …“, danach `doc_edit` → Lauf-Karte im Claude-Panel: 1.
- Schritt 4: `SPUR_NOW 2026-11-23, Limit 2, drei Auslöser: {"antworten":[{"ausgeloest":true},{"ausgeloest":true},{"ausgeloest":false,"grund":"limit"}],"neue_ereignisse":2,"panel":"Tageslimit erreicht"}`. Tipp-Pause: `{"nach_50_s":0,"erstes_ereignis_nach_s":59,"ereignisse_nach_weiteren_10_s":1,"daten":{"art":"belegloses_argument",…}}`.
- Schritt 5: Bilder `f3-vorschlaege-aus`, `-keine`, `-mehrere`, `-tageslimit` (dazu `-uebernommen`), je 360 und 1280 px ohne Überlauf und Konsolenfehler.

### f4 Workflows und Admin-Text (P3-f5)
- Schritt 1: `prompts/list: [{"name":"literaturueberblick","argumente":["fokus?"]},{"name":"methodenteil",…},{"name":"folien",…}]`; `prompts/get`: 1009, 867 und 884 Zeichen, jeweils der volle Text („Workflow „Literaturüberblick“ in spur. Ziel: …“ bis „… offene Lücken.“).
- Schritt 2: `Panel „Workflows“: ["Literaturüberblick","Methodenteil","Folien aus Paper"]`; Klick → `{"typ":"task_created","projekt_stimmt":true,"workflow":"literaturueberblick","text_gleich_prompts_get":true,"zeichen":1009}`, in der Inbox (`events_since`) dasselbe. Bild `f4-workflows-chat`.
- Schritt 3: Admin speichert für `folien` „Workflow „Folien aus Paper“ (angepasst): Höchstens zehn Folien …“; `prompts/get folien` und der Panel-Klick liefern sofort genau diesen Text; nach „Standard wiederherstellen“: `prompts/get folien gleich Standard: true`. Bild `f4-admin-angepasst`.
- Schritt 4 und 5: siehe „E2E und Tests“ und „Abnahme je P3-Feature“.

### Abnahme je P3-Feature
- P3-f1 Mit Claude im Editor sprechen: PASS (f2 Schritte 1–3, nach Behebung der Verlaufsgrenze)
- P3-f2 Claude an einer Textstelle rufen: PASS (f2 Schritt 4)
- P3-f3 Zwei Schalter pro Nutzer und Projekt: PASS (f3 Schritte 1–2)
- P3-f4 Vorschläge im Seitenpanel mit Limit: PASS (f3 Schritte 3–5)
- P3-f5 Fertige Workflows starten: PASS (f1 Schritte 1–4, f4 Schritte 1–3)

## /simplify (37b2d9db3b..HEAD)
- Umgesetzt: Index `{projectId, botId, am: -1, _id: -1}` für den Verlauf (neue Migration `20261109090000_spur_verlauf_index.mjs`, ersetzt den Index nur nach `am`; `explain` zeigt IXSCAN → LIMIT ohne SORT; Rollback geprüft); `Inbox.verlauf` parallel zu Lauf, Verbindung und Automatik; grüner Rand als eine Regel für Claude-Nachricht und Erfolgsmeldung; Test der Befehlsnamen ohne Quelltext-Regex des Präfixes, doppelte Prüfungen auf `/spur:` in den Frontend-Tests entfernt (bleiben im Node-Test und in der E2E); Leerzeichen vor „·“ auf der Admin-Seite wiederhergestellt (beim Umstellen verloren).
- Nicht umgesetzt: Panel-Abfrage nur mit neuen Nachrichten (`seit`) und „Ältere laden“ (größerer Umbau, siehe Vorschläge); eine allgemeine CSS-Regel für Overleafs Notification im schmalen Panel statt Zeilen ohne Kasten (stellt die Entscheidung aus P3 um, die Ursache in Overleafs Komponente ist nicht geklärt); Befehl vom Server mitliefern statt Präfix im Frontend (Präfix bliebe auch dann fest im Code); Seitengröße 100 und Cursor-Wiederverwendung im E2E-Helfer (nur Test); Befehl je Workflow unter dem Knopf statt eigener Hilfe-Liste (Schritt 3 verlangt die Hilfe mit genau den drei Befehlen).

## /simplify, zweiter Durchgang (37b2d9db3b..HEAD, nach den Review-Befunden)
- Wiederverwendung und Effizienz: keine Befunde (Migration nutzt `tools/migrations/lib`, Verlauf läuft über den neuen Index, `claudeStatus` fragt parallel ab).
- Vereinfachung: `{' · '}` auf eigener Zeile ist Prettiers JSX-Format; die gemeinsame Randregel war der Wiederverwendungs-Fix des ersten Durchgangs. Beides bleibt.
- Höhe: Der ältere Index `projectId_1_botId_1__id_-1` (Migration `20261107120000`) ist jetzt überflüssig (nur `deleteMany` nach `projectId` nutzt den Präfix, den der neue Index auch hat). Nicht in diesem Lauf entfernt: Es wäre eine weitere Migration nach dem letzten Gesamtlauf, für geringe Schreibkosten; steht unter Vorschläge. `<wbr>` statt `overflow-wrap: anywhere` bleibt (ohne brach der Befehl im schmalen Panel mitten im Wort, siehe Bild vom ersten Entwurf).
- Keine Codeänderung in diesem Durchgang; der Gesamtlauf von 19:25 bleibt der nach der letzten Codeänderung.

## /code-review medium 37b2d9db3b..HEAD
- Umgesetzt: Hinweis auf ältere Nachrichten nennt die angezeigte Anzahl als Parameter statt fest „500“; Erfolgsmeldung im Vorschläge-Panel mit `--content-positive-themed` (dunkles Theme) statt `--green-70`; `ereignisseVon` bricht ab, wenn der Cursor fehlt oder sich nicht bewegt.
- Nicht umgesetzt: Größe der Panel-Abfrage (siehe /simplify und Vorschläge); fest verdrahteter Präfix (siehe /simplify); `ok(daten?.result)` in `werkzeug` (vorher derselbe Abbruch als TypeError, jetzt mit Meldung); `anzahl === 102` in der E2E ist gewollt, die Suite läuft nach `vorbereiten.mjs`; Regex-Umfang des Namenstests (deckt die drei Workflows ab, die es gibt); älterer Index `projectId_1_botId_1__id_-1` bleibt (andere Abfragen sortieren nach `_id`); zweite Liste unter „Workflows“ ist die verlangte Hilfe, `<wbr>` fügt beim Kopieren kein Zeichen ein.
- Abgleich mit Spec und Schritten: D3 umgesetzt (nur Text, Prompts und Plugin unverändert); README und Panel-Hilfe nennen die drei Befehle; Abnahme mit Belegen je Schritt; Handprüfungen unter „Menschlich zu prüfen“. Nichts fehlt.

## Security-Review (Subagent; ohne `origin/HEAD` findet `/security-review` keinen Vergleichsstand)
- Keine Befunde. Der Verlauf bleibt hinter `lesen` (Login und Leserecht am Projekt), der Bot kommt aus der Session; React escaped alle neuen Texte; die Migration legt den neuen Index vor dem Löschen des alten an.
- Hinweis: Eine Abfrage kann bis 500 × 20 000 Zeichen tragen (nur eigene Nachrichten der Person); siehe Vorschläge.

## /security-review (Skill, gegen `origin/HEAD` = `origin/agent`, Merge-Basis = Plan-Commit 68d09824df)
- Lokal `git remote set-head origin agent` gesetzt, damit der Skill einen Vergleichsstand hat (nichts gepusht).
- Ergebnis: keine Schwachstellen. Der Verlauf bleibt auf `{projectId, botId}` aus Route und Session beschränkt, es gibt keine neue Eingabe in Abfragen, alle neuen Texte sind React-Textknoten ohne `dangerouslySetInnerHTML`, `anzahl` ist eine Zahl, die Migration nutzt feste Indexdefinitionen. Damit entfiel die Prüfung auf Fehlalarme.

## E2E und Tests
Stand nach der letzten Codeänderung (84bfe96e45, 21:45; danach nur Belege):
- `spur-dev test`: alle spur-Unit-Tests grün, Abdeckung Zeilen 94,6 % (Schwelle 80 %), mit den neuen Tests der Dev-Route.
- Overleafs Suiten (Lauf nach den letzten Änderungen an Oberfläche und Locales; danach nur spur-Testcode und die Dev-Route geändert): frontend `bestanden: 1719, fehlgeschlagen: 14, bekannt: 14, neu: 0`, web `bestanden: 5775, fehlgeschlagen: 173, bekannt: 173, neu: 0`.
- `spur-dev run modules/spur/test/e2e/vorbereiten.mjs` → „E2E-Daten bereit“ (Skript nach dem Umbau zur Funktion), dann Lauf G:
  ```
  f1 ok … f15 ok
  p2f1 ok … p2f10 ok
  p4f1 ok  p4f2 ok  p4f3 ok  p4f4 ok
  p3f1 ok  p3f2 ok  p3f3 ok  p3f4 ok  p3f5 ok
  Laufzeit 498 s   (34/34, Exit 0)
  ```
- Lauf H direkt danach, ohne `vorbereiten.mjs`, auf den Daten von Lauf G: 34/34 ok, Laufzeit 493 s, Exit 0.
- `p3f2` allein dreimal hintereinander: `p3f2 ok` (10 s, 12 s, 12 s); bei 20-facher CPU-Drosselung zweimal `p3f2 ok` (132 s, 129 s).
- Bilder nach der letzten Codeänderung (22:0x), je 360 und 1280 px, ohne Überlauf und Konsolenfehler: `f1-workflows-hilfe`, `f2-chat-nicht-verbunden`, `f2-chat-antwort-lauf-karte`, `f2-chat-lang`, `f2-kommentar-thread`, `f3-vorschlaege-aus`, `-keine`, `-mehrere`, `-uebernommen`, `-tageslimit`, `f4-workflows-chat`, `f4-admin-angepasst` (24 Bilder).

## Menschlich zu prüfen
- Weckweg mit echter Claude-Session: Eine wartende echte Claude-Code-Session (Plugin installiert, `wait_for_event`) wird von „@claude“ im Kommentar und von einem Fehler-Compile mit Schalter „Vorschlag“ geweckt; Claude antwortet im Thread beziehungsweise legt mit `suggest` einen Vorschlag ab. Die Abnahme nutzte den Fake-Client.
- Menütext in Claude Code interaktiv ansehen: Bei `/` sollten `/plugin:spur:spur:literaturueberblick (MCP)`, `/plugin:spur:spur:methodenteil (MCP)` und `/plugin:spur:spur:folien (MCP)` erscheinen. Headless belegt sind nur die internen Namen `mcp__plugin_spur_spur__…` in `slash_commands`.

## Needs decision
Keine.

## Vorschläge
- `vorbereiten.mjs`: Lösch-Schleifen für Projekte und Konten in Helfer `projekteLoeschen(owner, name)` und `kontoEntfernen(email)` zusammenziehen.
- Index `projectId_1_botId_1__id_-1` auf `spurMessages` in einer eigenen Migration entfernen; der Index `{projectId, botId, am, _id}` deckt alle Abfragen ab.
- Der Verlauf zeigt höchstens 500 Nachrichten und wird bei jeder Abfrage (alle 5 s) ganz geladen, im schlimmsten Fall 500 × 20 000 Zeichen. Besser: erst den Verlauf, danach nur neue Nachrichten (`seit`), und „Ältere laden“ mit Cursor.
- `events_since` ohne Cursor liefert die ältesten 100 Ereignisse eines Bots. Ein Client, der ohne Cursor fragt, sieht neue Ereignisse erst nach Blättern; die Tool-Beschreibung könnte das sagen.
