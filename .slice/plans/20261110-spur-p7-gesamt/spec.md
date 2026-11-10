Type: web, api, cli

# spur P7 (gesamt): Betrieb, Grenzen, PDFs vom Rechner

## Zweck
Zusammengelegt aus den Plänen P7 (Betrieb ohne Mail, Einrichtung, Pakete pro Projekt, sparsame CI), P8 (Grenzen für Projekte und Speicher) und P9 (PDFs vom Rechner hochladen) auf Wunsch des Owners: ein Plan, ein Lauf, ein PR. Der Lauf beginnt auf dem Stand des abgebrochenen P7-Laufs; dort sind „make setup“, die Plugin-Regel zur Drosselung und die sparsame CI schon gebaut und werden hier nur geprüft. Alle Inhalte sind vom Owner entschieden; der Lauf stellt keine Rückfragen zu ihnen.

## Nutzer
Admins und Betreiber einer spur-Installation; Forschende, die mit Claude Code in spur arbeiten; der Owner, der die CI bezahlt.

## Was Nutzer danach können
- Als Admin ein Konto anlegen und den Einladungslink sofort kopieren und selbst weitergeben, wenn keine Mail eingerichtet ist, auch für bestehende Konten einen neuen Link erzeugen.
- Sehen, ob spur Mails verschicken kann, statt einer falschen Erfolgsmeldung.
- spur beim ersten Start mit `make setup` einrichten: Adresse, Mail (optional), Kontaktadresse für Crossref und Unpaywall.
- Claude ein fehlendes LaTeX-Paket oder Beamer-Theme ins Projekt holen lassen, ohne dass der Server neue TeX-Pakete oder Images braucht.
- Sich darauf verlassen, dass Claude bei gedrosselten Recherche-Diensten sinnvoll weiterarbeitet.
- PRs mit weniger CI-Laufzeit prüfen lassen.
- Admins setzen im Admin-Bereich einen Standard für alle (Projekte je Nutzer, GB je Projekt; leer = unbegrenzt) und je Nutzer eine Ausnahme.
- Admins sehen in einer Übersicht Projekte je Nutzer und Speicher je Projekt und wer nah an einer Grenze ist.
- Nutzer sehen, wie viele Projekte sie noch anlegen dürfen und wie voll ein Projekt ist, und bekommen beim Erreichen eine Meldung, die sagt, was zu tun ist.
- Claude PDFs auf dem eigenen Rechner holen lassen (auch über den Zugang der Hochschule oder mit Playwright) und direkt als Quellen in spur hochladen, viele auf einmal.

## Context
### Betrieb, Einrichtung, Pakete, CI
- Admin-Nutzerverwaltung (Modul admin-tools aus overleaf-cep): „Nutzer anlegen“ erzeugt einen Aktivierungslink und schickt ihn nur per Mail; die Antwort enthält ihn nicht. Die Registrierseite `/admin/register` (Modul user-activate) zeigt den Link in einer Tabelle an, ist aber im Menü kaum zu finden. Für eine bereits registrierte Adresse erzeugt `registerNewUserAndSendActivationEmail` einen neuen Link (eine Woche gültig).
- Ohne `OVERLEAF_EMAIL_*` loggt Overleaf „Email transport and/or parameters not defined. No emails will be sent.“, die Admin-Test-Mail meldet trotzdem „E-Mail versendet“ (`email_sent`). „Passwort vergessen“ meldet ebenfalls, eine Mail sei gesendet.
- `Makefile`: `.env` wird mit `OVERLEAF_INVITE_TOKEN_SECRET` angelegt; `make start` holt das Image (seit P6) und startet; `make update` existiert. Variablen für Betrieb: `SPUR_URL`, `SPUR_PORT`, `OVERLEAF_SECURE_COOKIE`, `OVERLEAF_EMAIL_*`, `CROSSREF_MAILTO`, `UNPAYWALL_EMAIL`, optionale API-Schlüssel (README-Abschnitte seit P6).
- Recherche: spur hält je Dienst einen Mindestabstand zwischen Anfragen und meldet seit P6 je Dienst „geantwortet“, „gedrosselt“ oder „nicht_erreichbar“. Die Plugin-Anleitung (`SKILL.md`) sagt dazu nichts. OpenAlex ohne Schlüssel hat ein kleines Tagesbudget.
- TeX: Image mit TeX Live 2026 (`scheme-basic` plus Liste); `tlmgr` ist im Image, Repository ist ein CTAN-Spiegel. Claude schreibt über MCP nur Text (`doc_create` erlaubt `.tex .bib .txt .md`, höchstens 100 000 Zeichen) und nur als Track Change. Das TeX-Live-Archiv (`<spiegel>/systems/texlive/tlnet/archive/<paket>.tar.xz`) enthält fertige Laufzeitdateien je Paket (`tex/…`, `fonts/…`); `tlpkg/texlive.tlpdb` listet Abhängigkeiten. Der Compiler arbeitet im Projektordner mit latexmk.
- CI (`.github/workflows/ci.yml`): Jobs `test` (Stack aus Dev-Image, Unit, E2E, ~13 min) und `upstream` (Overleafs Suiten, ~15 min) bei jedem PR auf `spur`, beide Pflicht-Prüfungen in der Branch-Protection. `publish.yml` läuft per `workflow_dispatch` und bei Tags `v*`, Smoke folgt per `workflow_run`. GitHub hat den Owner auf Compute-Verschwendung hingewiesen.
### Grenzen
- Overleaf kennt nur `maxEntitiesPerProject` (Anzahl Dateien) und `MAX_UPLOAD_SIZE` (Größe je Upload); keine Projektzahl je Nutzer und keine Speicher-Grenze je Projekt.
- Projekte entstehen über „Neues Projekt“ (leer, Vorlage), Hochladen (ZIP), Kopieren, Übertragung der Eigentümerschaft und Zurückholen aus dem Papierkorb; archivierte und Papierkorb-Projekte bleiben Projekte des Nutzers.
- Speicher eines Projekts: hochgeladene Dateien (Filestore/History-Blobs), spur-Quellen (PDF, Scans, VTT, Webseiten-Schnappschüsse) und seit P7 TeX-Pakete unter `tex-pakete/`. Uploads kommen aus dem Editor (Datei hochladen, verknüpfte Datei), aus spur (Quellen) und über MCP (`source_add`, `tex_package_add`).
- Admin-Bereich: admin-tools aus overleaf-cep (Nutzerliste, Projektliste) und spur-Einstellungsseiten (z. B. Workflows unter `/spur/admin/…`).
- Die Einladungslinks (dieser Plan) ändern dieselben Admin-Seiten.
### PDFs vom Rechner, Image
- Quellen kommen heute auf zwei Wegen in spur: der Server lädt per DOI über Unpaywall (nur frei verfügbare, braucht `UNPAYWALL_EMAIL`, scheitert an Bot-Schutz wie Cloudflare mancher Verlage), oder eine Person lädt im Browser hoch (mit Zuordnung zur Beschaffungsliste per DOI). Claude Code läuft auf dem Rechner der Nutzer, lädt dort PDFs (auch mit Playwright), kann sie aber nicht zu spur bringen: MCP-Werkzeuge nehmen nur Text, und ein PDF als Base64 wäre im Kontext viel zu groß.
- Das Plugin (`plugins/spur`) hat bisher nur `.mcp.json` und die Anleitung `skills/spur/SKILL.md`; Plugins können Skripte mitbringen.
- Smoke nach P6: Das Folien-Testdokument scheitert, weil `chemformula` `xfrac.sty` lädt und das Paket `xfrac` nicht im Image ist; mit `tlmgr install xfrac` kompiliert es (im Container geprüft).

## Decisions
### Betrieb, Einrichtung, Pakete, CI (Owner, 2026-11-10)
Owner-Entscheidungen (2026-11-10):
- Einladungslink: Ist keine Mail eingerichtet, zeigt spur nach „Nutzer anlegen“ (Nutzerliste) und auf der Registrierseite den Link mit Kopierknopf und dem Hinweis „E-Mail ist nicht eingerichtet – gib den Link selbst weiter.“ (englisch sinngemäß). In der Nutzerliste gibt es je Konto die Aktion „Neuen Einladungslink erzeugen“. Ist Mail eingerichtet, bleibt das Verhalten wie bisher (Mail), der Link ist zusätzlich kopierbar. Die Registrierseite ist aus der Admin-Navigation erreichbar.
- Ehrliche Meldungen: Ohne Mail-Einrichtung meldet die Admin-Test-Mail „Keine E-Mail eingerichtet“ mit Verweis auf die README; „Passwort vergessen“ sagt, dass ein Admin einen neuen Link erzeugen kann. Mit Mail-Einrichtung bleiben die Texte wie bisher.
- `make setup`: interaktiv im Terminal; fragt Adresse (Vorgabe `http://localhost:8080`), ob Mail eingerichtet werden soll (dann Absender, SMTP-Host, Port, Nutzer, Passwort ohne Echo), Kontaktadresse für Crossref/Unpaywall (optional). Schreibt nur fehlende bzw. bestätigte Werte in `.env`, legt das Secret wie bisher an, ändert vorhandene Werte nur nach Rückfrage, zeigt Passwörter nie an, setzt bei `https://` `OVERLEAF_SECURE_COOKIE=true`. Danach startet es spur wie `make start`. Nicht interaktiv (kein TTY) bricht es mit einem Hinweis ab. `make start` bleibt ohne Fragen.
- Plugin-Anleitung: Meldet ein Dienst „gedrosselt“ oder „nicht_erreichbar“, macht Claude mit den Treffern der anderen Dienste weiter, fragt denselben Dienst nicht sofort erneut, nennt die Lücke in der Zusammenfassung und arbeitet bei „Quellen sammeln“ in Etappen. Englisch, mit humanizer geprüft.
- Pakete pro Projekt: neues MCP-Werkzeug `tex_package_add` (Argument: TeX-Live-Paketname). Der Server lädt das Paket aus dem TeX-Live-Archiv des Spiegels, den das Image nutzt (Fallback `https://mirror.ctan.org/systems/texlive/tlnet`); keine anderen Adressen. Er übernimmt nur Laufzeitdateien (`.sty .cls .def .cfg .fd .ldf .clo .bst .tex .lua` sowie Schriften `.pfb .tfm .vf .map .enc .otf .ttf`), legt sie im Projekt unter `tex-pakete/<paket>/` ab und sorgt dafür, dass der Compiler dort sucht (über eine `latexmkrc` im Projekt; ist das nicht möglich, im Projektordner). Ist ein Paket schon im Image, sagt das Werkzeug das und legt nichts an. Es meldet die Abhängigkeiten aus der Paketdatenbank, die noch fehlen, damit Claude sie nachholt. Grenzen: höchstens 20 MB je Paket, höchstens 50 MB in `tex-pakete/` je Projekt, 20 Aufrufe je Stunde und Nutzer. Die angelegten Dateien gehören zum Lauf: Lauf-Karte listet sie, „Lauf rückgängig“ entfernt sie. Admins schalten das Werkzeug unter den spur-Einstellungen bzw. mit `SPUR_TEX_PAKETE=aus` ab. Die Plugin-Anleitung beschreibt den Ablauf: Compile-Ergebnis lesen, bei „File `X.sty' not found“ das Paket bestimmen, `tex_package_add` aufrufen, neu kompilieren, Abhängigkeiten nachholen.
- CI sparsamer: `upstream` läuft nur, wenn sich Dateien unter `services/`, `libraries/`, `tools/tests/` oder Lockfiles ändern; sonst meldet ein gleichnamiger leichter Job Erfolg, damit die Pflicht-Prüfung erfüllt bleibt. `test` überspringt Stack und E2E bei reinen Doku-Änderungen (`*.md`, `docs/`) ebenso. Images und Caches werden zwischen Läufen wiederverwendet, wo es die Laufzeit messbar senkt. Publish läuft bei Tags `v*` (bleibt per Hand startbar); README beschreibt das Release mit Tag.
- Annahmen (ohne Rückfrage getroffen):
  - „Mail eingerichtet“ heißt: `OVERLEAF_EMAIL_FROM_ADDRESS` und ein Transport (`OVERLEAF_EMAIL_SMTP_HOST` oder SES) sind gesetzt.
  - Tests nutzen für das TeX-Live-Archiv einen lokalen Fake (Schalter wie `SPUR_PAPER_API_BASE`), mit einem kleinen echten Paket als Fixture; ein echter Compile mit einem so hinzugefügten Paket (z. B. ein Beamer-Theme, das nicht im Image ist) läuft im E2E gegen den Fake.
  - Die Anpassungen an admin-tools sind Kern-Patches an Overleaf-Code; sie kommen in die Liste der Kern-Patches (ADR) mit Begründung.
  - Bestehende Fehlercodes bleiben; neue Meldungen in beiden Sprachdateien, deutsch geduzt.
  - Die CI-Änderungen werden an einem PR-Lauf belegt (Laufzeit vorher/nachher); bis dahin gilt die lokale Prüfung der Workflow-Dateien mit actionlint, falls vorhanden.
### Grenzen (Owner, 2026-11-10)
Owner-Entscheidungen (2026-11-10):
- Projekt-Grenze: zählt alle Projekte, deren Eigentümer der Nutzer ist, auch archivierte und solche im Papierkorb; nur endgültig gelöschte nicht. Geteilte Projekte anderer zählen nicht. Bei Erreichen sind Neues Projekt (leer, Vorlage), Hochladen als Projekt, Kopieren und das Annehmen einer Eigentümer-Übertragung gesperrt, mit Meldung wie „Du hast 10 von 10 Projekten. Lösche ein Projekt endgültig oder frag deinen Admin.“
- Speicher-Grenze: zählt hochgeladene Dateien, spur-Quellen und TeX-Pakete des Projekts; nicht den Versionsverlauf und nicht die Compile-Ausgabe. Bei Erreichen sind weitere Uploads gesperrt (Editor, Quellen, verknüpfte Dateien, MCP `source_add`, `tex_package_add`), Schreiben im Editor geht weiter. Meldung nennt Stand und Grenze, z. B. „Dieses Projekt nutzt 1,02 GB von 1 GB. Lösche Dateien oder Quellen oder frag deinen Admin.“
- Einstellung: im Admin-Bereich ein Standard für alle (Projekte je Nutzer, GB je Projekt; leer = unbegrenzt) und je Nutzer eine Ausnahme (beide Werte, leer = Standard, 0 bzw. „unbegrenzt“ ausdrücklich wählbar). Die Ausnahme je Nutzer gilt für die Speicher-Grenze aller Projekte, deren Eigentümer er ist.
- Übersicht im Admin-Bereich: Tabelle Nutzer mit Projektzahl/Grenze, Tabelle Projekte mit Speicher/Grenze und Eigentümer, sortierbar, mit Markierung ab 80 % und bei Überschreitung.
- Annahmen (ohne Rückfrage getroffen):
  - Standard nach dem Update: unbegrenzt (keine bestehende Installation wird plötzlich gesperrt). Wer schon über einer neuen Grenze liegt, verliert nichts; nur Neues wird gesperrt.
  - Die Grenzen gelten auch für Admins; sie können sich selbst eine Ausnahme setzen.
  - Der Speicherstand eines Projekts wird bei jedem Upload und Löschen fortgeschrieben und kann im Admin-Bereich neu berechnet werden; die Prüfung vor einem Upload nutzt die Größe des Uploads.
  - Nutzer sehen ihren Stand: in der Projektliste „x von y Projekten“, im Editor (Dateibaum oder Quellen-Panel) „x GB von y GB“, nur wenn eine Grenze gesetzt ist.
  - MCP-Fehler haben feste Codes `projekte_voll` und `speicher_voll`; Texte in beiden Sprachdateien, deutsch geduzt.
  - Kern-Patches an Overleaf-Code kommen mit Begründung in die ADR-Liste.
### PDFs vom Rechner, Image (Owner, 2026-11-10)
- Hochladen vom Rechner: neues MCP-Werkzeug `source_upload_link` liefert einen Einmal-Link für das Projekt und das Konto, gültig 15 Minuten, für bis zu 50 Dateien, je Datei höchstens so groß wie ein Upload im Browser. Die Dateien gehen per HTTP direkt an spur (z. B. `curl -F datei=@paper.pdf -F doi=… -F titel=… <link>`), nicht über MCP. spur legt jede Datei an wie einen Upload im Browser (Volltext, OCR bei Scans), ordnet sie per DOI (Angabe oder aus dem PDF) einem Eintrag der Beschaffungsliste zu oder legt eine neue Quelle an, erkennt Duplikate und meldet sie statt sie doppelt anzulegen, und antwortet je Datei mit Quellen-ID oder Grund. Die neuen Quellen erscheinen in der Lauf-Karte und lassen sich mit „Lauf rückgängig“ entfernen. Ein abgelaufener oder verbrauchter Link liefert eine klare Meldung. Grenzen aus dem Speicher-Feature gelten.
- Plugin-Skripte: das Plugin bringt zwei Skripte mit, die Claude im Terminal aufruft (bash und curl, macOS und Linux): `spur-pdf-holen <DOI> [ziel]` lädt ein PDF auf dem Rechner der Nutzer aus legalen freien Quellen (Unpaywall-OA-Link, arXiv, PubMed Central, frei verfügbare Verlagslinks), prüft, dass es ein PDF ist, und meldet sonst den Grund; `spur-hochladen <link> <datei>… [--doi …] [--titel …]` lädt Dateien über den Einmal-Link hoch und gibt das Ergebnis je Datei aus. Die Anleitung (SKILL.md) beschreibt den Ablauf: Quelle nicht frei oder vom Server geblockt → `spur-pdf-holen` → bei Login oder Bot-Schutz Playwright, wenn eingerichtet (Logins macht der Mensch) → `source_upload_link` → `spur-hochladen` → zitieren. Keine Umgehung von Bezahlschranken oder Zugangssperren.
- Image: `xfrac` kommt in die Paketliste; der Smoke-Test mit dem Folien-Dokument ist danach grün.

## Access
Alle optional, Tests nutzen Fakes: `CROSSREF_MAILTO`, `UNPAYWALL_EMAIL`, `OPENALEX_API_KEY`, `SEMANTIC_SCHOLAR_API_KEY`, `OVERLEAF_EMAIL_*`.

## Quality bar
- Web: Tastatur, sichtbarer Fokus, Kontrast mindestens 4,5:1, Klickziele mindestens 24 × 24 px, kein horizontales Rollen bei 360 px, keine Konsolenfehler, keine nativen `alert`/`confirm`/`prompt`.
- Sicherheit: Einladungslinks nur für Admins sichtbar; `tex_package_add` lädt nur vom festen Spiegel, prüft Pfade beim Entpacken (keine `..`, keine absoluten Pfade, keine Links), Größengrenzen vor und nach dem Entpacken; `make setup` gibt Passwörter nie aus und legt `.env` mit Rechten 600 an.
- Fehlermeldungen sagen, was passiert ist und was zu tun ist.
- Texte: deutsch geduzt mit humanizer-de, englisch und README mit humanizer geprüft.
- Grenzen werden serverseitig geprüft; gleichzeitige Uploads können eine Grenze nicht gemeinsam überschreiten.
- Upload-Links: nur mit gültigem, unverbrauchtem Token; kein Zugriff auf andere Projekte; Dateityp und Größe werden serverseitig geprüft.

### Tests (TDD)
- Jede Änderung beginnt mit einem roten Test (Unit, Frontend, Werkzeugtests unter `tools/tests` für Makefile, Setup, CI-Dateien und Plugin-Skripte).
- E2E bekommt `p7f1` bis `p7f14` und läuft nach dem Zurücksetzen der Testdaten vollständig grün, auch alle älteren Features.
- Overleafs eigene Suiten bleiben grün bis auf die bekannte Upstream-Liste.
