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
