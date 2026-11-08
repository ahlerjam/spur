# spur

Agentische Schreibumgebung für wissenschaftliche Arbeiten auf Basis von Overleaf.

## Befehle

- Stack starten: `spur-dev up`, stoppen: `spur-dev down`, zurücksetzen: `spur-dev reset`
- Nach Änderungen am Frontend: `spur-dev reload` (Webpack ohne Netz, dann Neustart)
- Nach Änderungen am Backend: `spur-dev restart`
- Unit-Tests: `spur-dev test` (mit Abdeckungsbericht, Schwelle 80 % der Zeilen)
- Overleafs Suiten: `spur-dev upstream web|frontend|du|alle`, einzelne Dateien als weitere Argumente (Pfad relativ zum Dienst). Ausgabe endet mit „bestanden, fehlgeschlagen, bekannt, neu“; Exit 1 nur bei neuen Fehlern, Exit 2, wenn eine angegebene Datei fehlt, ausgeschlossen ist oder keine Tests enthält, oder wenn gar kein Test läuft
- Dreier-Vergleich `main`, `ext-ce`, aktueller Stand: `spur-dev upstream vergleich` schreibt `tools/tests/upstream-bekannt.json` neu (etwa 40 Minuten). Ausschlüsse mit Grund in `tools/tests/upstream-ausschluss.json`
- Tests der Auswertung: `node --test tools/tests/upstream-auswertung.test.mjs`
- Testkonto: `spur-dev user mail@example.org` liefert den Aktivierungslink. Das Konto ist Admin; Rechteprüfungen brauchen Konten ohne Admin.
- E2E: erst `spur-dev run modules/spur/test/e2e/vorbereiten.mjs`, dann alle Features in einem Lauf. `spur-dev up` legt `services/web/modules/spur/dev-schalter.json` mit dem Crossref-Fake an, falls sie fehlt
- Skript im Container: `spur-dev run modules/spur/test/skript.mjs` (Pfad relativ zu `services/web`)
- Mongo: `spur-dev mongo 'db.users.countDocuments()'`, Sicherung: `spur-dev dump`, `spur-dev restore`
- Migrationen: `spur-dev migrate migrate -t server-ce`, zurück: `spur-dev migrate rollback -t server-ce <name>`
- Logs: `spur-dev logs web 100`, andere Dienste wie `clsi` oder `document-updater`

Die Quelle von `spur-dev` liegt in `tools/spur-dev/`. Ein Mensch installiert sie mit `tools/spur-dev/spur-dev install` als feste Kopie außerhalb des Repos; Änderungen an der Quelle wirken erst nach erneutem `install`. `spur-dev` hängt den aktuellen Worktree in das Image `ghcr.io/ahlerjam/spur-dev` ein. Es läuft als einziger Befehl außerhalb der Sandbox, und nur als alleinstehender Aufruf: Mit `;`, `&&`, Pipe oder Umleitung bleibt er in der Sandbox und erreicht Docker nicht. Freies `docker` ist gesperrt.

Neue npm-Pakete brauchen einen neuen Lauf des Workflows `Dev image`. In einem Builder-Lauf sind sie ein Stoppgrund.

## Tests (TDD)

Test zuerst: Neue oder geänderte Server-Logik beginnt mit einem roten Unit-Test unter `services/web/modules/spur/test/unit`, jeder behobene Fehler mit einem Test, der ihn nachstellt. Neue Oberflächen bekommen Frontend-Tests und Schritte in der E2E-Suite. Overleafs eigene Suiten bleiben grün bis auf die Liste bekannter Upstream-Fehler (`tools/tests/upstream-bekannt.json`); ein Eintrag mit Herkunft `spur` ist nicht erlaubt.

Testartefakte, Screenshots und Hilfsskripte gehören nicht ins Repo.
