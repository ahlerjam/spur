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

- f1: Overleaf leitet Nicht-Admins bei `/admin/register` und der neuen Link-Aktion auf `/restricted` um (302) statt
  403 zu senden; der E2E-Schritt akzeptiert beides. „Passwort vergessen“ ohne Mail antwortet mit 503, weil die Seite
  bei 200 auf „Prüfe dein Postfach“ umschaltet und den Hinweis ausblendet.
- f5: Ohne Netz im Lauf ist das Test-Theme kein echtes CTAN-Paket, sondern `beamertheme-spurtest` mit der
  Abhängigkeit `spurfarben` als Textdateien im TeX-Live-Archivformat (`test/fixtures/texlive/`); der Fake baut die
  `.tar.xz` zur Anfrage. Im Dev-Stack mit Paper-Fake gilt der Fake als Spiegel, sonst `opt_location` aus der lokalen
  `texlive.tlpdb` (Fallback `mirror.ctan.org`). Abhängigkeiten kommen aus `tlpkg/tlpobj/<paket>.tlpobj` im Archiv,
  nicht aus der großen Remote-Datenbank. Dateien werden flach unter `tex-pakete/<paket>/` abgelegt; die `latexmkrc`
  entsteht als Datei (keine Track Change) bzw. wird als Track Change ergänzt, wenn eine eigene existiert.
- f5: „Lauf rückgängig“ gibt es jetzt auch für offene Läufe mit angelegten Dateien: Es lehnt die Changes ab und
  entfernt das Angelegte. „Lauf ablehnen“ entfernt das Angelegte ebenso.
- f5: Der Admin-Schalter in den spur-Einstellungen kommt mit der Admin-Seite aus f7; bis dahin wirkt nur
  `SPUR_TEX_PAKETE=aus`.
- f7–f10: e2e-a besitzt über 30 Projekte für ältere Features, e2e-b gibt es nicht. Die Grenzen-Schritte nutzen
  eigene Konten ohne Admin-Rechte (`e2e-grenze-a`, `e2e-grenze-b`).
- f14: Welche Pakete chemformula außer `xfrac` und `chemgreek` lädt, ist ohne Netz und ohne chemformula im Dev-Image
  nicht verifiziert; der Test kennt nur diese beiden.

## Handprüfungen nach dem Merge
- f3: `make setup` in einem echten Terminal (Passwort bleibt unsichtbar, Ablauf wie im Test).
- f6: Der PR dieses Plans zeigt `test` und `upstream` als bestanden; ein reiner Doku-PR zeigt beide in unter 1 Minute
  grün.
- f14: Smoke auf spur ist grün, auch „Compile Folien“ (Image mit `xfrac`).

## Needs decision

## Vorschläge (außerhalb dieses Plans)
- f5: Mit `docker-compose.sandbox.yml` kompiliert ein anderes TeX-Live-Image; „schon im Image“ prüft die
  Paketdatenbank des Web-Containers. Bei abweichenden Images müsste das Werkzeug die Datenbank des Compile-Images
  lesen.
- CI: `package.json`, `.yarnrc.yml` und `server-ce/` lösen `upstream` bisher nicht aus; bei Bedarf in
  `tools/ci/aenderungen.mjs` ergänzen.
