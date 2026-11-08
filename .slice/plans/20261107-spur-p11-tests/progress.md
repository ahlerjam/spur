# Fortschritt 20261107-spur-p11-tests

## Entscheidungen (umkehrbar)
- `spur-dev upstream …` startet je Lauf einen eigenen Container aus dem Dev-Image (`docker compose run --rm` auf den Dienst `web`) mit dem Quellstand des jeweiligen Worktrees. Zusätzlich zu den Stack-Mounts werden alle übrigen Einträge von `services/web` (unter anderem `test/`, `types/`, Konfigurationen) und `tsconfig.backend.json` eingehängt. Der laufende Stack bleibt unberührt.
- Auswertung und Aufruf der Suiten liegen in `tools/tests/upstream.mjs` (im Repo, ohne `install` änderbar); `spur-dev` ist nur die dünne Hülle. Die reine Logik (`upstream-auswertung.mjs`) hat Tests mit `node --test`.
- Testumgebung: `NODE_ENV=test`, `OVERLEAF_CONFIG` leer (nur `settings.defaults.js`), Mongo-Datenbank `test-overleaf`. document-updater-Acceptance-Tests laufen gegen eine eigene Redis (`redis-test`, Compose-Profil `upstream`), weil der document-updater des laufenden Stacks sonst ihre Updates abholt.
- Dreier-Vergleich: `main` und `ext-ce` als Worktrees unter `~/.cache/spur-dev/vergleich/`, die spur-Seite ist der aktuelle Worktree (Stand `agent` plus diesem Zweig), damit die Liste zum committeten Code passt.
- Alle drei Stände laufen mit den Abhängigkeiten (Yarn PnP) des Dev-Images, also mit dem Lockfile von `agent`. Auflösungsfehler auf `main`/`ext-ce` können deshalb Artefakte sein; Einträge der Liste wurden darauf geprüft.
- Ausschluss ganzer Dateien nur, wenn sie Module oder Dateien aus Overleaf Server Pro/SaaS brauchen (`tools/tests/upstream-ausschluss.json`). Dateien, die nur in overleaf-cep scheitern (zum Beispiel ein Syntaxfehler in `LinkedFilesController.test.mjs`), stehen als bekannte Fehler auf der Liste.
- `externalAuth` undefined ist kein Umgebungsfehler: overleaf-cep liest in `UserPagesController` `req.user.externalAuth`, die Tests setzen kein `req.user`. Steht mit Herkunft `overleaf-cep` auf der Liste und erscheint deshalb nicht mehr in der Ausgabe.

- f3: „gegen Redis und Mongo des Stacks“ heißt hier: Mongo des Stacks (Datenbank `test-overleaf`) und die Redis `redis-test` aus derselben Compose-Datei. Die spur-Ops-Tests (`HttpController spurUpdate …`, 3 Tests) laufen in der Unit-Suite mit und sind grün; Ergebnis 784 bestanden, 0 fehlgeschlagen.

- f4: Der Vergleich (2026-11-07) fand keinen Fehler, der nur auf spur auftritt: web scheitert auf ext-ce und spur an denselben Tests, document-updater ist überall grün. Die 14 Frontend-Fehler, die zuerst als „nur auf spur“ erschienen, kamen daher, dass die Suite auf frischen Worktrees ohne generierte Lezer-Grammatik nicht lud; nach der Korrektur stammen alle aus Overleaf oder overleaf-cep. Liste: 187 Einträge (173 web, 14 frontend), Gründe je Fehlerbild von Hand formuliert; ein neuer Vergleich behält vorhandene Gründe. Alle Einträge mit Herkunft `overleaf` scheitern auf main mit derselben Meldung (kein PnP-Artefakt).

- f5: Proben lokal, nicht committet: kaputter Test in `DiffCodecTests.js` (p: 7 statt 6) → `spur-dev upstream du` Exit 1 mit genau `NEU: test/unit/js/DiffCodec/DiffCodecTests.js › DiffCodec diffAsShareJsOps should insert new text correctly`. Bekannter Fehler grün gemacht (`CollaboratorsInviteController`, Erwartung `/login`) → `Hinweis: bekannt, jetzt grün: …`, Exit 0. Laufzeit lokal auf 4 Kernen: web 9:46, frontend 2:11, du 1:36. Das Repo ist öffentlich, GitHub-Standard-Runner haben dann ebenfalls 4 vCPU; der Job sollte bei etwa 15 Minuten liegen (Grenze 30, `timeout-minutes: 30`). Den ersten echten CI-Lauf hat dieser Lauf nicht gesehen (kein Push aus dem Builder).
- web braucht fast 10 Minuten, weil 130 bekannte Tests in `ProjectController.test.mjs` (overleaf-cep) je 5 Sekunden in den Timeout laufen; auf main dauert die Suite 1 Minute.

- f6: 21 neue Testdateien, 419 Tests grün, Zeilenabdeckung 98,67 % (vorher 16,56 %); `spur-dev test` erzwingt 80 %. Probe: `ignoreSiteAdmin: false` in `rechte.mjs` → 5 Tests rot (u. a. „meldet ein unbekanntes Projekt auch mit Admin-Token als keine_rechte“). Die Tests mocken `infrastructure/mongodb.mjs` und nutzen eine eigene Datenbank je Datei, weil `Settings.mongo.url` im Stack-Container auf die Dev-Datenbank zeigt. Kein Fehler im spur-Code gefunden.

## Nachabnahme f1 (stilles Grün bei falschem Dateiargument)
Befund der unabhängigen Abnahme: `spur-dev upstream web <nicht vorhandene Datei>` endete mit Exit 0 und „bestanden: 0“. f1 dafür auf `passes: false` gesetzt, behoben (Tests zuerst: `dateienPruefen`, `dateienOhneTests` in `upstream-auswertung.test.mjs`), dann wieder `true`. Nachweis, jeder Aufruf alleinstehend:
- `spur-dev upstream web test/unit/src/GibtEsNicht.test.mjs` → Exit 2, `web: FEHLER: test/unit/src/GibtEsNicht.test.mjs: nicht gefunden (Pfad relativ zum Dienst)`
- `spur-dev upstream frontend test/frontend/gibt-es-nicht.test.tsx` → Exit 2, gleiche Meldung für frontend
- `spur-dev upstream du test/unit/js/GibtEsNicht.js` → Exit 2, gleiche Meldung für du
- `spur-dev upstream web app/src/Features/Uploads/ArchiveManager.mjs` (existiert, keine Tests) → Exit 2, `kein einziger Test gelaufen`
- `spur-dev upstream web test/unit/src/Settings/Settings.test.mjs` → Exit 2, `ist ausgeschlossen (tools/tests/upstream-ausschluss.json)`
- `spur-dev upstream du app/js/HttpController.js` → Exit 2, `liegt nicht unter test/unit/ oder test/acceptance/`
- `spur-dev upstream frontend <gültiger Test> <Komponente ohne Tests>` → Exit 2, `enthält keine Tests dieser Suite`
- `spur-dev upstream vergleich webb` → Exit 2, `unbekannte Suite „webb“`; `spur-dev upstream alle <datei>` → Exit 2
- Gegenprobe: `spur-dev upstream web test/unit/src/Uploads/ArchiveManager.test.mjs` → Exit 0, `bestanden: 36, fehlgeschlagen: 1, bekannt: 1, neu: 0`; `spur-dev upstream alle` → Exit 0, web 5484/173/173/0, frontend 1659/14/14/0, du 784/0/0/0.

## Abschluss nach der Nachabnahme
- /simplify (zweite Runde, Diff ab 29950cf827): eine Suitenliste in spur-dev, Argumente vor dem Docker-Start geprüft, `alle` behält den schwersten Exit-Code, `vergleich` endet mit 2, wenn ein Stand kein Ergebnis lieferte, Ergebnisdatei erst nach den Prüfungen geschrieben (alte vorher gelöscht), Pfade einmal normalisiert. Gelassen: Vorab-Prüfung der Dateien streichen (sie spart bei Tippfehlern einen minutenlangen Lauf).
- /code-review medium auf den Plan-Diff: behoben: CI-Job `upstream` führt die Tests der Auswertung aus. Gelassen: `vergleich` aktualisiert bei Teilerfolg die fertigen Suiten und endet mit 2 (beabsichtigt); veraltete Vergleichs-Worktrees, doppelte Testtitel, nicht schreibbares Image-Verzeichnis (spekulativ); `ls-tree` und Coverage-Filter wie oben begründet.

- Schlussläufe nach der letzten Code-Änderung (ef8477eee6, nach /simplify und /code-review der dritten Runde): Browser-E2E `spur-e2e.js` f1–f15 ok; `spur-dev test` 419 Tests grün, Zeilen 98,67 %; `spur-dev upstream alle` Exit 0 (web 5484/173/173/0, frontend 1659/14/14/0, du 784/0/0/0); Ansichten bei 360 und 1280 px neu aufgenommen, ohne Überlauf.

- /simplify (dritte Runde, ganzer Plan-Diff nach e40f618266): Test der Auswertung im CI-Job vor den Image-Pull gezogen; Helfer `ladefehler` und `fehlerZeile` statt dreifach bzw. doppelt kopierter Ausdrücke; `UPSTREAM_CACHE` als eine Konstante in spur-dev. Gelassen: Composite Action für den doppelten Einrichtungsschritt (neue Datei für 8 Zeilen); Laufzeit-Schritte streichen (die Spec verlangt die Laufzeit in der Ausgabe); Ausschlussfilter in `herkunftBestimmen` streichen (schützt vor Ergebnisdateien älterer Läufe); Node-Version im CI pinnen (der Test braucht nur `node:test`).

- /code-review medium (dritte Runde, Plan-Diff bis e3ad03389f): behoben: `spur-dev upstream du test/unit` (Ordner ohne oder mit Schrägstrich) wurde nach dem Normalisieren als „liegt nicht unter test/unit/ oder test/acceptance/“ abgelehnt; Test zuerst, Nachweis: `du test/unit/` → 531 bestanden, `du test/acceptance` → 253 bestanden, beide Exit 0. Gelassen: `vergleich <suite>` rechnet die übrigen Suiten aus deren letzten vollständigen Ergebnissen neu (gleicher Stand wie die Liste); vitest-Teilstrings als Argument (dokumentiert sind Pfade); Argumentparser ohne `--ergebnis` (nur interner Aufruf); Pfade mit Leerzeichen unter `services/web` (gibt es nicht); Schmutz in den Vergleichs-Worktrees (Grammatik ist gitignoriert, vitest-Konfiguration liegt im Image); Dateien, die auf main nicht laden (würden als „nur auf spur“ gemeldet, also laut statt still); parallele Läufe im selben Container (kommen nicht vor).

## Abschluss-Review
- /simplify: umgesetzt (gemeinsame Testhilfen, Crossref-Fake über `werkAuswerten`, Lauf-Karte mit Overleafs echten Rechten je Stufe samt Track Changes, `lesenOder`/`ersteZeile`, eine Schleife im Vergleich, `!cancelled()` in CI). Bewusst gelassen: Ausschlüsse erst bei der Auswertung anwenden (Dateien wie der workbench-Test brechen sonst den ganzen mocha-Lauf ab); Grammatik im Image erzeugen (main/ext-ce-Worktrees laufen nie durch `spur-dev up`); Coverage mit v8 statt istanbul (Spec verlangt istanbul); Indizes der Test-Datenbank aus den Migrationen importieren (zieht die Migrations-Infrastruktur in die Unit-Tests).
- /code-review medium: behoben: `vergleich <suite>` löschte die Einträge der übrigen Suiten; eine gescheiterte Lezer-Grammatik erscheint jetzt als eigener Suite-Fehler statt als Folgefehler; CI zeigt Protokolle auch nach Timeout. Gelassen: fehlendes `--ergebnis` (nur interner Aufruf aus spur-dev); Mounts aus `git ls-tree HEAD` (neue Dateien in bestehenden Ordnern wie `test/` sind eingehängt, nur neue Einträge direkt unter `services/web` nicht); generierte vitest-Konfiguration (liegt im Image-Verzeichnis `/overleaf/services/web`, nicht im Worktree); Hook-Fehler ohne Datei (spekulativ); Restdatenbanken `spur-unit-*` nach abgebrochenen Läufen; nachgebaute Rechteprüfung in Unit-Tests (Absicht, Overleafs Verhalten prüfen die Upstream-Suiten).
- Kein /security-review: der Diff ändert weder Anmeldung noch Secrets noch Eingaben von Nutzern; Produktivcode nur um ein `export` in `Crossref.mjs`.

## Vorschläge
- `spur-dev upstream vergleich` könnte die Ergebnisse von main und ext-ce je Commit zwischenspeichern; heute laufen sie jedes Mal neu (rund 25 Minuten).
- Die Unit-Tests für `rechte.mjs` laufen gegen eine nachgebaute Rechteprüfung; ein web-Acceptance-Test (Backlog) würde die echte prüfen.

## Ansichten (Finish-Schritt, 360 und 1280 px)
Geprüft: Claude-Panel mit Lauf-Karte, Quellen-Panel (E2E Viele), Prüfbericht (E2E Bericht), „Claude verbinden“ in den Kontoeinstellungen. Kein horizontaler Überlauf (scrollWidth = Fensterbreite), Hierarchie und Farben passen zu Overleaf, Prüfbericht-Badges lesbar auch bei 360 px. Dieser Plan ändert keine Oberfläche; Schwächen der P1-Oberfläche als Vorschläge:
- „Widerrufen“ in „Claude verbinden“ ist ein Textknopf mit etwa 20 px Höhe (Ziel 44 px).
- „Token gültig bis 2/5/2027“: `toLocaleDateString()` folgt der Browsersprache, nicht der Sprache der Installation; mit `i18n.language` stünde in der deutschen Oberfläche 5.2.2027.
- Bei Overleafs Standardbreite des Seitenpanels (1280 px) ist der Platzhalter „Quellen durchsuchen“ abgeschnitten und der Startbefehl im Claude-Panel nur gekürzt sichtbar.

## Recipe changes
- Die Browser-Suite braucht etwa 4 Minuten, das run-code-Werkzeug von Playwright bricht nach 60 s ab und lässt den Lauf weiterlaufen (ein zweiter Aufruf läuft dann parallel auf derselben Seite). Ablauf, der funktioniert: einen Wrapper in `.playwright-mcp/` (gitignoriert) erzeugen, der `spur-e2e.js` startet, ohne zu warten, und das Ergebnis an `page.__e2eErgebnis` hängt (`globalThis` wird zwischen Aufrufen nicht geteilt), dann in Aufrufen unter 60 s abfragen.

## Prüfbefehle (E2E der CLI-Features)
Jeder als alleinstehender Aufruf: `spur-dev upstream web`, `spur-dev upstream frontend`, `spur-dev upstream du`, `spur-dev upstream vergleich`, `spur-dev test`, `node --test tools/tests/upstream-auswertung.test.mjs`. Die Browser-Suite bleibt `services/web/modules/spur/test/e2e/spur-e2e.js`.
