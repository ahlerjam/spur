Type: web, api, cli

# spur P7: Betrieb ohne Mail, Einrichtung, Pakete pro Projekt, sparsame CI

## Zweck
Beim ersten Betrieb auf einem Server (spur.ahler.org) zeigte sich: Ohne eingerichtete Mail kommen Admins nicht an Einladungslinks, die Admin-Seite meldet „E-Mail versendet“, obwohl nichts rausgeht, die Ersteinrichtung verlangt Handarbeit in der `.env`, Claude kann fehlende LaTeX-Pakete oder Themes nicht ins Projekt holen, und die CI verbraucht viele GitHub-Minuten. Dieser Plan behebt das. Alle Inhalte sind vom Owner entschieden; der Lauf stellt keine Rückfragen zu ihnen.

## Nutzer
Admins und Betreiber einer spur-Installation; Forschende, die mit Claude in spur schreiben; der Owner, der die CI bezahlt.

## Was Nutzer danach können
- Als Admin ein Konto anlegen und den Einladungslink sofort kopieren und selbst weitergeben, wenn keine Mail eingerichtet ist, auch für bestehende Konten einen neuen Link erzeugen.
- Sehen, ob spur Mails verschicken kann, statt einer falschen Erfolgsmeldung.
- spur beim ersten Start mit `make setup` einrichten: Adresse, Mail (optional), Kontaktadresse für Crossref und Unpaywall.
- Claude ein fehlendes LaTeX-Paket oder Beamer-Theme ins Projekt holen lassen, ohne dass der Server neue TeX-Pakete oder Images braucht.
- Sich darauf verlassen, dass Claude bei gedrosselten Recherche-Diensten sinnvoll weiterarbeitet.
- PRs mit weniger CI-Laufzeit prüfen lassen.

## Context
- Admin-Nutzerverwaltung (Modul admin-tools aus overleaf-cep): „Nutzer anlegen“ erzeugt einen Aktivierungslink und schickt ihn nur per Mail; die Antwort enthält ihn nicht. Die Registrierseite `/admin/register` (Modul user-activate) zeigt den Link in einer Tabelle an, ist aber im Menü kaum zu finden. Für eine bereits registrierte Adresse erzeugt `registerNewUserAndSendActivationEmail` einen neuen Link (eine Woche gültig).
- Ohne `OVERLEAF_EMAIL_*` loggt Overleaf „Email transport and/or parameters not defined. No emails will be sent.“, die Admin-Test-Mail meldet trotzdem „E-Mail versendet“ (`email_sent`). „Passwort vergessen“ meldet ebenfalls, eine Mail sei gesendet.
- `Makefile`: `.env` wird mit `OVERLEAF_INVITE_TOKEN_SECRET` angelegt; `make start` holt das Image (seit P6) und startet; `make update` existiert. Variablen für Betrieb: `SPUR_URL`, `SPUR_PORT`, `OVERLEAF_SECURE_COOKIE`, `OVERLEAF_EMAIL_*`, `CROSSREF_MAILTO`, `UNPAYWALL_EMAIL`, optionale API-Schlüssel (README-Abschnitte seit P6).
- Recherche: spur hält je Dienst einen Mindestabstand zwischen Anfragen und meldet seit P6 je Dienst „geantwortet“, „gedrosselt“ oder „nicht_erreichbar“. Die Plugin-Anleitung (`SKILL.md`) sagt dazu nichts. OpenAlex ohne Schlüssel hat ein kleines Tagesbudget.
- TeX: Image mit TeX Live 2026 (`scheme-basic` plus Liste); `tlmgr` ist im Image, Repository ist ein CTAN-Spiegel. Claude schreibt über MCP nur Text (`doc_create` erlaubt `.tex .bib .txt .md`, höchstens 100 000 Zeichen) und nur als Track Change. Das TeX-Live-Archiv (`<spiegel>/systems/texlive/tlnet/archive/<paket>.tar.xz`) enthält fertige Laufzeitdateien je Paket (`tex/…`, `fonts/…`); `tlpkg/texlive.tlpdb` listet Abhängigkeiten. Der Compiler arbeitet im Projektordner mit latexmk.
- CI (`.github/workflows/ci.yml`): Jobs `test` (Stack aus Dev-Image, Unit, E2E, ~13 min) und `upstream` (Overleafs Suiten, ~15 min) bei jedem PR auf `spur`, beide Pflicht-Prüfungen in der Branch-Protection. `publish.yml` läuft per `workflow_dispatch` und bei Tags `v*`, Smoke folgt per `workflow_run`. GitHub hat den Owner auf Compute-Verschwendung hingewiesen.

## Decisions
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

## Quality bar
- Web: Tastatur, sichtbarer Fokus, Kontrast mindestens 4,5:1, Klickziele mindestens 24 × 24 px, kein horizontales Rollen bei 360 px, keine Konsolenfehler, keine nativen `alert`/`confirm`/`prompt`.
- Sicherheit: Einladungslinks nur für Admins sichtbar; `tex_package_add` lädt nur vom festen Spiegel, prüft Pfade beim Entpacken (keine `..`, keine absoluten Pfade, keine Links), Größengrenzen vor und nach dem Entpacken; `make setup` gibt Passwörter nie aus und legt `.env` mit Rechten 600 an.
- Fehlermeldungen sagen, was passiert ist und was zu tun ist.
- Texte: deutsch geduzt mit humanizer-de, englisch und README mit humanizer geprüft.

### Tests (TDD)
- Jede Änderung beginnt mit einem roten Test (Unit, Frontend, Werkzeugtests unter `tools/tests` für Makefile/Setup und CI-Dateien).
- E2E bekommt `p7f1` bis `p7f6` und läuft nach dem Zurücksetzen der Testdaten vollständig grün, auch alle älteren Features.
- Overleafs eigene Suiten bleiben grün bis auf die bekannte Upstream-Liste.
