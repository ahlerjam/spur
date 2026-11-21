# Progress P17

## Stand
- In Arbeit: f1 bis f8 gebaut, E2E-Schritte `p17f1` … `p17f8` geschrieben.

## Entscheidungen
- ADR-Nummer 0008 statt 0007 (0007 ist seit P16 `minted-ohne-shell-escape`); Datei `docs/adr/0008-pruefkette-im-plugin.md`. Die E2E prüft 0008.
- `claude plugin validate --strict` verlangte zusätzlich `author` in `plugin.json` und `description` im Marketplace; beides ergänzt. Die zwei „plugin directory warnings“ (Icon, Datenschutz-URL) gehören zur Prüfung für das Plugin-Verzeichnis und ändern das Ergebnis nicht; die Validierung endet mit „Validation passed“.
- Hooks in Exec-Form (`"command": "${CLAUDE_PLUGIN_ROOT}/hooks/pruefkette", "args": []`): Die Shell-Form ohne Anführungszeichen ergab unter `--strict` eine Warnung, mit Anführungszeichen begänne der Befehl nicht mehr mit `${CLAUDE_PLUGIN_ROOT}`. Laut Doku (hooks, „Exec form and shell form“) startet Claude Code den Befehl mit `args` direkt, ohne Shell.
- Hook-Skripte in bash mit `grep`, `sed`, `tr`, `mktemp` wie `bin/spur-hochladen` (kein jq, kein node). Felder werden nur als echte JSON-Schlüssel gelesen (vor einem Schlüssel steht kein `\`), damit ein `"pfad"` im geänderten Text nicht zählt.
- Zeitpunkte als fortlaufender Zähler im Zustand statt Uhrzeit: Ereignisse in derselben Sekunde (Tests, parallele Werkzeugaufrufe) behalten ihre Reihenfolge. Parallele Hooks einer Session sperren sich über ein `mkdir`-Lock (höchstens 2 s).
- Fehlende Stufen kaskadieren: Fehlt eine Stufe, gelten alle späteren als offen (nur so nennt die Begründung bei fehlender Endprüfung auch Humanizer und `check_report`, wie f7 verlangt).
- `spur-pruefkette` (bin) bekommt `CLAUDE_PLUGIN_DATA` nicht (laut Doku nur Hooks, MCP- und LSP-Server); der `SessionStart`-Hook schreibt `SPUR_PRUEFKETTE_SESSION` und `SPUR_PRUEFKETTE_DATA` nach `CLAUDE_ENV_FILE`.
- `PostToolUse` hört zusätzlich auf `run_finish`, um den Zustand nach Erfolg zu leeren; ein Ergebnis mit `isError: true` behält ihn.
- Agenten nennen ihre Werkzeuge mit vollem Namen `mcp__plugin_spur_spur__…` und laden Skills ohne Präfix (`skills: [spur-auswertung]`, wie im Feature). Laut Doku ruft auch der bloße Name einen Plugin-Skill auf; an einer echten Session ist das nicht geprüft (Schritt 2 der Checkliste).
- Hook-Begründung und `SessionStart`-Kontext auf Deutsch, weil f7 die deutschen Stufennamen verlangt; Skills und Agenten englisch.
- README-Überschrift „Check after installation“ statt „Nach der Installation prüfen“: Die README ist englisch (P5-Regel in `p5f8`).
- `spur-pdf-holen` fragt Europe PMC erst, wenn alle Unpaywall-Fundorte gescheitert sind; Exit 3, sobald eine Adresse eine Webseite statt des PDFs lieferte und keine ein PDF, sonst Exit 1.
- Workflow-Absatz zur Kette als `PRUEFKETTE` in `standardtexte.mjs`, an alle vier Texte angehängt.
- CI: neuer Schritt „Plugin prüfen“ im Job `test` (`node --test tools/tests/*.test.mjs`, dann `claude plugin validate` für Plugin und Marketplace mit `@anthropic-ai/claude-code@2.1.330`). Bisher liefen in CI nur drei der `tools/tests`-Dateien.
- E2E im Lauf: Kein Playwright-MCP im Lauf, Chromium startet in der Sandbox nur mit `--single-process` und stürzt in langen Läufen ab. Ein Startskript (nicht im Repo) startet deshalb je Feature einen frischen Browser; die Suite setzt die Daten vor jedem Feature selbst zurück.
- `mwe` (Beispielbilder) fehlt im Image; `p17f5` ersetzt in den Teilabbildungen `\includegraphics` durch graue TikZ-Rechtecke, Ausrichtung und Höhe bleiben die aus dem Skill.

## Needs decision
- f1: Die Einstellungsseite „Claude verbinden“ (`claude-verbinden.tsx`) zeigt drei Schritte ohne die Marketplaces `cflow` und `claude-plugins-official`. Mit den neuen Abhängigkeiten lädt das Plugin nach diesen Schritten nicht (Doku: plugins/dependencies).
  Interim: README nennt die zwei Marketplaces vor spur; die Seite bleibt unverändert (Ansicht außerhalb des Plans).
  Options: A (empfohlen) Schritt 1 der Seite um die zwei `marketplace add`-Befehle ergänzen, Texte de/en | B Abhängigkeiten nur empfehlen (nicht in `plugin.json`), Seite bleibt

## Vorschläge
- Kein MCP-Werkzeug listet die Beschaffungsliste; der Skill `spur-pdf-holen` nimmt die `bot_schutz`-Fälle aus den Antworten von `source_add` oder fragt die Person. Ein lesendes `acquisition_list` (paginiert) würde das schließen.
- Der Job `test` läuft nicht, wenn nur Markdown geändert ist (`tools/ci/aenderungen.mjs`); reine Skill-Änderungen laufen so ohne `claude plugin validate`.
