Type: web, api

# spur P3 Abnahme: Workflow-Befehlsnamen und Gesamtprüfung

## Zweck
Folgeplan zu `20261106-spur-p3-app`. Entscheidung D3 (Option A) ist gefallen: Die Befehlsnamen der Workflows sind egal, `/plugin:spur:spur:<name>` gilt als richtig. Feature f5 aus P3 wird damit fertig. Danach werden alle fünf Features von P3 am laufenden System noch einmal von Hand-Ende bis Ende geprüft.

## Nutzer
Wie P3.

## Was Nutzer danach können
- Die drei Workflows über das Plugin starten und in README und Panel-Hilfe den richtigen Befehl finden: `/plugin:spur:spur:literaturueberblick`, `/plugin:spur:spur:methodenteil`, `/plugin:spur:spur:folien`.
- Sich darauf verlassen, dass Chat, `@claude`, Schalter, Vorschläge und Workflows von P3 am laufenden System zusammen funktionieren.

## Decisions
- D3 Option A. Es gibt keine Einrichtung ohne Plugin (Option B) und keine zusätzlichen Plugin-Befehle `/spur:<name>` (Option C). Prompts und Plugin bleiben technisch unverändert; nur Text ändert sich.
- Angepasst werden: Schritt 2 von f5 in `.slice/plans/20261106-spur-p3-app/features.json` (nur der Text des Schritts, danach `passes` für f5), die README des Moduls und die Hilfe im Workflows-Panel. Suche im Repo nach jedem Vorkommen von `/spur:` als Befehl und ersetze es durch den Plugin-Namen; Vorkommen von `mcp__spur__…` und Servername `spur` ohne Plugin bleiben.
- Annahmen (ohne Rückfrage getroffen):
  - Der Plan baut auf dem bereits in `agent` gemergten Code von P3 auf. `dependsOn` bleibt leer, weil P3 als `partial` stünde und den Start sonst sperrt.
  - Die Änderung an `features.json` von P3 ist die einzige erlaubte Ausnahme von „nur `passes` ändern“; sie folgt der Entscheidung D3.
  - Den genauen Menütext in Claude Code prüft der Lauf headless über die Init-Meldung (`slash_commands`) und die Doku-Regel „/plugin:<plugin>:<server>:<prompt> (MCP)“; ein interaktiver Blick bleibt unter „Menschlich zu prüfen“ in `progress.md`.
  - Die Abnahme läuft mit `SPUR_FAKE_AGENT=1` und `SPUR_NOW`, wie P3. Der echte Weckweg mit einer echten Claude-Session bleibt Handprüfung und wird als solche notiert, nicht erfunden.
  - Findet die Abnahme einen Fehler in f1–f5, wird er zuerst mit einem roten Test nachgestellt, dann behoben, dann das Feature erneut geprüft. Was nicht in diesem Lauf zu beheben ist, kommt als `D<n>` in `## Needs decision`.
  - Die Abnahme nutzt echte Browser-Ansichten bei 360 und 1280 px; Overleafs Review-Panel bei 360 px bleibt wie in P3 festgestellt außerhalb von spur.

## Quality bar
Wie P3. Zusätzlich: Die Abnahme zeigt für jeden Schritt Ausgabe oder Screenshot als Beleg. Kein Schritt gilt als bestanden, weil ein Test grün ist; er muss am laufenden System ausgeführt und beobachtet sein. Overleafs eigene Suiten bleiben grün bis auf die bekannte Upstream-Liste.

### Tests (TDD)
- Ändert sich Server-Logik, zuerst ein roter vitest-Unit-Test. Für die Befehlsnamen genügt ein Test, der den Text in README und Panel-Hilfe auf `/plugin:spur:spur:` prüft und `/spur:` als Befehl ausschließt.
- Die E2E-Suite `test/e2e/spur-e2e.js` bekommt den geänderten Schritt 2 von f5 und läuft nach `vorbereiten.mjs` vollständig grün.
