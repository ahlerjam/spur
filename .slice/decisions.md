- D1 (plan 20261107-spur-p11-tests) f1: Independent acceptance failed twice on f1. The second run saw `spur-dev upstream web` still print 14x "reading 'externalAuth'" (UserPagesController.test.mjs); the first acceptance run did not show it and the builder's own run reports web 5484/173/173/0. Likely flaky or a known-list entry, unconfirmed.
  Interim: merged as partial; all 8 features pass the builder's checks and spur-dev test is green (531 tests, 98.67 % lines).
  Options: (a) re-run `spur-dev upstream web` and check whether the externalAuth errors are in the known list; (b) have a follow-up plan make spec step 3 ("no externalAuth errors") hold.
  Resolved 2026-11-08 (owner session): option (a). Local `spur-dev upstream web` gives 5484 passed, 173 failed, 173 known, new 0, exit 0; the 14 externalAuth failures are in tools/tests/upstream-bekannt.json with origin overleaf-cep ("overleaf-cep liest req.user.externalAuth, die Tests setzen kein req.user"). The spec step assumed missing test settings; it is a fork test defect, so the known list is the right place. CI job upstream on PR #2 is green (web, frontend, du). Plan set to done.
- D2 (plan 20261106-spur-p2-recherche) merge: Run branch slice/run-20261106-spur-p2-recherche has all 10 features passing (builder, independent acceptance f1-f10 PASS), but merging the current agent branch into it conflicts in 15 files (SpurRouter, SpurController, QuellenManager, ZitatManager, quellen-panel/zitate.tsx, spur.scss, locales, spur-e2e.js and four unit tests), because plan p4-quellen landed on the same files meanwhile. Not merged.
  Interim: plan halted; run branch is pushed to origin unchanged, agent branch untouched.
  Options: (a) resolve the conflicts by hand on slice/run-20261106-spur-p2-recherche, run spur-dev test, then fast-forward agent; (b) resume a builder on the run branch with the task to merge agent and resolve the conflicts, then run the gate again.
  Resolved 2026-11-08 (owner session): option (a). The 15 conflicts were resolved by hand in merge commit 390138827b. Details:
  - Dev routes keep P2's paper fake plus P4's test page and time switch.
  - `aufnehmen` uses P4's `speichern()` and keeps P2's defaults (key, doi, meta, nurProjekt).
  - P4's web entries for the .bib moved into P2's `pruefung/bib.mjs`.
  - Notes, comments and OCR confirmation coexist in the panel.
  - Locales were merged three-way with no conflicting keys.
  After the merge the E2E suite needed one fix: e2e-a now has more than 20 projects, so `projektOeffnen` uses the project list search.
  Results:
  - `spur-dev test`: 638 tests passed, 94.2 % lines.
  - Full E2E: f1–f15, p2f1–p2f10 and p4f1–p4f4 all ok.
  The independent acceptance (f1–f10 PASS) ran before the merge; after it only unit tests and E2E were rerun.
  Open:
  - P2's PDF fetch (`recherche/Aufnahme.mjs`) checks DNS before `fetch` resolves again (rebinding window).
  - It also lacks the NAT64, 6to4 and Teredo ranges that P4's `WebSchnappschuss` blocks.
  Follow-up fix: use one shared guarded request for both.

- D3 (plan 20261106-spur-p3-app) f5: Über das Plugin heißen die Workflows in Claude Code `/plugin:spur:spur:<name> (MCP)`, nicht `/spur:<name> (MCP)` wie in Schritt 2 verlangt. Was gilt?
  Interim: Prompts und Plugin unverändert; `passes` von f5 bleibt false, die übrigen vier Schritte bestehen.
  Options: A (empfohlen) Schritt 2 auf den Namen anpassen, den Claude Code für Plugin-Server vergibt (`/plugin:spur:spur:…`), und den Befehl in README und Panel-Hilfe so nennen | B Einrichtung zusätzlich ohne Plugin anbieten (`claude mcp add --transport http spur <Adresse> --header …`), dann gilt `/spur:…`, aber Token und Erlaubnisse liegen nicht mehr im Plugin | C Workflows zusätzlich als Plugin-Befehle `/spur:<name>` ausliefern (widerspricht „Keine Workflow-Skills im Plugin“ und doppelt die Textquelle)

- D4 (plan 20261108-spur-p3-abnahme) f3: Die zweite unabhängige Abnahme fand: `tipp-pause` akzeptiert eine nicht vorhandene `doc_id` und legt dafür einen `suggest_trigger` an, der das Tageslimit verbraucht.
  Interim: Nicht behoben; alle vier Features stehen auf passes true, die Abnahme blieb für f3 rot, der Plan steht auf partial.
  Options: A (empfohlen) `doc_id` gegen das Projekt prüfen und bei unbekannter ID einen Fehler liefern, mit rotem Test zuerst | B so lassen, weil nur ein Claude-Client mit eigenem Token es aufrufen kann
  Resolved 2026-11-09 (owner session): option A. `tippPause` sucht die `doc_id` per `ProjectLocator.findElement` im Projekt; unbekannt gibt 404 `doc_fehlt`, bevor `ausloesen` zählt; andere Fehler gehen an Express. Unit-Tests erst rot, dann grün; p3f4 prüft den 404 am laufenden System. Der Routentest ersetzt den Vorschläge-Controller jetzt durch eine Attrappe, weil der echte Overleafs Modelle lädt.
- D5 (plan 20261108-spur-p3-abnahme): Der Merge des Default-Branches in `agent` brach mit „refusing to merge unrelated histories“ ab; der Lauf baut auf dem Stand von `agent` ohne diesen Merge.
  Interim: Kein Merge; Gate auf dem Run-Branch grün (531 Tests).
  Options: A (empfohlen) Default-Branch von Hand klären, ob `agent` und `main` getrennte Geschichten haben sollen | B ignorieren
  Resolved 2026-11-09 (owner session): option B. Lokal haben `main` und `agent` eine gemeinsame Basis (`git merge-base` findet sie); der Abbruch kam vom flachen Klon in der Cloud. Nichts zu tun.
- D6 (plan 20261109-spur-p5-abnahme) f7: Thema mit mehreren Wörtern im Slash-Befehl `/plugin:spur:spur:quellen_sammeln`
  Interim: Argumentbeschreibung bittet um Bindestriche („Schlaf-Gedächtnis“); im Claude-Panel sind Leerzeichen erlaubt.
  Options: A (empfohlen) so lassen und nach dem Merge in Claude Code testen, ob Anführungszeichen ein Argument zusammenhalten | B Anzahl zuerst, Thema als Rest der Zeile | C nur ein Argument „thema“, Anzahl im Text
- D7 (plan 20261109-spur-p5-abnahme) f6: Zweite unabhängige Abnahme: „Zurück“ in der Blätterleiste des Panels sitzt bei 1280 px 4–5 px höher als Vorherige/Nächste Seite (`spur.scss`, `margin-top` auf `.spur-blaettern`); optisch eine Zeile, „dieselbe obere Kante“ wörtlich nicht erfüllt.
  Interim: so gelassen.
  Options: A (empfohlen) kleiner Nachbesserungsplan vor dem Merge | B so lassen
- D8 (plan 20261110-spur-p6-claude-test) f7: Gilt eine Zahl, die in `ergebnisse.tex` steht, auch im Fließtext als belegt?
  Interim: Nur in Formeln und siunitx-Werten; im Fließtext bleibt eine getippte Zahl gemeldet (Hinweis: Makro nutzen), p2f8 bleibt grün.
  Options: A (empfohlen) so lassen, Fließtext soll das Makro nutzen | B überall als belegt werten und p2f8 anpassen | C nirgends als belegt werten, nur Makros zählen
- D9 (plan 20261112-spur-p8-korrekturen) Gate: Der Unit-Test `texPaketeHinzufuegen.test.mjs` „lässt einen zweiten gleichzeitigen Aufruf warten, bis der erste fertig ist“ schlug in 2 von 5 Läufen von `spur-dev test` fehl (`erster.dateien` hatte nicht 5 Einträge), in den drei übrigen war er grün.
  Interim: Gemerged, weil die Abnahme (f1–f11 PASS) und drei Läufe in Folge grün waren; der Test ist nicht stabil.
  Options: A (empfohlen) kleiner Nachbesserungsplan: Reihenfolge der beiden gleichzeitigen Aufrufe im Test oder die Sperre in `hinzufuegen` prüfen | B so lassen
  Resolved 2026-11-13 (P10 f7): erledigt, Ursache im Test, nicht in der Sperre. Beide Aufrufe lesen zuerst die TeX-Live-Datenbank; wer damit zuerst fertig ist, bekommt die Sperre. Der Test nahm an, dass der erste Aufruf gewinnt, unter Last gewann zuweilen der zweite (`erster.dateien` war dann leer, der Befund „schon im Projekt“ stand beim ersten). Der Test prüft jetzt, dass genau einer fünf Dateien anlegt und der andere „schon im Projekt“ meldet, egal in welcher Reihenfolge; `gesperrt` bleibt unverändert.
