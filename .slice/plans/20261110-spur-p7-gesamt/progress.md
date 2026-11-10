> Übernommen aus dem abgebrochenen Lauf 20261110-spur-p7-betrieb (dort f1–f6 des alten Plans; gebaut: alt-f3 make setup, alt-f4 Drosselung, alt-f6 CI; alt-f1/f2 als WIP ungeprüft committet). Die Feature-Nummern unten beziehen sich auf den alten Plan.

# Fortschritt P7

## Entscheidungen im Lauf (umkehrbar)
- f3: Die Logik steht in `tools/setup.sh`, das Makefile ruft es nur auf. Eine Pseudo-Konsole (`script`, Pythons
  `pty`) geht in der Sandbox nicht. Darum hat das Skript neben dem Trockenlauf-Schalter `SPUR_SETUP_TROCKEN=1` einen
  zweiten Testschalter `SPUR_SETUP_TEST_STDIN=1`, der die Terminal-Prüfung überspringt; `tools/tests/setup.test.mjs`
  liefert die Antworten damit per Pipe.
- f4: Die Regel steht in `SKILL.md` unter „Throttled or unreachable services“; der deutsche Workflow-Text „Quellen
  sammeln“ verweist mit diesem Namen darauf.
- f6: `test` und `upstream` bleiben je ein Job mit unverändertem Namen. Ein Job `changes` bewertet die Dateien mit
  `tools/ci/aenderungen.mjs`; bei „leicht“ läuft nur ein Echo-Schritt. Scheitert `changes`, läuft alles voll.
  Image- und Playwright-Caches sind nicht eingebaut: Jede Hetzner-VM startet leer, ein Cache wäre kaum schneller als
  der Pull aus GHCR (erst nach einer Messung am PR).

## Handprüfungen nach dem Merge
- f3: `make setup` in einem echten Terminal (Passwort bleibt unsichtbar, Ablauf wie im Test).
- f6: Der PR dieses Plans zeigt `test` und `upstream` als bestanden; ein reiner Doku-PR zeigt beide in unter 1 Minute
  grün.

## Needs decision

## Vorschläge (außerhalb dieses Plans)
- CI: `package.json`, `.yarnrc.yml` und `server-ce/` lösen `upstream` bisher nicht aus; bei Bedarf in
  `tools/ci/aenderungen.mjs` ergänzen.
