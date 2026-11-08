# Fortschritt 20261106-spur-p2-recherche

## Needs decision
- f6: Mit welchem Werkzeug füllt Claude eine Matrixzelle als Vorschlag? `docs/mcp-vertrag.md` nennt für P2 keines, `suggest` gehört zu P3.
  Interim: neues Werkzeug `matrix_suggest` (Projekt, Quelle, Spalte, Text). Es legt nur einen Vorschlag an, den die Person in der Matrix bestätigt. Im Vertrag ist es als P2-Ergänzung eingetragen.
  Options: A (empfohlen): `matrix_suggest` behalten und später in `suggest` (P3) aufgehen lassen | B: sofort ein allgemeines `suggest` mit Ziel „matrix“

## Recipe changes
- Das Setup-Skript der Cloud-Umgebung (`tools/spur-dev/cloud-setup.sh`) war in dieser Session nicht gelaufen: kein `spur-dev`, kein Docker-Daemon. Der Builder hat die Schritte des Skripts selbst ausgeführt: `dockerd` gestartet, `bash tools/spur-dev/spur-dev install --cloud` aus dem unveränderten Worktree, die drei Images gezogen.
- Das run-code-Werkzeug von Playwright bricht nach 60 s ab und kann die ganze E2E-Datei nicht ausführen. In dieser VM startet Chromium aus der Bash. Der Builder führt `spur-e2e.js` deshalb mit einem Läufer im Scratchpad aus, der wie `test/e2e/run.mjs` arbeitet, Playwright aber aus `/opt/node-tools` lädt.

## Menschlich zu prüfen
- Cloud-Umgebung: Warum ist das Setup-Skript nicht gelaufen (Umgebungs-Cache)?
- f10 mit echtem Modell (laut Spec ein Handtest außerhalb der Sandbox): `SPUR_SEMANTIC_SEARCH=true` ohne `SPUR_FAKE_EMBEDDINGS` setzen und das Quellen-Panel eines Projekts mit `smith2024.pdf` öffnen. Erwartung: `multilingual-e5-small` (`Xenova/multilingual-e5-small`, q8) lädt nach `/var/lib/overleaf/data/spur-modelle`, das Panel zählt „Indexiert … von 8 Seiten“ hoch, und „memories get stronger in deep slow wave sleep“ findet S. 347. Der Pfad mit dem echten Modell ist im Builder ungetestet.
- Echte Paper-Dienste: Mit gesetzten Keys einmal ohne Paper-Fake suchen. Im Builder antworteten OpenAlex ohne Key mit 429 („Insufficient budget“) und Semantic Scholar ohne Key mit 429.

## Entscheidungen
- E2E-Schlüssel: P1 belegt `f1` bis `f15` in `spur-e2e.js`. Die Features dieses Plans heißen dort `p2f1` bis `p2f10`.
- Paper-Fake: Die Wurzel bleibt `SPUR_PAPER_API_BASE` aus `dev-schalter.json` (Standard aus P1: `…/spur/dev/crossref`). Crossref liegt wie bisher unter `…/works`, die anderen Dienste unter `…/arxiv`, `…/openalex`, `…/s2` und `…/unpaywall`, Antworten im Format der echten APIs aus `test/fixtures/papers.json`. Steuerung (Ausfall eines Dienstes) und Abrufprotokoll gibt es nur mit `SPUR_DEV=1` und nur im Speicher des Web-Prozesses.
- Keys: Ohne `OPENALEX_API_KEY` oder `SEMANTIC_SCHOLAR_API_KEY` bleibt der Dienst aus, und das Panel nennt ihn mit Hinweis (OpenAlex verweigert ohne Key, Semantic Scholar antwortet ohne Key fast immer mit 429). Mit Paper-Fake braucht kein Dienst einen Key.
- Drossel über die ganze Installation: Zeitfenster je Dienst als Mongo-Dokument (`spurDrossel`), atomar mit `findOneAndUpdate` vergeben. arXiv 3 s, Semantic Scholar 1 s, OpenAlex 0,1 s. Liegt das nächste freie Fenster mehr als 20 s in der Zukunft, meldet der Dienst „Limit erreicht“.
- Cache: Antworten je URL (ohne Key) 24 h in `spurPaperCache`, nur Metadaten.
- f3 Aufnehmen: Metadaten aus Crossref; arXiv-DOIs (bei DataCite registriert) aus der arXiv-API. Der freie Volltext kommt von Unpaywall oder arXiv und wird nur von öffentlichen https-Adressen geladen, höchstens 50 MB und nur mit `%PDF-` am Anfang. Ohne Lizenzangabe bekommt die Quelle `nurProjekt`: Sie erscheint im Panel mit „Volltext nur in diesem Projekt“, und „Aus anderem Projekt holen“ nimmt sie nicht mit.
- f4 Bibliothekslink: Die Vorlage gilt je Person (Einstellung mit `projectId: null` in `spurSettings`), Standard `https://doi.org/{doi}`. spur verlinkt nur. Der Schrägstrich der DOI bleibt im Link unkodiert.
- CSV-Exporte entschärfen Zellen, die mit `=`, `+`, `-` oder `@` beginnen (gemeinsamer Helfer `csv.mjs`).
- f5 Zotero: Der Import liest die Sammlung über `ZoteroApiClient` aus `modules/zotero` als BibTeX und hängt neue Einträge unverändert mit ihren Zotero-Keys an die erste `.bib` an (sonst neue `references.bib`). Ein Eintrag gilt als vorhanden, wenn Key oder DOI schon in einer `.bib` des Projekts stehen. Mit Paper-Fake kommen Sammlungen und BibTeX aus `papers.json`. Ordner-Import: Der Browser lädt die gewählten Dateien nacheinander über den normalen Upload; Dubletten erkennt der vorhandene Schlüssel je Projekt („schon vorhanden“).
- f6: Notizen stehen in der Quellenvorschau (eine je Quelle, eine je Zitat; leerer Text löscht). Die Literaturmatrix öffnet als großer Dialog aus dem Quellen-Panel, zeigt 50 Zeilen je Seite und speichert eine Zelle beim Verlassen des Feldes. `matrix_suggest` setzt nur den Vorschlag; vorhandener Text bleibt bis zur Bestätigung. Löschen einer Quelle oder des Projekts räumt Notizen, Zellen, Suchprotokoll und Beschaffungsliste mit auf.
- f7: `compile` kompiliert als die Person hinter dem Token (wie der Knopf im Editor) und legt einen Job in `spurJobs` an. `compile_log` und `page_image` lesen `output.log` und `output.pdf` des letzten fertigen Compiles dieses Bots direkt von CLSI (`getOutputFileURL`). Das Log ohne `-file-line-error` liefert keine Datei, nur Zeile und Meldung. `page_image` antwortet als MCP-Bildinhalt (`eigenerInhalt` im Endpunkt).
- f8: Die Heuristik (`schreiben/zahlen.mjs`) prüft nur den neuen Text eines `doc_edit` und nie `ergebnisse.tex`. Sie blendet Mathe, Kommentare, `\newcommand`, Argumente von Zitier-, Verweis- und Gliederungsbefehlen, Seitenangaben (S., Seite, p., pp., Kapitel, Abb., Tab.), Jahre 1500–2099 und Ziffern in Wörtern (COVID-19, 3D) aus. Treffer stehen im Ergebnis als `zahlen_ohne_beleg` und am Lauf, und die Karte zeigt sie als „Zahl ohne Beleg“. Die Automatik nimmt solche Läufe nicht an, wie bei roten Zitaten.
- f9: Die Offenlegung zählt Läufe mit mindestens einer Änderung. Zweck sind die Zusammenfassungen aus `run_finish`. Die Annahmequote gilt für entschiedene Läufe (angenommen oder abgelehnt); noch offene Läufe nennt der Text extra. Das Modell steht nur im Text, wenn die Person es ins Freitextfeld schreibt, weil spur das Modell nicht gemeldet bekommt. „Als .tex-Abschnitt einfügen“ schreibt `ki-offenlegung.tex` als Person, ohne Track Change; eingebunden wird es mit `\input{ki-offenlegung}`.
- f10: Die Schalter `SPUR_SEMANTIC_SEARCH` und `SPUR_FAKE_EMBEDDINGS` kommen aus der Umgebung. Nur mit `SPUR_DEV=1` darf die E2E-Suite sie zur Laufzeit über `POST …/_steuerung` überschreiben, weil `compose.yml` keine Variablen durchreicht. Vektoren liegen als `Binary` (Float32, 384 Werte) an der Seite in `spurSourcePages`, gesucht wird mit Brute-Force-Kosinus. Das Indexieren läuft als Job in `spurJobs`; das Panel stößt es an und fragt alle 500 ms nach. Die Fake-Einbettung (Zeichen-Trigramme) wartet 1 s je Seite, damit der Fortschritt sichtbar wird, und legt nie ein Modell ab. Treffer erzeugen keine Zitate oder Markierungen und sind als „kein Prüfbeleg“ beschriftet.

## /simplify (Diff 0c431525a7..HEAD, nur dieser Lauf)
- Basis: Die Skill-Formel ergibt `7ff09078c1^`. Dieser Diff enthält auch P11-Commits (etwa `zitatManager.test.mjs`). Wie in P1 laufen `/simplify` und `/code-review` deshalb auf `0c431525a7..HEAD`, dem Stand vor f1.
- Umgesetzt:
  - `antwortVon` reicht fertige MCP-Inhalte durch; das Flag `eigenerInhalt` ist entfallen.
  - Die Fake-Pause liegt im Fake-Einbetter, nicht mehr in der Indexschleife.
  - Notizen fragen über den Index `projectId` ab.
  - Neue Indizes für `spurJobs`.
  - Eine DOI-Normalisierung für Aufnahme, Beschaffung und Zitationen, die auch `https://doi.org/…` versteht.
  - `ApiFehler` statt Cast im Panel.
- Nicht umgesetzt:
  - Gemeinsame Hooks für Seitenlisten in den Panels (wie in P1 zurückgestellt; Umbau ohne Verhaltensgewinn).
  - `@overleaf/fetch-utils` statt `fetch`: `Crossref.mjs` arbeitet ebenso mit `fetch`, der Umstieg gehört in einen eigenen Schritt.
  - Paper-Fake unter `/spur/dev/paper`: Die Wurzel steht in der installierten Kopie von `spur-dev`, die nur ein Mensch ändert.
  - Dev-Schalter über `dev-schalter.json`: Das Modulverzeichnis ist im Container schreibgeschützt.
  - Zellen der Matrix ohne Effekt und memoisiert: 50 Zeilen je Seite bleiben bedienbar (E2E unter 5 s).
  - Streaming und Top-10-Heap in der semantischen Suche: Bei Brute Force (Decision) ist das Optimierung; das Backlog nennt pgvector für später.
- Prettier lief nicht: Das Dev-Image hat keinen `prettier`-Befehl (`yarn exec prettier` findet nichts).
