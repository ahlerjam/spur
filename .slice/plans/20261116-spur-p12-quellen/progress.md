# Fortschritt P12

## Recipe changes
- Stack: `spur-dev up` aus diesem Worktree, `dev-schalter.json` = `{"SPUR_PAPER_API_BASE": "http://127.0.0.1/spur/dev/crossref"}`.
- Browser-Suite wie in P5: `.playwright-mcp/mach-wrapper.sh [p12f1,…]` (gitignoriert) erzeugt `start.js`, das `spur-e2e.js` startet, ohne zu warten; `poll.js` fragt das Ergebnis in Aufrufen unter 60 s ab. Der Gesamtlauf braucht auf diesem Rechner etwa 19 Minuten.
- `spur-dev test` zeigt nur die letzten 60 Zeilen. Für die Liste aller roten Tests half ein kleiner Läufer im Modulordner (nicht im Repo), der vitest über `vitest/node` mit JSON-Reporter startet: `spur-dev run modules/spur/test/<läufer>.mjs`.
- Neue Übersetzungsschlüssel, die das Frontend nutzt, müssen zusätzlich in `services/web/frontend/extracted-translations.json` stehen; sonst zeigt die Oberfläche den Schlüssel.

## Rauchtest vor dem Bauen
- Gesamtlauf auf dem Stand vor P12: 96 von 98 grün. Rot waren `p5f8` (Backlog hat seit dem Commit „Ideen aus dem Altprojekt“ 45 statt 41 Einträge; Zahl im Schritt angepasst) und `p10f4` (der Lauf beim Laden der Seite und der angestoßene Compile überholen sich, ein übersprungener Lauf ersetzt das Log mit dem Hinweis; der Schritt zählt den Hinweis jetzt erst, wenn er 3 s stehen bleibt). Beide danach grün.

## Entscheidungen
- E2E-Schlüssel `p12f1` bis `p12f5`, Projekt „E2E P12 Quellen“.
- Unpaywall: Feldnamen `oa_locations`, `host_type`, `url_for_pdf`, `url_for_landing_page`, `license` über Context7 belegt (Datenformat-Doku des Clients unpywall, die Unpaywalls Schema wiedergibt). Fehlt `oa_locations` in einer Antwort, nimmt spur `best_oa_location`.
- f1: `unpaywall.status` liefert `{ frei, fundorte }` statt `{ frei, pdf, lizenz }`. Sagt Unpaywall „frei“, kennt aber keine PDF-Adresse, fragt spur trotzdem Europe PMC; erst ohne jeden Fundort bleibt es bei `nicht_frei`.
- f1: Ergebnisse in `versucht`: `html`, der HTTP-Status als Text (`403`, `404`, …), `kein_pdf` (2xx, weder PDF noch HTML), `falsches_pdf`, `zu_gross`, `gesperrt` (Adresse nicht erlaubt), `netzfehler`. Wiederholt werden nur Netzfehler, 429 und 503. Ein unlesbares PDF zählt als `kein_pdf`, der nächste Fundort wird versucht.
- f1: Fehler tragen Zusatzfelder (`Problem.zusatz`): Über MCP stehen sie neben `fehler` und `detail`, in Web-Antworten als Erweiterungsfelder nach RFC 9457.
- f1: Der Titelabgleich läuft in `QuellenManager.aufnehmen`, sobald der Aufrufer einen Titel vorgibt (DOI-Aufnahme, Upload mit `doi` oder `titel`). Beim Upload mit `doi` holt spur dafür die Metadaten der angegebenen DOI; vorher kamen sie nur aus einer DOI im PDF-Text.
- f1: Die Lizenz des Fundorts steht an der Quelle (`lizenz`) und im Quellen-Panel („Lizenz: CC BY“).
- Fake: Werke mit `nurDoi` kennt Crossref per DOI, sie tauchen in keiner Suche auf. `fundorte` je Werk mit `liefert` (Dateiname, `html` oder Status); Störungen für alle Fundorte über `stoerungen.fundort`.
- f2: `Beschaffung.aufnehmenOderVormerken` umschließt die Aufnahme per DOI für MCP (`source_add`) und die Web-Route. Bei `nicht_frei` und `bot_schutz` legt sie den Eintrag an (Felder `grund`, `adresse`) oder ergänzt einen vorhandenen; der Fehlertext sagt dann, dass das Paper auf der Liste steht. Lässt sich der Eintrag nicht anlegen, kommt der ursprüngliche Fehler ohne diesen Satz.
- f2: „Beste Adresse“ ist die Artikelseite (`url_for_landing_page`) des ersten Fundorts, der den Server abgewiesen hat, sonst dessen PDF-Adresse. Sie steht bei `bot_schutz` auch in der Antwort (`adresse`). Die Liste verlinkt sie nur mit http(s).
- f2: Ein von Hand angelegter Eintrag (`acquisition_add`) hat keinen Grund und zeigt kein Abzeichen.
- f3: Suchdienste wiederholen 429, 503 und Netzfehler (höchstens 3 Versuche, 20 s). `versuche` je Dienst ist die höchste Zahl an Versuchen für eine einzelne Anfrage; 0 heißt: Antwort aus dem Cache. Die Pausenregel teilen sich Suche und Volltext-Download (`recherche/wiederholen.mjs`).
- f4: `source_add` prüft `doi`, `pdf_url` und `metadaten` selbst (lockeres Schema), damit jeder Eingabefehler `eingabe_ungueltig` mit `feld` ergibt statt eines Protokollfehlers von MCP.
- f4: Adressprüfung im Dev-Stack verschärft: Ins lokale Netz dürfen nur noch Adressen unter `SPUR_PAPER_API_BASE` (vorher mit Fake jede Adresse). Sonst gilt überall die Regel „öffentliche https-Adresse“. Im E2E-Lauf ist die Adresse der Abschlussarbeit deshalb `http://127.0.0.1/spur/dev/crossref/thesis/tampere.pdf` (der Fake hat kein TLS); `http://…`, `localhost` und IP-Adressen außerhalb der Fake-Basis werden nicht abgerufen.
- f4: Quellen aus `pdf_url` tragen `pdfUrl` und `hash` (SHA-256 der Datei) für die Dublettenprüfung und bleiben ohne Lizenzangabe im Projekt (`nurProjekt`), wie bei der Aufnahme per DOI. `url` in der `.bib` ist `metadaten.url`, sonst die `pdf_url`.
- f4: `.bib`-Typen: `thesis` → `@thesis`, `report` → `@report`, `working_paper` → `@report` mit `type = {Working paper}` (oder `abschluss`), `book` → `@book` (`publisher`), `misc` → `@misc` (`organization`).
- f4: Upload ohne `doi`: Sobald eines der Felder `autoren`, `jahr`, `art`, `institution`, `abschluss`, `url` mitkommt, entsteht der Eintrag wie bei `pdf_url` (Key aus Nachname und Jahr, `.bib`). Nur `titel` verhält sich wie bisher (Key aus dem Dateinamen, kein `.bib`-Eintrag), damit bestehende Aufrufe gleich bleiben. Die Antwort nennt zusätzlich `key`.
- f4: Der Prüfbericht markiert die Stelle aus der Abschlussarbeit, bis die Person die Seitenzahl bestätigt (PDF ohne PageLabels, bestehende Regel für jede Quelle). Die Referenz „ohne DOI“ ist kein Problem. Der E2E-Schritt bestätigt die Seite wie eine Nutzerin.
- f5: Das Protokoll speichert je Anfrage ein Dokument in `spurSearchLog` (`dienste`, `geliefert`, `neu`) und jeden Treffer einmal je Projekt in der neuen Sammlung `spurSearchHits` (Migration `20261116100000_spur_p12_suchtreffer`, eindeutiger Index auf Projekt und Schlüssel). „Identifiziert“ zählt die gelieferten Treffer der Seite, nicht die Gesamtzahl, die ein Dienst meldet.
- f5: Entscheidung je Treffer in dieser Reihenfolge: aufgenommen (Quelle mit der DOI), ausgeschlossen (`paper_exclude`), nicht beschaffbar (offener Eintrag der Beschaffungsliste), sonst offen. Der Grund bei „nicht beschaffbar“ ist der des Listeneintrags; fehlt er (Eintrag von Hand), der eines vorher gescheiterten Downloads (`pdf_fehlt`), sonst `nicht_frei`. `nicht_beschaffbar` nennt nur Gründe, die vorkommen.
- f5: `paper_search` nimmt zusätzlich `cursor` und liefert `naechster_cursor`; `seite` bleibt. `search_log` blättert aufsteigend in zeitlicher Folge, die Web-Ansicht zeigt wie bisher die neuesten zuerst. `filter` ist immer `null`, weil `paper_search` keine Filter kennt.
- f5: Alte Protokolleinträge (je Dienst gespeichert) zählen ihre Trefferzahl als identifiziert, gesichtet und offen; so bleibt die Gleichung gültig. Der CSV-Export hat neue Spalten (je Dienst Status und Treffer); der alte Kopf `Datum,Datenbank,Anfrage,Trefferzahl` entfällt, `p2f2` prüft das neue Format.
- f5: `paper_exclude` braucht dasselbe Recht wie `source_add` (Schreiben im Projekt). Ohne Zugriff antworten `search_log` und `paper_exclude` über MCP mit `keine_rechte` (das ist die 403 der Web-Routen).
- Fake: `suchen` in der Steuerung legt je Anfrage feste Treffer je Dienst und Seite fest.

## Vorschläge (nicht gebaut)
- `spur-hochladen --abschluss`: Die Spec nennt die Option nicht; der Server nimmt das Feld `abschluss` beim Upload schon an. Ohne sie fehlt bei hochgeladenen Abschlussarbeiten `type` in der `.bib`.

## /simplify (661a28817e..HEAD)
- Umgesetzt: Die Adressprüfung wertet `imFake` einmal aus und nutzt den vorhandenen `gesperrtFehler` aus `netz.mjs` statt eines eigenen Symbols. Die Prüfsumme bei `pdf_url` entsteht beim Laden statt durch erneutes Lesen der Datei (spart bis 50 MB Lesen und Puffer). `QuellenManager.aufnehmen` nimmt benannte `pdfUrl` und `hash` statt beliebiger `felder`. `pdfinfo` für das Titelfeld läuft nur noch, wenn der Text der ersten Seiten allein nicht passt. Suchprotokoll und Titelabgleich teilen die Titelnormalisierung (Dubletten ohne DOI sind jetzt auch ohne Akzente gleich). Die Feldliste für Uploads ohne DOI steht in `ohneDoi.mjs`. Für `paper_exclude` per Titel gibt es den Index `projectId_1_titelSchluessel_1_erstmals_-1` in derselben Migration.
- Nicht umgesetzt, Vorschläge für später:
  - Eine gemeinsame Wiederholungsschleife für Suchdienste, Volltexte und Crossref (`Crossref.mjs` hat eigene Regeln: 4 Versuche, höchstens 5 s Retry-After). Das Angleichen ändert das Verhalten von Crossref und gehört nicht in diesen Plan.
  - `prisma` per Mongo-Aggregation statt Zählen in Node: lohnt erst bei Zehntausenden Treffern je Projekt.
  - `versuche` als Rückgabewert statt über `AsyncLocalStorage`: berührt jede Dienstmethode.
  - Titelabgleich als eigene Prüfung vor `aufnehmen` statt `titelStreng` plus Auswertung von `error.typ`.
  - Ein Merkmal `meta.herkunft` statt der zwei Metadatenformen (`gefunden` bei DOI, `art` ohne DOI).
  - Alte Protokolleinträge per Migration ins neue Format bringen; heute liest `istAlt` beide Formen.


## /code-review medium (661a28817e..HEAD)
- Behoben: (1) Gleichzeitige Suchen mit denselben Treffern zählten `neu` falsch (Test: 8 parallele Suchen mit 40 gleichen Treffern ergaben 56 neue). Jeder Treffer merkt sich jetzt die Anfrage, die ihn angelegt hat (`anfrageId`, Index `projectId_1_anfrageId_1`); doppelte Schlüssel aus parallelen Upserts bricht die Suche nicht mehr ab. (2) Fundorte, die nach Ablauf der 60 s nicht mehr versucht wurden, stehen in `versucht` als `zeit_abgelaufen` statt `netzfehler` (Vertrag ergänzt). (3) Upload ohne DOI: Ein paralleles `quelle_vorhanden` antwortet wie beim DOI-Pfad mit `vorhanden`. (4) Scheitert das Vermerken von `pdf_fehlt` im Suchprotokoll, kommt trotzdem der eigentliche Fehler mit `versucht`.
- Nicht geändert: Treffer ohne DOI und Titel zählen je Suche neu (es gibt nichts zum Vergleichen; so in der Spec). Quellen aus `pdf_url` zählen nicht als „aufgenommen“, weil die Spec „aufgenommen“ an `source_add` oder Upload mit der DOI bindet. Anfragen ohne Antwort eines Dienstes stehen im Protokoll, weil die Spec jede Anfrage verlangt. `vormerken` auf einen beschafften Eintrag ist nicht erreichbar: `loeschen` setzt den Eintrag beim Entfernen der Quelle wieder auf offen, und mit vorhandener Quelle endet `source_add` vorher mit `quelle_vorhanden`. `prisma` per Aggregation: siehe /simplify.
- Spec-Abgleich: Alle Schritte der fünf Features sind durch `p12f1`–`p12f5` abgedeckt. Die Web-Route `/recherche/protokoll` liefert je Zeile `zeit`, `seite`, `dienste`, `treffer`, `dubletten` statt `datum`, `dienst`, `treffer` und dazu `prisma`; der CSV-Export hat neue Spalten. Das verlangt die Spec („Die Web-Ansicht des Protokolls und der CSV-Export zeigen dieselben Spalten und Summen“); einziger Abnehmer der Route ist das eigene Frontend. Die MCP-Werkzeuge behalten alle bisherigen Felder.

## Texte
- humanizer-de (Modus sachlich): Preflight `low`, keine Cluster. Geändert: `spur_fehler_eingabe_doi_oder_pdf_url` nennt das Feld jetzt in einem eigenen Satz statt in einer unerklärten Klammer. humanizer (englisch): keine Muster aus Abschnitt A bis E; dieselbe Änderung in `en.json`.
