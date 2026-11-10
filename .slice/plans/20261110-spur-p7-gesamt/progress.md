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
- f7: Die Ausnahme je Nutzer setzt der Admin in der Nutzertabelle der Seite Admin → Limits (`/spur/admin/grenzen`),
  nicht in Overleafs Nutzerliste (admin-tools); so bleibt es bei einer Seite und ohne weiteren Kern-Patch dort.
  Der Schalter für `tex_package_add` (f5) steht auf derselben Seite.
- f9: Der Speicherstand wird nicht als Zähler fortgeschrieben, sondern bei Bedarf berechnet: Blob-Größen der Dateien
  im Projektbaum (history-v1 `blob-stats`) plus Größe der Quellen. Löschen wirkt so sofort. Gleichzeitige Uploads
  reservieren atomar an einem Zähler je Projekt (`spurStorage.reserviert`). „Speicher neu berechnen“ liest die Größe
  der Quellen-Dateien in der Ablage neu ein.
- f11: Eine Migration ist nicht nötig: Ohne Eintrag in `spurLimits` gilt unbegrenzt.
- f9: Overleafs `ProjectUploadController.test.mjs` ruft `uploadFile` jetzt mit `await` auf und mockt `Modules`,
  weil der Speicher-Hook vor dem Upload asynchron läuft.
- Abschluss: „Neuen Einladungslink erzeugen“ steht jetzt auch im ⋮-Menü der Nutzerliste; bei schmalen Bildschirmen
  zeigt admin-tools dort statt der Symbolknöpfe nur dieses Menü (beim Screenshot bei 360 px aufgefallen).
- Abschluss: `make setup` mit „nein“ zur Mail lässt vorhandene Mail-Werte stehen (Code-Review-Befund); so verlangt es
  die Entscheidung „ändert vorhandene Werte nur nach Rückfrage“.
- Abschluss: „Passwort vergessen“ ohne Mail antwortet mit 503; der Browser meldet die Antwort als Netzwerkfehler in
  der Konsole (wie Overleaf bei 400/404). Kein JavaScript-Fehler.
- Frontend-Suite: `notifications.test.tsx`, `survey-widget.test.tsx` und `project-tools-rename.test.tsx` scheitern
  auch mit dem Frontend-Stand der Basis, wenn man sie einzeln startet (Reihenfolge der Tests); im vollen Lauf
  bekannt bzw. grün.
- f12: Die E2E-Schritte nutzen das eigene Projekt „E2E Hochladen“ statt „E2E Quellen“, weil ältere Features dort
  schon smith2024.pdf hochladen und der erste Upload sonst „vorhanden“ wäre. Der Link ist an das Projekt gebunden;
  ein mitgeschicktes `project_id` wird ignoriert. Hochladen per Link gibt nur PDF (Anfang `%PDF-`) frei.
- f13: Die Skripte liegen unter `plugins/spur/bin/`; Claude Code nimmt diesen Ordner laut Changelog v2.1.91 in den
  PATH auf (per Context7 geprüft). Gegen den echten Server laufen sie erst nach dem Merge (Handprüfung).
- f14: Welche Pakete chemformula außer `xfrac` und `chemgreek` lädt, ist ohne Netz und ohne chemformula im Dev-Image
  nicht verifiziert; der Test kennt nur diese beiden.

## Handprüfungen nach dem Merge
- f3: `make setup` in einem echten Terminal (Passwort bleibt unsichtbar, Ablauf wie im Test).
- f6: Der PR dieses Plans zeigt `test` und `upstream` als bestanden; ein reiner Doku-PR zeigt beide in unter 1 Minute
  grün.
- f13: `spur-pdf-holen` mit einer echten OA-DOI und `spur-hochladen` gegen eine laufende Installation.
- f14: Smoke auf spur ist grün, auch „Compile Folien“ (Image mit `xfrac`).

## Needs decision

## Vorschläge (außerhalb dieses Plans)
- Simplify (Altitude, nicht umgesetzt): ob Mail eingerichtet ist, könnte `EmailSender` selbst sagen statt der eigenen
  Heuristik in `EmailConfiguration.mjs`; die Speicher-Grenze könnte an einer gemeinsamen Stelle für alle Datei-Wege
  greifen (etwa `ProjectEntityUpdateHandler`) statt in Upload- und LinkedFiles-Controller; `/admin/register` und
  `user-activate` könnten entfallen, wenn der Dialog in der Nutzerliste reicht.
- Projektliste: „3 von 3 Projekten“ (Grenze) steht nahe an Overleafs „Es werden 3 von 3 Projekten angezeigt“;
  eine eindeutigere Formulierung wie „3 von 3 erlaubten Projekten“ wäre klarer (Owner-Entscheidung zum Text).
- Verknüpfte Dateien prüfen nur „schon voll“ und reservieren nichts, weil die Größe vorher unbekannt ist.
- f5: Mit `docker-compose.sandbox.yml` kompiliert ein anderes TeX-Live-Image; „schon im Image“ prüft die
  Paketdatenbank des Web-Containers. Bei abweichenden Images müsste das Werkzeug die Datenbank des Compile-Images
  lesen.
- CI: `package.json`, `.yarnrc.yml` und `server-ce/` lösen `upstream` bisher nicht aus; bei Bedarf in
  `tools/ci/aenderungen.mjs` ergänzen.
