Type: web, api

# spur P6: Befunde aus der ersten echten Claude-Session

## Zweck
Nach dem Merge von P1 bis P5 hat der Owner spur nach README installiert und mit einer echten Claude-Code-Session getestet. Dieser Plan behebt, was dabei nicht funktioniert hat oder in die Irre führte. Alle Inhalte sind entschieden; der Lauf stellt keine Rückfragen zu ihnen.

## Nutzer
Forschende, die mit ihrem eigenen Claude Code in spur arbeiten (Chat, @claude, Recherche, Quellen, Prüfbericht), und Betreiber, die spur nach README installieren und aktualisieren, auch hinter einem Firmen-Proxy.

## Was Nutzer danach können
- Claude Code mit dem Startbefehl starten, und Claude wartet sofort auf Aufträge; das Panel zeigt „Claude verbunden“, ohne dass man Claude erst darum bitten muss.
- Mit @claude in einem Kommentar Claude auf genau die markierte Stelle ansetzen, auch in einem Dokument, das gerade offen ist; @claude erscheint im Kommentar hervorgehoben.
- Quellen per DOI aufnehmen und Referenzen prüfen lassen, auch wenn Crossref kurz drosselt; ein Ausfall heißt „nicht prüfbar“, nie „unbekannt“.
- Literatur über alle vier Dienste suchen und Zitationen folgen, ohne API-Schlüssel; Schlüssel heben nur die Limits.
- Im Prüfbericht sehen, welche Zitierstellen geprüft sind und warum die anderen nicht.
- Zahlen prüfen lassen, ohne dass TikZ-Koordinaten oder Farbangaben gemeldet werden.
- Deutsche Dokumente mit Silbentrennung, Chemie- und Einheitenpaketen und das Beamer-Theme metropolis kompilieren.
- spur mit `make start` bzw. `make update` aktuell halten und E-Mail, Recherche-Dienste und Firmen-Proxy nach README einrichten.

## Context
- Status „verbunden“ im Claude-Panel: Herzschlag, den `wait_for_event` schreibt. Der Startbefehl (Token-Dialog und Panel, eine gemeinsame Funktion) startet nur `claude --allowedTools "…"`; Claude wartet erst, wenn man es darum bittet. Claude Code nimmt einen Prompt als Argument an (`claude [options] [prompt]`) und startet damit interaktiv.
- @claude: Die Stelle zum Kommentar wird in den Ranges des Docstores gesucht (20 Versuche à 500 ms). Ein offenes Dokument liegt im document-updater und ist oft noch nicht in Mongo geschrieben; dann gehen Dokument, Pfad und Stelle leer an Claude. Echter Fall: Claude antwortete „Dokument, Pfad und Textstelle sind alle leer“.
- Crossref: Ein Fehlschlag (auch 429) sperrt die DOI 5 Minuten im Speicher; in der Zeit ist das Werk `null`, die Bewertung macht daraus „unbekannt“. Keine Wiederholung bei 429. `CROSSREF_MAILTO` wird schon angehängt, steht aber nicht in der README. Echter Fall: DOI 10.3390/foods11223570 als „unbekannt“, obwohl Crossref sie liefert.
- Recherche-Dienste: OpenAlex und Semantic Scholar gelten ohne `OPENALEX_API_KEY` bzw. `SEMANTIC_SCHOLAR_API_KEY` als aus. OpenAlex antwortet ohne Schlüssel mit 200, Semantic Scholar ohne Schlüssel mit gemeinsamem Kontingent (429 möglich). `paper_citations` läuft nur über diese beiden und gibt dann still leere Listen zurück.
- Aufnahme per DOI: ohne `UNPAYWALL_EMAIL` Abbruch mit „Unpaywall nicht eingerichtet“.
- Zahlenprüfung: Heuristik für Zahlen ohne Beleg aus `ergebnisse.tex`; Mathe wird ganz entfernt, Befehlsargumente nur für eine feste Liste. Echter Fall: gemeldet wurden TikZ-Koordinaten, Farbanteile und Optionen wie `[aspectratio=169,11pt]`; nicht gemeldet Rechenwerte wie 0,89 L oder 75,7 in Formeln.
- Prüfbericht: Die Statistik „geprüft“ zählt neu geprüfte Abschnitte (der Rest kommt aus dem Cache), nicht Zitierstellen. Echter Fall: 7 Zitierstellen, „1 geprüft“.
- Image: TeX Live `scheme-basic` plus kurze Liste. Es fehlen u. a. `babel-german` (ngerman.ldf), `hyphen-german`, `mhchem`, `siunitx`, `chemformula`, `beamertheme-metropolis`, `pgfopts`. Smoke kompiliert bisher nur ein APA-Dokument.
- `make start` = `docker compose up -d --wait`; ein lokal vorhandenes `:latest` wird nie aktualisiert. Echter Fall: Nach dem Release startete das alte, kaputte Image.
- Hinter einem TLS-aufbrechenden Proxy (Zscaler) erreicht der Container keinen Dienst (curl Code 60); mit `NODE_EXTRA_CA_CERTS` über eine `docker-compose.override.yml` geht es. Die README nennt weder das noch E-Mail (`OVERLEAF_EMAIL_*`), `UNPAYWALL_EMAIL`, `CROSSREF_MAILTO` oder die Schlüssel.
- D7: In der Blätterleiste des Quellen-Panels sitzt „Zurück“ bei 1280 px 4–5 px höher als die anderen Knöpfe.

## Decisions
Owner-Entscheidungen (2026-11-10):
- Alle Befunde der Session in einem Plan, lokal gebaut, danach ein PR.
- Startbefehl: hängt einen Prompt an, der Claude sofort `wait_for_event` aufrufen lässt; derselbe Befehl im Token-Dialog (Schritt 3) und im Claude-Panel. Der Panel-Text beschreibt, was passiert.
- @claude: Claude bekommt Dokument, Pfad und markierte Stelle auch für offene Dokumente. @claude erscheint in Kommentaren hervorgehoben (blau, wie ein Link oder eine Erwähnung); beim Schreiben eines Kommentars mit @claude zeigt das Feld den Hinweis „Claude wird benachrichtigt“ (englisch „Claude will be notified“).
- Crossref: Bei 429 und 503 wartet spur (Retry-After, sonst steigende Pause) und versucht es erneut, begrenzt auf wenige Versuche. Ist Crossref nicht erreichbar, heißt der Zustand im Prüfbericht „nicht prüfbar – Crossref gerade nicht erreichbar“, nie „unbekannt“; „unbekannt“ nur, wenn Crossref die DOI wirklich nicht kennt (404). Fehlermeldungen beim Aufnehmen sagen, dass Crossref gerade nicht antwortet und ein späterer Versuch hilft.
- Recherche: OpenAlex und Semantic Scholar laufen ohne Schlüssel; Schlüssel sind optional und heben die Limits. `paper_search` und `paper_citations` sagen in der Antwort, welche Dienste geantwortet haben und welche nicht (mit Grund, z. B. gedrosselt, nicht erreichbar); eine leere Liste ohne diesen Hinweis gibt es nicht mehr.
- Unpaywall: Fehlt `UNPAYWALL_EMAIL`, nutzt spur `CROSSREF_MAILTO`. Fehlen beide, nennt die Meldung beide Variablen und verweist auf die README.
- Zahlenprüfung: nicht melden: Inhalte von `tikzpicture`, `axis` und anderen pgfplots-Umgebungen, Farbangaben (`red!30`, `\definecolor`, `\color{…}`), optionale Argumente in eckigen Klammern, `.bib`-Dateien. Melden: Dezimalzahlen und Zahlen ab drei Stellen in Formeln sowie Werte in `\num`, `\qty`, `\SI` und `\SIrange`, wenn sie nicht aus `ergebnisse.tex` stammen. Einzelne Ganzzahlen bis zwei Stellen in Formeln (Exponenten, Indizes) zählen nicht.
- Prüfbericht: zählt Zitierstellen nach Status (geprüft, nicht prüfbar, ohne Quelle, …) und nennt je nicht geprüfter Stelle den Grund, z. B. „keine Quelle aufgenommen“, „Crossref gerade nicht erreichbar“, „Seitenangabe fehlt“. Der Cache von Abschnitten erscheint nicht als „geprüft“. Gilt für die Ansicht und für `check_report` über MCP.
- TeX-Pakete fest ins Image: babel-german, hyphen-german, mhchem, siunitx, chemformula, beamertheme-metropolis, pgfopts (mit Abhängigkeiten). Der Smoke-Test kompiliert zusätzlich ein Dokument, das sie nutzt (ngerman, `\ce`, `\qty`, metropolis).
- Betrieb: `make start` holt vorher das aktuelle Image; neues Ziel `make update` (holen, neu starten, Hinweis auf Backup). README bekommt Abschnitte: E-Mail (`OVERLEAF_EMAIL_FROM_ADDRESS`, `OVERLEAF_EMAIL_SMTP_HOST`, `_PORT`, `_USER`, `_PASS`; ohne sie gehen keine Mails raus, auch wenn die Admin-Seite „versendet“ meldet), Recherche-Dienste (`CROSSREF_MAILTO`, `UNPAYWALL_EMAIL`, optional `OPENALEX_API_KEY`, `SEMANTIC_SCHOLAR_API_KEY`), Update, Betrieb hinter einem Firmen-Proxy (Zertifikat als `.crt`, `NODE_EXTRA_CA_CERTS` per `docker-compose.override.yml`, mit Beispiel). Englisch, mit humanizer geprüft.
- D7: „Zurück“ sitzt in der Blätterleiste auf derselben Linie wie die anderen Knöpfe (gleiche Oberkante und Höhe).
- Annahmen (ohne Rückfrage getroffen):
  - Recherche-Dienste, Crossref und Claude laufen im Test mit den vorhandenen Fakes (`SPUR_PAPER_API_BASE`, `SPUR_FAKE_AGENT`). Der Fake bekommt Schalter, mit denen er 429 (mit Retry-After), 503 oder Nichterreichbarkeit simuliert, je DOI bzw. je Dienst.
  - Der Prompt im Startbefehl ist kurz, deutsch bzw. englisch je Installationssprache, und nennt `wait_for_event`. Ob Claude Code ihn so annimmt, prüft der Lauf mit `claude --help`; der echte Start ist Handprüfung nach dem Merge.
  - Die Stelle für @claude kommt aus dem document-updater, wenn das Dokument dort geladen ist, sonst aus dem Docstore.
  - Die TeX-Pakete können lokal nicht im Image geprüft werden (Firmen-Proxy blockiert den Image-Bau); der Beleg ist der erweiterte Smoke-Test nach dem Merge. Lokal prüft ein Test, dass die Paketliste und das Smoke-Dokument zusammenpassen.
  - Bestehende Fehlercodes bleiben; neue Meldungen kommen in beide Sprachdateien, deutsch geduzt.

## Access
Alle optional, Tests nutzen Fakes: `CROSSREF_MAILTO`, `UNPAYWALL_EMAIL`, `OPENALEX_API_KEY`, `SEMANTIC_SCHOLAR_API_KEY`.

## Quality bar
- Web: alles per Tastatur bedienbar mit sichtbarem Fokus; Kontrast mindestens 4,5:1 (auch @claude-Hervorhebung, hell und dunkel); Klickziele mindestens 24 × 24 px; kein horizontales Rollen bei 360 px; keine Konsolenfehler; keine nativen `alert`/`confirm`/`prompt`.
- Fehlermeldungen sagen, was passiert ist und was zu tun ist; Ausfälle externer Dienste werden nie als Befund über die Arbeit der Nutzer ausgegeben.
- API und MCP: Fehlercodes stabil; neue Zustände und Hinweise haben feste Schlüssel.
- Texte: deutsch geduzt, mit humanizer-de geprüft; englische Texte und README mit humanizer geprüft.

### Tests (TDD)
- Jede Änderung an Server- oder Frontend-Logik beginnt mit einem roten Test.
- Unit-Tests für: Retry bei 429/503 mit Retry-After, Zustand „nicht prüfbar“ statt „unbekannt“, Dienste ohne Schlüssel aktiv, Hinweis auf nicht antwortende Dienste, Unpaywall-Rückfall, jede Regel der Zahlenprüfung mit Positiv- und Negativbeispiel (die echten Fälle aus dem Kontext eingeschlossen), Zählung im Prüfbericht, Stelle für @claude aus dem document-updater.
- Ein Test prüft, dass jedes Paket, das das Smoke-Dokument lädt, in der Paketliste des Images steht.
- Die E2E-Suite bekommt `p6f1` bis `p6f11` und läuft nach dem Zurücksetzen der Testdaten vollständig grün, auch alle älteren Features.
- Overleafs eigene Suiten bleiben grün bis auf die bekannte Upstream-Liste.
