# Fortschritt 20261106-spur-p1-kern

## Needs decision
- f1, f8, f9, f10: Der Guard `guard-features.mjs post` meldet nach jedem Bash-Aufruf „features.json changed beyond the passes fields“. Grund: `d487908589` und `57ac447007` haben den Plan nach `d37369ca3f` geändert, ohne neuen Commit `slice: plan 20261106-spur-p1-kern` (`run/SKILL.md:33-34`). Soll die Plan-Markierung nachgezogen werden?
  Interim: Der Build folgt dem HEAD-Stand von `features.json` und ändert dort nur `passes`. Weder wird die alte Fassung wiederhergestellt noch legt der Builder selbst einen `slice: plan`-Commit an, denn damit würde er die Referenz des Guards verschieben, der ihn überwacht. Die Hook-Meldungen bleiben stehen; sie halten nichts auf, weil der Hook nach der Ausführung läuft.
  Options: A (empfohlen): Owner oder Orchestrator legt für künftige Läufe nach jeder Planänderung den Commit `slice: plan <id>` an | B: Guard vergleicht künftig mit dem Stand beim Laufstart

## Menschlich zu prüfen
- f1: `make start` läuft im Builder nicht, und der Builder pusht nicht. `Publish` und `Smoke` sind deshalb noch nicht in der CI gelaufen. Bitte nach dem Merge `Publish` und danach `Smoke` starten. Lokal geprüft: `smoke-compile.mjs` im Stack, YAML-Syntax, `make -n start`. Nicht geprüft: der Inhalt der von `make start` erzeugten `.env`, weil der Builder `.env`-Dateien nicht lesen darf; das prüft der Schritt „Secret prüfen“ in `Smoke`.
- Hinweis zum Worktree: Ein Prüfbefehl des Builders lief wegen eines gescheiterten `mktemp` im Worktree-Wurzelordner und führte dort `make .env` aus. Dort liegt jetzt eine gitignorierte `.env`. Der Builder konnte sie weder lesen noch ihre Herkunft klären und hat sie nicht gelöscht. Falls dort vorher eine eigene `.env` lag, wurde sie vermutlich überschrieben. Sie wird nicht committet und von `spur-dev` nicht benutzt.

## Entscheidungen
- Finish-Basis: Die Skill-Formel ergibt `d37369ca3f^`. Dieser Diff enthält auch die Owner-Commits (Lockfile, MCP-Pakete, nginx). `/simplify` und `/code-review` laufen deshalb auf `46c92846db..HEAD`, also nur auf der Arbeit dieses Laufs.
