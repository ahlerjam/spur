Type: api, web

# spur P16: TeX-Umgebung, die übliche Arbeiten ohne Nachladen kompiliert

## Zweck
In einer echten APA-Arbeit fehlten Standardpakete wie `booktabs`, `float`, `caption` und `lineno`; das kostete fünf Kompilier-Runden, und `fehlende_abhaengigkeiten` blieb leer, obwohl Pakete fehlten. `minted` für Code-Listings ist gar nicht nutzbar. Dieser Plan bringt die gängigen Pakete fest ins Image, macht `minted` nutzbar und lässt spur fehlende Pakete aus dem Kompilierlog ablesen.

## Nutzer
Forschende, die Abschlussarbeiten und Paper in spur schreiben; Claude, das kompiliert und Fehler behebt; Betreiber, die das Image bauen.

## Was Nutzer danach können
- Eine übliche APA-7-Arbeit mit Tabellen, Abbildungen, Diagrammen und Zeilennummern beim ersten Versuch kompilieren.
- Code mit `minted` farbig setzen.
- Nach einem gescheiterten Kompilieren sofort sehen, welches TeX-Live-Paket fehlt, und es in einem Schritt nachladen.

## Context
- `server-ce/Dockerfile-base`: TeX Live `scheme-basic` plus eine kurze Liste (`latexmk`, `biblatex`, `biber`, `biblatex-apa`, `csquotes`, `natbib`, `beamer`, `babel-german`, `siunitx`, `beamertheme-metropolis`, …). Es fehlen unter anderem `apa7` samt Abhängigkeiten, `booktabs`, `caption`, `float`, `lineno`, `pgfplots`, `minted`. Dokumentationsdateien werden nicht installiert.
- `tools/tests/tex-pakete.test.mjs` prüft, dass jedes Paket, das das Smoke-Dokument lädt, in der Paketliste des Images steht (aus P6). Der Workflow `Dev image` baut das Image für beide Architekturen und prüft die TeX-Umgebung.
- Der lokale Image-Bau scheitert am Firmen-Proxy (Zscaler). Im Builder-Lauf lässt sich das neue Image deshalb nicht bauen.
- `tex_package_add` (`kompilieren/TexPakete.mjs`) lädt Pakete ins Projekt und füllt `fehlende_abhaengigkeiten` nur aus den `depend`-Zeilen des geladenen Pakets. `compile` und `compile_log` leiten aus dem Log nichts ab. Echter Fall: `fehlende_abhaengigkeiten` war leer, während das Log „File `booktabs.sty' not found“ zeigte.
- Der Paketname in TeX Live weicht oft vom Dateinamen ab (`beamerthemefocus.sty` liegt in `beamertheme-focus`, `tikz.sty` in `pgf`). Die lokale `texlive.tlpdb` des Images und der Spiegel kennen die Zuordnung Datei → Paket.
- `minted`: Laut Overleaf-Doku braucht ein lokales TeX zusätzlich Pygments. Der Kompilierdienst (`services/clsi`) kennt `_minted`-Verzeichnisse bereits als Zwischendateien. Ob die aktuelle minted-Version mit eingeschränktem Shell-Escape auskommt, ist nicht verifiziert.

## Decisions
Owner-Entscheidungen (2026-11-16):
- Kuratierte Paketliste statt eines größeren TeX-Live-Schemas; das Image bleibt schlank.
- `minted` wird installiert und nutzbar gemacht.
- spur leitet fehlende Pakete aus dem Kompilierfehler ab.
Annahmen (ohne Rückfrage getroffen):
- Fest ins Image: `apa7` mit allen Paketen, die `apa7.cls` in den Modi `man`, `stu`, `jou` und `doc` lädt, und allen, die `biblatex-apa` braucht; dazu `booktabs`, `caption`, `float`, `lineno`, `pgfplots`, `tabularx` (in `tools`), `multirow`, `longtable` (in `tools`), `threeparttable`, `makecell`, `colortbl`, `xcolor`, `graphics`, `geometry`, `setspace`, `fancyhdr`, `titlesec`, `enumitem`, `microtype`, `hyperref`, `url`, `cleveref`, `subcaption` (in `caption`), `wrapfig`, `rotating`, `pdflscape`, `placeins`, `footmisc`, `parskip`, `ragged2e`, `endfloat`, `listings`, `algorithms`, `algorithmicx`, `amsmath`, `amsfonts`, `mathtools`, `lm`, `fontspec`, `babel-english`, `hyphen-english`, `todonotes`, `acronym`, `glossaries`, `scrextend`/`koma-script`, `minted` mit seinen TeX-Abhängigkeiten. Der Builder ermittelt die echten Abhängigkeiten aus der `texlive.tlpdb` (im Fake bzw. im Dev-Image), nicht aus dem Gedächtnis, und schreibt die vollständige Liste alphabetisch in die Dockerfile.
- Das Smoke-Dokument bekommt zwei weitere Dateien: eine APA-7-Arbeit (`\documentclass[man]{apa7}`, deutsch, mit `booktabs`-Tabelle, `threeparttable` mit Anmerkung, `pgfplots`-Diagramm, `lineno`, `float`, `caption`, Literatur über `biblatex-apa`) und ein Dokument mit `minted` (Python- und R-Beispiel). Der Test aus P6 gilt für beide.
- `minted`: Der Builder liest die aktuelle minted-Doku (Context7 oder die im Dev-Image vorhandene Paketdoku) und richtet den Weg ein, den sie für TeX Live vorsieht (Python mit Pygments bzw. das zugehörige Hilfsprogramm im Image). Erlaubt ist nur eingeschränktes Shell-Escape mit genau dem Programm, das minted braucht. Verlangt die installierte Version volles `-shell-escape`, hält der Lauf an und meldet das, statt es einzuschalten: In der Standard-Installation ohne Sandbox wäre das Ausführen beliebiger Befehle aus Nutzer-Dokumenten.
- Fehlende Pakete aus dem Log: `compile` und `compile_log` liefern zusätzlich `fehlende_pakete`, eine Liste aus `datei` (aus „File `X' not found“, auch für `.cls`, `.bst`, `.def`, `.tfm`-Fonts und „LaTeX Error: Unknown option“ nicht), `paket` (TeX-Live-Paketname, wenn die Zuordnung bekannt ist, sonst `null`) und `im_image` (falsch). Die Zuordnung kommt aus der Dateiliste der TeX-Live-Paketdatenbank des Spiegels, die `tex_package_add` schon nutzt; sie wird je Installation zwischengespeichert (24 Stunden). Ist der Spiegel nicht erreichbar, ist `paket` `null` und `grund: "spiegel_nicht_erreichbar"`.
- `tex_package_add` nimmt statt `paket` auch `datei` (etwa `booktabs.sty`) und löst sie selbst auf.
- Der Kompilierbereich im Browser zeigt bei fehlenden Paketen über dem Log die Zeile „Fehlendes Paket: <paket> (für <datei>)“ je Eintrag; ohne bekannte Zuordnung „Fehlende Datei: <datei>“.
- Verifikation des Images: Im Lauf prüfen Tests die Paketliste gegen die Smoke-Dokumente und die Log-Auswertung gegen echte Logauszüge. Der Beleg, dass das Image wirklich kompiliert, ist der Workflow `Dev image` nach dem Merge; der Builder startet ihn nicht und baut kein Image lokal. Die README nennt die neuen Pakete und `minted` in einem Absatz.
- Die Größe des Images wird im Workflow ausgegeben (vorher und nachher), damit der Zuwachs sichtbar ist.

## Quality bar
- MCP und API: bestehende Fehlercodes und Felder bleiben unverändert; neue Zustände, Felder und Hinweise haben feste Schlüssel und stehen in `docs/mcp-contract.md`. Listen sind paginiert (50 je Seite, `cursor`).
- Zugriff wird bei jedem Aufruf für das angesprochene Projekt geprüft; ein Konto ohne Schreibrecht kann nichts ändern.
- Fehlermeldungen sagen, was passiert ist und was zu tun ist. Ein Ausfall eines fremden Dienstes wird nie als Befund über die Arbeit ausgegeben.
- Fremder Text (Metadaten, Quellen, Dateinamen, Logs) wird als Daten behandelt; SSRF-Schutz (`netz.mjs`) gilt für jede neue ausgehende Anfrage.
- Web: per Tastatur bedienbar mit sichtbarem Fokus, Kontrast mindestens 4,5:1 (hell und dunkel), kein horizontales Rollen bei 360 px, keine Konsolenfehler, keine nativen `alert`/`confirm`/`prompt`.
- Texte: deutsch geduzt und englisch in beiden Sprachdateien; deutsche Texte mit humanizer-de, englische mit humanizer geprüft.

### Tests (TDD)
- Jede Änderung an Server- oder Frontend-Logik beginnt mit einem roten Test unter `services/web/modules/spur/test/unit` bzw. `test/frontend`; die echten Fälle aus `## Context` sind als Testfälle enthalten.
- Externe Dienste laufen über die vorhandenen Fakes (`PaperFake`, `TexLiveFake`); neue Störungen bekommen Schalter im Fake.
- Die E2E-Suite bekommt je Feature Schritte (`p16f1` …) und läuft nach dem Zurücksetzen der Testdaten vollständig grün, auch alle älteren Features.
- `spur-dev test` bleibt über 80 % Zeilenabdeckung; `node --test tools/tests/*.test.mjs` ist grün (auch der Vertragstest `mcp-vertrag.test.mjs`).
- Overleafs eigene Suiten bleiben grün bis auf die bekannte Upstream-Liste.
