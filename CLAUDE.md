# spur

Agentische Schreibumgebung für wissenschaftliche Arbeiten auf Basis von Overleaf.

## Befehle

- Stack starten: `spur-dev up`, stoppen: `spur-dev down`, zurücksetzen: `spur-dev reset`
- Nach Änderungen am Frontend: `spur-dev reload` (Webpack ohne Netz, dann Neustart)
- Nach Änderungen am Backend: `spur-dev restart`
- Unit-Tests: `spur-dev test`
- Testkonto: `spur-dev user mail@example.org` liefert den Aktivierungslink
- Logs: `spur-dev logs 100`

`spur-dev` liegt außerhalb des Repos und hängt den aktuellen Worktree in das Image `ghcr.io/ahlerjam/spur-dev` ein. Es läuft als einziger Befehl außerhalb der Sandbox, und nur als alleinstehender Aufruf: Mit `;`, `&&`, Pipe oder Umleitung bleibt er in der Sandbox und erreicht Docker nicht. Freies `docker` ist gesperrt.

Neue npm-Pakete brauchen einen neuen Lauf des Workflows `Dev image`. In einem Builder-Lauf sind sie ein Stoppgrund.

Testartefakte, Screenshots und Hilfsskripte gehören nicht ins Repo.
