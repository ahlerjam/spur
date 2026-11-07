Type: web, api

# spur P1: Kern

## Zweck
spur ist eine selbst gehostete Schreibumgebung für wissenschaftliche Arbeiten auf Basis von overleaf-cep. Forschende verwalten Quellen im Editor, fügen Zitate per Knopf ein und sehen in einem Prüfbericht, ob Wortlaut, Seite und Referenz stimmen und ob die Arbeit zurückgezogen wurde. Das eigene Claude Code schreibt mit, ohne Zitate erfinden zu können.

## Nutzer
Forschende und Studierende, allein oder im kleinen Team. Betreiber installieren spur per README auf eigener Hardware.

## Was Nutzer können
- spur nach README mit einem Befehl starten.
- Pro Projekt PDFs mit Text und Transkripte hochladen, durchsuchen, ansehen, exportieren und aus anderen Projekten holen.
- Zitate in Quellen markieren und per Knopf ins Dokument einfügen, wobei die Referenz automatisch entsteht.
- Einen projektweiten Prüfbericht und Markierungen im Editor sehen.
- Ihr Claude Code verbinden und Aufträge aus dem Browser oder Terminal geben.
- Claudes Arbeit als Track Changes auf einer Lauf-Karte annehmen, ablehnen oder zurücknehmen.

## Zustände der Oberfläche
- Quellen-Panel: leer („Noch keine Quellen“), lädt, Fehler mit Grund, sehr viele Quellen (300), Quelle ohne Text.
- Prüfbericht: leer („Keine Zitate gefunden“), läuft, Fehler, lange Liste mit Filter.
- Claude-Status: „Claude nicht verbunden“ samt Startbefehl, „Claude verbunden“.
- Lauf-Karte: läuft, fertig, rote Befunde, abgelehnt, zurückgenommen, Datei gelöscht.

## Decisions
- Architektur und Schnittstelle stehen in `docs/adr/0001` bis `0005` und `docs/mcp-vertrag.md`. Diese Dokumente sind verbindlich.
- Basis ist overleaf-cep auf dem Branch `spur`. Kern-Patches bleiben minimal.
- Oberfläche nur mit `ol-*`- und `ds-*`-Bausteinen, Einstieg über `railEntries`, Sprachen Englisch und Deutsch über die vorhandenen Sprachdateien, Sprache pro Installation.
- Compile: spur-Image enthält `biblatex`, `biber`, `biblatex-apa`, `csquotes`, `natbib`, `beamer`, `latexdiff`. Die Sandbox ist eine Zusatzdatei und für öffentlichen Betrieb Pflicht.
- `OVERLEAF_HISTORY_RESTORE=true` ist von Anfang an gesetzt.
- Bot: je Mensch ein echter Nutzer „Claude (Name)“ ohne Passwort und ohne Projektmitgliedschaft, angelegt mit dem ersten Token.
- Rollen: `read` nur lesen. `review` schreibt Track Changes, darf nicht annehmen, keine Automatik, lehnt nur Changes des eigenen Bots ab. `write` und `owner` dürfen alles. Annehmen verlangt Schreibrecht, das Ereignis geht erst nach Erfolg raus.
- Automatisch annehmen ist die Sammelannahme am Laufende, nur ohne rote Status, und nur per Browser-Session schaltbar.
- Prüfung: Wortlaut exakt oder mit Trennungstoleranz, dazu Normalisierung NFC, Ligaturen, Klassen für Anführungszeichen, Bindestriche und Leerraum. `[…]`, `\textelp`, `[sic]` und `[e]rschöpft` werden erkannt, Auslassungen segmentweise geprüft. U+FFFD oder fehlender Text ergibt „nicht prüfbar“.
- Seite: Versatz je Quelle aus PageLabels innerhalb der Crossref-Spanne oder von Menschen bestätigt, sonst „Seite nicht prüfbar“. Das führt nie zur Abweisung.
- Zuordnung Beleg zu Quelle: erst DOI aus dem `.bib`, dann Key.
- Erkannte Formen in P1: `\cite`, `\autocite`, `\parencite`, `\textcite`, `\footcite`, `\citep`, `\citet`, `\enquote`, `\textquote`, `\textcquote`, `\blockquote`, `quote`-Umgebung, „…“. Alles andere ist „nicht prüfbar“.
- Claude: `\enquote` mit Beleg ohne Quelltext wird mit `quelle_fehlt` abgewiesen. Geprüft wird der Ergebnistext am Kopfstand, nur Zitate im berührten Bereich.
- Handänderungen erzeugen Warnungen. Kompilieren wird nie blockiert.
- Text je Seite als eigenes Mongo-Dokument. Extraktion mit `pdftotext`.
- Retraction: Crossref `updated-by` mit Tagescache. Keine Meldung heißt „keine Meldung in Crossref“. `correction` wird als Hinweis gezeigt.
- Quellen: PDFs nur für Mitglieder herunterladbar, Nutzer mit Edit-Link standardmäßig nicht. Upload bis 50 MB.
- Keine Sonderregeln für Interviews. Die README sagt, dass Inhalte, die Claude liest, an Anthropic gehen und die Verantwortung beim Nutzer liegt.
- Token: 90 Tage, widerrufbar, Hash in `oauthAccessTokens`, Aufräumen über `expireDeletedUser`. Ablauf zeigt spur im Browser an.
- Zeiten in UTC, Anzeige lokal.
- Änderungen an der Mongo-Struktur laufen über `tools/migrations` mit `down`. `SPUR_*`-Testschalter sind im Produktivbetrieb wirkungslos.
- Weckweg: Long-Poll-Tool `wait_for_event` mit Fortschritt alle 30 Sekunden, in Lauf 0 mit echtem Claude Code belegt (siehe ADR 0003). Laufende Aufrufe sind der Herzschlag für „Claude verbunden“.
- `make start` erzeugt beim ersten Start ein `.env` mit `OVERLEAF_INVITE_TOKEN_SECRET`; ohne dieses Secret startet der Container nicht.

## Testbarkeit
- Builder nutzen ausschließlich `spur-dev` (siehe `CLAUDE.md`): `up`, `reload` (etwa 50 Sekunden, ohne Netz), `restart`, `test`, `user`, `logs`. Der Stack läuft auf `http://localhost:8080`.
- Neue npm-Pakete sind in einem Lauf ein Stoppgrund. Sie brauchen vorher einen Lauf des Workflows `Dev image`. Vor P1 müssen die benötigten Pakete, vor allem `@modelcontextprotocol/sdk` und `@modelcontextprotocol/express`, im Lockfile stehen und `@lezer/common` und `@lezer/lr` unter `dependencies` liegen.
- Für Betreiber gilt: `make start` startet mit dem veröffentlichten Image, `make test` die Unit-Tests, `make e2e` Playwright gegen den Stack, `make seed` legt Demo-Daten an.
- Testschalter stehen bei `SPUR_DEV=1` in der gitignorierten Datei `services/web/modules/spur/dev-schalter.json`: `SPUR_FAKE_AGENT=1`, `SPUR_NOW`, `SPUR_PAPER_API_BASE`. Der Crossref-Fake läuft hinter `SPUR_DEV` als Route im Modul, mit aufgezeichneten Antworten. Ohne `SPUR_DEV` existieren weder Schalter noch Route.
- Der Fake-Client ist ein Skript im Repo unter `services/web/modules/spur/test`, das per HTTP gegen `http://localhost:8080/spur/mcp` arbeitet.
- Weitere Befehle: `spur-dev run <skript>`, `spur-dev mongo <ausdruck>`, `spur-dev dump`, `spur-dev restore`, `spur-dev migrate <args>`, `spur-dev logs <dienst> <zeilen>`.
- Das Dev-Image enthält Entwicklungspakete und verdeckt damit Fehlendes im Produktions-Image. Der Workflow `Smoke` prüft deshalb das echte Image.
- Kein Schritt braucht ein echtes Claude. Das Plugin prüft `claude plugin validate`, der Smoke-Test läuft je Meilenstein von Hand.
- Fixtures: `smith2024.pdf` (DOI `10.5555/spur.2024.001`, Seiten 345 bis 352, Seite 347 ist PDF-Seite 3, Satz „Sleep supports the consolidation of declarative memory.“), `retracted.pdf` (DOI `10.5555/spur.retracted`), `scan.pdf` ohne Text, `interview.vtt`.

## Bekannt aus Lauf 0
- Beide Architekturen bauen in GitHub Actions in etwa 7 Minuten, Image 3,56 GB, `biber 2.22` läuft auf arm64.
- Lokaler Build hinter Zscaler geht nicht; gebaut wird in der CI.
- Der amd64-Build scheiterte zweimal an der Git-Abhängigkeit `codemirror-indentation-markers`, beim dritten Versuch lief er. Der Veröffentlichungs-Workflow braucht deshalb Wiederholungen.
- `create-user.mjs` gibt den Link mit Steuerzeichen aus; Skripte filtern `token=…&user_id=…`.

## Access
- `CROSSREF_MAILTO`

## Quality bar
- WCAG 2.2 AA Grundlagen: alles per Tastatur, sichtbarer Fokus, Kontrast 4.5:1, Fehler in Text.
- Fokus landet nach Speichern, Löschen oder Schließen an einer sinnvollen Stelle.
- Jede Ansicht hat Leer-, Lade- und Fehlerzustand. Keine Konsolenfehler, kein horizontaler Scroll bei 360 px.
- Keine nativen `alert`, `confirm`, `prompt`.
- Oberfläche wirkt wie Overleaf: gleiche Bausteine, Abstände und Wörter (siehe `taste`).
- Fehlermeldungen sagen, was passiert ist und was zu tun ist.
- API: Fehler als RFC 9457, Listen paginiert, Rechte bei jedem Aufruf für das konkrete Objekt geprüft, `doc_edit` idempotent.
- Keine Secrets in Code und Logs.
- Testartefakte und Skripte landen nicht im Repo außerhalb der Testordner.
