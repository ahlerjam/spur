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

## Prüfbefehle (E2E der CLI-Features)
Jeder als alleinstehender Aufruf: `spur-dev upstream web`, `spur-dev upstream frontend`, `spur-dev upstream du`, `spur-dev upstream vergleich`, `spur-dev test`, `node --test tools/tests/upstream-auswertung.test.mjs`. Die Browser-Suite bleibt `services/web/modules/spur/test/e2e/spur-e2e.js`.
