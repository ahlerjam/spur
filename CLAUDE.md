# spur

Agentische Schreibumgebung für wissenschaftliche Arbeiten auf Basis von Overleaf.

## Befehle

- Stack starten: `spur-dev up`, stoppen: `spur-dev down`, zurücksetzen: `spur-dev reset`
- Nach Änderungen am Frontend: `spur-dev reload` (Webpack ohne Netz, dann Neustart)
- Nach Änderungen am Backend: `spur-dev restart`
- Unit-Tests: `spur-dev test`
- Testkonto: `spur-dev user mail@example.org` liefert den Aktivierungslink
- Skript im Container: `spur-dev run modules/spur/test/skript.mjs` (Pfad relativ zu `services/web`)
- Mongo: `spur-dev mongo 'db.users.countDocuments()'`, Sicherung: `spur-dev dump`, `spur-dev restore`
- Migrationen: `spur-dev migrate up`
- Logs: `spur-dev logs web 100`, andere Dienste wie `clsi` oder `document-updater`

`spur-dev` liegt außerhalb des Repos und hängt den aktuellen Worktree in das Image `ghcr.io/ahlerjam/spur-dev` ein. Es läuft als einziger Befehl außerhalb der Sandbox, und nur als alleinstehender Aufruf: Mit `;`, `&&`, Pipe oder Umleitung bleibt er in der Sandbox und erreicht Docker nicht. Freies `docker` ist gesperrt.

Neue npm-Pakete brauchen einen neuen Lauf des Workflows `Dev image`. In einem Builder-Lauf sind sie ein Stoppgrund.

Testartefakte, Screenshots und Hilfsskripte gehören nicht ins Repo.
