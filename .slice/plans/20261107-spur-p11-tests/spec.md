Type: cli, web

# spur P1.1: Testabdeckung

## Zweck
Jede Änderung an spur wird gegen Overleafs eigene Test-Suiten und gegen ausreichende eigene Unit- und Frontend-Tests geprüft, lokal und in jedem Pull Request. Was upstream schon scheitert, steht begründet auf einer Liste; alles andere, was rot wird, hat spur kaputt gemacht.

## Nutzer
Entwickler von spur (Mensch und Builder) und die CI. Sie sehen auf einen Blick, ob eine Änderung Overleaf oder spur bricht.

## Was Nutzer können
- Overleafs web-Unit-, Frontend- und document-updater-Suiten mit je einem Befehl in einer korrekten Testumgebung starten.
- Dieselben Suiten auf Overleaf-Original (`main`), overleaf-cep (`ext-ce`) und spur (`agent`) vergleichen und daraus die Liste bekannter Fehler erzeugen.
- Im Pull Request einen zweiten CI-Job sehen, der nur bei neuen Fehlern rot wird.
- spur-Unit-Tests mit Abdeckungsbericht und spur-Frontend-Tests ausführen.

## Context
- spur-Code liegt in `services/web/modules/spur` (Server `app/src`, Oberfläche `frontend/js`, Tests `test/unit`, `test/e2e`, `test/fixtures`). Bisher 34 Unit-Tests (`pruefung`, `schreiben`) und die E2E-Suite f1–f15.
- Kern-Patches: document-updater (Ops-Endpunkt), `ProjectDuplicator.mjs`, Review-Panel (`review-panel-change-user.tsx`, `changes-users-context.tsx`), `settings.defaults.js`, Locales.
- Stand 2026-11-07, gemessen im Dev-Container mit `yarn run test:unit` in `services/web`: overleaf-cep und agent scheitern an denselben 408 von rund 4900 Tests. Ursachen fast nur Umgebung: `tsconfig.backend.json` im Repo-Wurzelordner nicht im Container (rund 170), `NODE_ENV=production` statt `test` („Refusing to clear database … production“, 35), fehlende Test-Einstellungen (`externalAuth`, 14), Module nur in Server Pro (`oauth2-server`), Folgefehler (`STACK_TRACE_ERROR`, 57); rund 6 echte Assertion-Fehler.
- Vorarbeit des Owners (2026-11-07, web-Unit im Dev-Container): `tsconfig.backend.json` nach `/overleaf/` kopiert, dann `env -u OVERLEAF_CONFIG NODE_ENV=test OVERLEAF_MONGO_URL=mongodb://mongo/test-overleaf MONGO_CONNECTION_STRING=mongodb://mongo/test-overleaf yarn run test:unit` → 5217 bestanden, 192 fehlgeschlagen von 5409 (vorher 408 von 4949, weil viele Dateien nicht luden). `libraries/mongo-utils/test-utils.js` löscht nur die Datenbank `test-overleaf` bei `NODE_ENV=test`. Rest: 130 in `ProjectController.test.mjs` (alle `STACK_TRACE_ERROR`, vermutlich eine Ursache), `setImageName is not a function` (16), `externalAuth` undefined (14), `url` undefined (7), Server-Pro-Module (`oauth2-server`), einzelne Assertions (Templates, Subscription, Settings). Mehrere davon berühren Erweiterungen von overleaf-cep (Sandbox-Compiles, externe Anmeldung, Templates); ob sie dort schon scheitern, zeigt der Dreier-Vergleich.
- `yarn run test:frontend` bricht beim Laden ab: „Your application tried to access @ … (via "@/features/source-editor/…")“ – der Pfad-Alias `@` wird im Test-Setup nicht aufgelöst.
- CI: `.github/workflows/ci.yml` Job `test` (spur-dev up, spur-dev test, E2E) läuft auf `ubuntu-22.04`, weil MongoDB 8 auf Kerneln 6.19 bis 7.0.13 nicht startet (SERVER-121912). Branch-Protection auf `spur` verlangt den Check `test`.
- `spur-dev` (Quelle `tools/spur-dev/`) startet den Stack aus dem Image `ghcr.io/ahlerjam/spur-dev` und hängt den Worktree ein.

## Decisions
- Es gelten `docs/adr`, `docs/mcp-vertrag.md`, `CLAUDE.md` (TDD-Regel) und die Entscheidungen aus P1.
- Der Plan läuft in der Cloud. Dort darf der Builder `tools/spur-dev/spur-dev` ändern und mit `bash tools/spur-dev/spur-dev install --cloud` selbst neu installieren; zuerst einmal installieren, bevor `spur-dev` benutzt wird. Lokal ändert nur ein Mensch die installierte Kopie.
- Neue Befehle für die Suiten gehören in `spur-dev` (zum Beispiel `spur-dev upstream web|frontend|du`), damit Builder ohne freies docker arbeiten. Die Befehle laufen im Dev-Container.
- Testumgebung wie bei Overleaf intern: `NODE_ENV=test`, die nötigen Dateien aus dem Repo im Container, Test-Einstellungen aus Overleafs eigener Testkonfiguration. Keine Änderung an Overleafs Tests, um sie grün zu machen; nur Umgebung und Aufruf.
- Tests, die Module von Overleaf Server Pro brauchen, stehen auf einer Ausschlussliste mit Grund je Datei.
- Liste bekannter Fehler: eine Datei im Repo (zum Beispiel `tools/tests/upstream-bekannt.json`), je Test Suite, Datei, Testname, Herkunft (`overleaf`, `overleaf-cep`, `spur`) und Grund. Die Herkunft ergibt sich aus dem Dreier-Vergleich `main`, `ext-ce`, `agent`. Einträge mit Herkunft `spur` sind nicht erlaubt: Ein Fehler, den spur verursacht, wird behoben (Test zuerst).
- Der Dreier-Vergleich läuft mit Worktrees der drei Branches; `main` ist das Overleaf-Original und hat kein spur-Modul.
- CI: zweiter Job `upstream` in `ci.yml`, parallel zu `test`, gleicher Runner `ubuntu-22.04`. Er scheitert nur an Tests, die nicht auf der Liste stehen, und meldet Tests der Liste, die inzwischen grün sind, als Hinweis.
- Abdeckung mit `@vitest/coverage-istanbul` (schon im Projekt) für `modules/spur/app/src` ohne `dev/`: mindestens 80 % der Zeilen. Kein neues npm-Paket.
- Frontend-Tests der spur-Oberfläche im Stil von Overleafs Frontend-Tests unter `modules/spur/test/frontend`, sodass `yarn run test:frontend` sie mitnimmt.
- Cypress-Tests (`server-ce/test`) und Acceptance-Tests des web-Dienstes bleiben draußen; sie stehen in `docs/backlog.md`.

## Testbarkeit
Wie P1: `spur-dev test`, `spur-dev run modules/spur/test/e2e/vorbereiten.mjs`, dann die E2E-Suite. Dazu die neuen `spur-dev`-Befehle. Ein absichtlich kaputt gemachter Overleaf-Test (nur lokal, nicht committen) beweist, dass der Vergleich rot wird.

## Quality bar
- Wie P1.
- Jede Ausnahme (Ausschlussliste, Liste bekannter Fehler) hat einen Grund in einem Satz.
- Die Befehle geben am Ende eine Zusammenfassung aus: bestanden, fehlgeschlagen, bekannt, neu.
- Der Job `upstream` braucht höchstens 30 Minuten.

### Tests (TDD)
- Test zuerst: Für jede neue oder geänderte Server-Logik entsteht zuerst ein roter Unit-Test, dann der Code. Jeder behobene Fehler bekommt zuerst einen Test, der ihn nachstellt.
- Die E2E-Suite bleibt nach `vorbereiten.mjs` vollständig grün.
