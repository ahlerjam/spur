# Progress P16

## Stand
- f1: alle Schritte gebaut, Schritt 5 lässt sich im Dev-Stack nicht prüfen (siehe Needs decision); `passes` bleibt false. E2E `p16f1` (Repo-Prüfungen) ok, `p16f1b` (Compile im Dev-Stack) übersprungen, solange das Dev-Image älter als P16 ist.
- f2: besteht (`p16f2`).
- f3: besteht (`p16f3`).

## f3
- Zuordnung Datei → Paket aus `<spiegel>/tlpkg/texlive.tlpdb.xz` (2,8 MB, entpackt 21 MB), gestreamt durch `xz -dc`, nur Laufzeitdateien mit den Endungen, die `tex_package_add` auch anlegt; im Speicher des Web-Prozesses 24 h vorgehalten, gleichzeitige Abfragen teilen einen Abruf, ein Ausfall wird nicht vorgehalten. Erst der Spiegel des Images, dann `mirror.ctan.org`, je einmal.
- Kein `netz.mjs`: Die Spiegel-Adresse kommt aus der `texlive.tlpdb` des Images bzw. ist fest (wie beim Archiv-Download in P7), nie aus Nutzereingaben; im Dev-Stack ist der Fake lokal und wäre gesperrt.
- Der Browser liest die fehlenden Dateien selbst aus dem Log (dasselbe Modul `fehlendeDateien.mjs` wie der Server) und fragt `GET /spur/project/<id>/tex-pakete/fehlend?datei=…` (Leserecht, höchstens 20 Dateien). Antwortet der Server nicht, stehen die Dateien ohne Paket da.
- `.bbx`, `.cbx`, `.lbx`, `.dbx` zählen jetzt als Laufzeitdateien (vorher legte `tex_package_add` biblatex-Stile ohne diese Dateien an).
- Fake: `texlive.tlpdb.xz` entsteht aus `test/fixtures/texlive/`; `_steuerung` mit `cachesLeeren` vergisst auch die Zuordnung.

## Needs decision
- f1: Schritt 5 braucht ein Dev-Image mit den Paketen aus P6 (`babel-german`, `siunitx`). Das gezogene `ghcr.io/ahlerjam/spur-dev:amd64` ist älter: `kpsewhich ngerman.ldf` und `kpsewhich siunitx.sty` finden nichts, seine `texlive.tlpdb` hat 167 Pakete, Compile scheitert mit „Unknown option 'ngerman'“ und „File `siunitx.sty' not found“. Die Pakete stehen seit `eb7c4e1dc4` (P6 f9) in `server-ce/Dockerfile-base`; der Workflow `Dev image` lief seitdem offenbar nicht.
  Interim: `p16f1b` prüft zuerst mit `tex_package_add` `apa7`, ob das Image aus P16 stammt (`im_image: true`), und meldet sonst „übersprungen“. f1 bleibt false.
  Options: A (empfohlen) Nach dem Merge `Dev image` starten, dann `p16f1b` laufen lassen und f1 auf true setzen | B Den Workflow-Compile (Schritt „Smoke-Dokumente kompilieren“) als Beleg für Schritt 5 annehmen

## Entscheidungen
- Paketliste aus der echten `texlive.tlpdb` des Spiegels (`mirror.ctan.org`, 2026-11-20) ermittelt: Seeds aus der Spec, dann transitiv jede `\RequirePackage`/`\usepackage`/`\LoadClass`-Zeile der `.sty/.cls/.bbx/.cbx/.def`-Dateien der Paketarchive, Datei → Paket über die `runfiles` der tlpdb, abzüglich `scheme-basic`. Alle 89 Namen stehen als `name …` in der tlpdb; `tlmgr` zieht zusätzlich die `depend`-Pakete (`euenc`, `tipa`, `units`, `xetexconfig`, `xunicode`).
- Nicht übernommen, weil nur in Beispiel- oder Sonderzweigen geladen: die `pstricks`-Familie (über `fvrb-ex.sty` von `fancyvrb`), `unicode-math`/`lualatex-math`/`luatexbase` (nur unter LuaTeX in `pgfplots`/`microtype`), `tcolorbox`, `showexpl`, `subfig`, `contract`/`defoldfonts` (KOMA-Erweiterungen), `pdfcolmk`, `ucs`, `sansmathaccent`. `rotating` und `scrextend` sind keine eigenen TeX-Live-Pakete (in `graphics` bzw. `koma-script`).
- Schon in `scheme-basic`: `amsfonts`, `amsmath`, `babel-english`, `colortbl`, `fancyhdr`, `geometry`, `graphics`, `hyperref`, `hyphen-english`, `lm`, `tools` (u. a. `tabularx`, `longtable`), `url`. Sie stehen nicht in der Liste.
- Smoke-Dokumente als Dateien unter `services/web/modules/spur/scripts/smoke/`; `smoke-dokumente.mjs` liest `apa7-arbeit.tex` und `minted-beispiel.tex` mit ein, damit Paketlisten-Test und Workflow `Smoke` sie auch abdecken.
- Der Workflow sucht „not found“ ohne Zeilen mit „ Info: “: biblatex meldet `biblatex-dm.cfg` immer als „Info: … not found“.
- Zusätzlicher Beleg (kein Ersatz für den Workflow): Die Archive der Liste in ein temporäres `TEXMFHOME` entpackt und im Dev-Container mit den Flags aus `LatexRunner.js` kompiliert: `apa7-arbeit.tex`, `minted-beispiel.tex` und `shell-escape.tex` ergeben PDFs, `pdftotext` zeigt Tabelle, Anmerkung, Abbildung und Literatur bzw. beide Listings, `/tmp/spur-shell-test` entsteht nicht. Ohne die neuen Pakete scheitert derselbe Schritt an „File `apa7.cls' not found“. Die Warnung „No hyphenation patterns were preloaded“ für Deutsch im TEXMFHOME-Lauf ließ sich nicht klären (das Dev-Image hat kein `babel-german`); tlmgr baut die Formate beim Installieren von `hyphen-german` neu.
- „Kein -shell-escape“ als Test in `tools/tests/tex-pakete.test.mjs` (läuft mit `node --test tools/tests/*.test.mjs` in CI), weil Overleafs clsi-Suite nicht Teil von `spur-dev upstream` ist.

## Abschluss
- /simplify (4 Prüfer): umgesetzt sind doppelte Prüfungen im Paketlisten-Test, gemeinsame E2E-Helfer für Paketliste und Workflow-Schritt, `compile_log` nutzt die Liste des Jobs, Workflow sucht genau `^! .*not found`, eine gemeinsame Prüfung für Laufzeitdateien in Index und Installation, `readdir` rekursiv im Fake. Gelassen: statische Repo-Prüfungen auch im E2E (die Skill-Regel will jeden Schritt dort), alte Retry-Schleifen anderer Features, Retry/Negativ-Cache für den Index (Spec: der nächste Aufruf fragt neu), Index in Mongo (Spec: je Installation), abgeleitete Paket-Maps im Test (der Workflow-Compile ist der echte Beleg).
- /code-review medium: behoben sind fehlende Pakete auch bei einem Compile, der trotz Fehler als Erfolg zählt; kein Spiegel-Abruf bei abgeschalteten TeX-Paketen (`grund: "abgeschaltet"`); Index-Timeout 30 s statt 120 s; eine 79-Zeichen-Zeile vor „! …“ verschluckt die Meldung nicht mehr; unsichere Dateinamen am Endpunkt ergeben `paket: null` statt 400; `compile_log` fragt nach einem Spiegel-Ausfall neu; `dateiIndexVergessen` verwirft auch einen laufenden Abruf.
- Security-Review: `/security-review` braucht `origin/HEAD`, das im Worktree fehlt; ein Subagent hat `git diff c361a6be8f..HEAD` geprüft: keine Funde.
- Texte mit humanizer-de/humanizer geprüft; geändert: „Gib genau eins an: …“ (de/en).
- Der volle E2E-Lauf dauert länger als die 60 s des run-code-Werkzeugs; er lief deshalb über ein Startskript (nicht im Repo), das die Suite startet und das Ergebnis in die Browser-Konsole schreibt.
- Erster Gesamtlauf: `p5f8` rot, weil `661a28817e` (vor diesem Plan) vier Ideen in `docs/backlog.md` ergänzte und die Zahl im Schritt nicht nachzog; die Zahl steht jetzt auf 45 mit Verweis auf den Commit. `p10f4` rot mit „Rohprotokoll“-Timeout, einzeln danach ok (derselbe Wackler wie in P10).
- Letzter Gesamtlauf nach der letzten Änderung (`2e3802658a`, 13:06 bis 13:27): 102 von 102 ok, `p16f1b` übersprungen (Dev-Image älter als P16).
- Screenshots des Log-Bereichs mit „Fehlendes Paket: spurdemo (für spurdemo.sty)“ bei 1280 und 360 px: im Stil eines Log-Eintrags mit roter Fehlerkante, kein seitliches Rollen bei 360 px; die enge Teilung bei 360 px ist Overleafs Editor-Layout.
- `spur-dev test`: grün, 92 % Zeilen; `node --test tools/tests/*.test.mjs`: 76 grün; Frontend-Test `fehlende-pakete.test.tsx`: 4 grün.

## Vorschläge
- Eine `latexmkrc` im Projekt ist Perl und läuft auf dem Server; restricted shell escape ist deshalb keine Sandbox (ADR 0007). Wer fremde Projekte kompiliert, braucht eine echte Sandbox für den Kompilierdienst.
