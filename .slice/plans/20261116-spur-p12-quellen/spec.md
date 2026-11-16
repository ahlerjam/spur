Type: api, web

# spur P12: Quellen beschaffen und Suche nachvollziehen

## Zweck
In einer echten Arbeit scheiterte `source_add` bei 10 frei lizenzierten Papern am Bot-Schutz der Verlagsseiten, Quellen ohne DOI ließen sich nicht aufnehmen, die Suchdienste waren fast immer gedrosselt, und die Zahlen für das PRISMA-Diagramm mussten von Hand gezählt werden. Dieser Plan gibt der Beschaffung Ausweichwege, trennt die Gründe sauber und macht die Suche lückenlos nachvollziehbar.

## Nutzer
Forschende, die mit Claude Code in spur Literatur sammeln; Claude als MCP-Client; alle, die ein PRISMA-Flussdiagramm mit exakten Zahlen brauchen.

## Was Nutzer danach können
- Freie Paper per DOI aufnehmen, auch wenn die Verlagsseite den Server abweist, weil spur Repositorien und Europe PMC zuerst versucht.
- Am Status erkennen, warum ein Paper fehlt: Bezahlschranke (`nicht_frei`) oder frei, aber vom Bot-Schutz blockiert (`bot_schutz`).
- Abschlussarbeiten, Reports und Working Papers ohne DOI über eine PDF-Adresse oder per Upload mit Metadaten aufnehmen.
- Suchen, ohne dass eine kurze Drosselung das Ergebnis leert.
- Das Suchprotokoll über MCP abrufen und die PRISMA-Zahlen exakt übernehmen.

## Context
- Aufnahme per DOI: `recherche/Aufnahme.mjs` (`perDoi`). Das PDF kommt bei arXiv aus dem arXiv-Link, sonst nur aus Unpaywalls `best_oa_location.url_for_pdf` (`recherche/dienste.mjs`, `unpaywall.status`). Scheitert der Download (kein `%PDF-`-Anfang, Status nicht 2xx, mehr als 5 Redirects), gibt es einheitlich `pdf_fehlt` (502). Kein zweiter Fundort, keine Wiederholung. Echter Fall: Mikalef & Gupta (2021) und Neumann et al. (2022) sind Open Access, die Verlagsseite lieferte dem Server aber HTML statt PDF.
- Unpaywall: Der Code liest heute `is_oa` und aus `best_oa_location` die Felder `url_for_pdf` und `license` (`recherche/dienste.mjs`). Die Liste aller Fundorte heißt nach Kenntnis des Planers `oa_locations`, je Eintrag mit `host_type` (`publisher` oder `repository`), `url_for_pdf`, `url_for_landing_page` und `license`. Das ist nicht verifiziert (die Doku-Seite ließ sich am 2026-11-16 nicht abrufen). Der Builder prüft die Feldnamen über Context7, bevor er den Fake erweitert. Lässt es sich nicht belegen, baut er nach dieser Beschreibung und vermerkt in `progress.md`, dass der Owner die Feldnamen nach dem Merge an einer echten Antwort prüft.
- Europe PMC, geprüft am 2026-11-16 an einer echten Antwort: `GET https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=DOI:<doi>&format=json&resultType=core` liefert `resultList.result[]`. Je Treffer stehen `doi`, `pmcid`, `isOpenAccess` ("Y"/"N"), `hasPDF` ("Y"/"N"), `license` (etwa "cc by") und `fullTextUrlList.fullTextUrl[]` mit `availabilityCode` ("OA" für frei, "S" für Abo), `documentStyle` ("pdf", "html", "doi"), `site` und `url`. Das freie PDF ist der Eintrag mit `availabilityCode: "OA"` und `documentStyle: "pdf"`, etwa `https://europepmc.org/articles/PMC1817752?pdf=render`. Ohne Treffer ist `resultList.result` leer.
- `source_add` und `acquisition_add` nehmen nur eine DOI (`mcp/werkzeuge.mjs`). Echter Fall: eine Masterarbeit der Universität Tampere ohne DOI ließ sich nicht aufnehmen.
- Suchdienste: `recherche/abruf.mjs` wirft bei 429 sofort `DienstFehler('limit')` (Status `gedrosselt`), ohne Wiederholung. `Crossref.mjs` hat bereits 4 Versuche mit `Retry-After`. Echter Fall: Semantic Scholar bei 16 von 17 Anfragen gedrosselt, OpenAlex bei 7.
- Suchprotokoll: Mongo-Sammlung `suchprotokoll`, geschrieben nur bei `seite === 0` (`recherche/Recherche.mjs`), abrufbar nur über die Web-Routen `/protokoll` und `/protokoll.csv`. Auswahlentscheidungen (aufgenommen, ausgeschlossen) stehen nicht darin.
- Fakes: `dev/PaperFake.mjs` kennt Crossref, arXiv, OpenAlex, Semantic Scholar, Unpaywall, doi.org, DataCite und kann je Dienst Störungen setzen (`stoerungen`, auch `mal` und `retryAfter`).
- Plugin-Skript `plugins/spur/bin/spur-hochladen` lädt PDFs über den Einmal-Link hoch und kennt `--doi` und `--titel`.

## Decisions
Owner-Entscheidungen (2026-11-16):
- Ausweichwege auf dem Server: alle freien Unpaywall-Fundorte, Repositorien vor Verlagsseiten, danach Europe PMC; jeder Fundort wird bei Netzfehlern und 429/503 begrenzt wiederholt. Kein Browser auf dem Server; den Browser-Weg übernimmt das Plugin (Plan P17).
- `bot_schutz` ist ein eigener Status neben `nicht_frei` und `pdf_fehlt`.
- Quellen ohne DOI: Aufnahme über eine https-PDF-Adresse oder per Upload, jeweils mit Metadaten (Titel, Autoren, Jahr, Art, Institution). Keine Auflösung von Handles oder URNs.
- Das Suchprotokoll hält jede Anfrage fest, auch Folgeseiten, dazu Dubletten und die Entscheidung je Treffer; es ist über MCP abrufbar.
Annahmen (ohne Rückfrage getroffen):
- `bot_schutz` (HTTP 502) heißt: Mindestens ein freier Fundort ist bekannt, aber keiner lieferte ein PDF, und mindestens eine Antwort war HTML oder ein Status 401, 403, 429 oder 503. `nicht_frei` (409) bleibt: Unpaywall kennt keinen freien Fundort. `pdf_fehlt` bleibt für alle anderen Ladefehler. Die Antwort nennt bei `bot_schutz` und `pdf_fehlt` unter `versucht` jede Adresse mit Host, Art (`repository`, `publisher`, `europepmc`) und Ergebnis.
- Bei `bot_schutz` setzt spur die DOI selbst auf die Beschaffungsliste, mit Grund „frei, Download blockiert“ und der besten Adresse; bei `nicht_frei` mit Grund „nicht frei verfügbar“. Ein späterer Upload mit dieser DOI erledigt den Eintrag wie bisher.
- Wiederholung: höchstens 3 Versuche je Adresse, Pause nach `Retry-After` (höchstens 10 s), sonst 1, 2, 4 s; insgesamt höchstens 60 s je `source_add`. Suchdienste in `abruf.mjs`: höchstens 3 Versuche mit denselben Pausen, insgesamt höchstens 20 s; erst danach `gedrosselt`. Die Antwort von `paper_search` nennt je Dienst zusätzlich `versuche`.
- Ohne DOI: `source_add` nimmt statt `doi` die Felder `pdf_url` (nur https, SSRF-Schutz wie bisher, höchstens 50 MB) und `metadaten` mit `titel` (Pflicht), `autoren` (Liste aus `family` und `given`), `jahr`, `art` (`thesis`, `report`, `working_paper`, `book`, `misc`), `institution`, `abschluss` (frei, etwa „Masterarbeit“) und `url`. Genau eines von `doi` und `pdf_url` muss gesetzt sein, sonst 422 `eingabe_ungueltig` mit dem Feldnamen. Die Quelle bekommt einen `.bib`-Eintrag passend zur Art (`@thesis` mit `type` und `institution`, `@report`, `@book`, `@misc`) mit `url` und `urldate`; im Prüfbericht heißt die Referenz wie bisher „ohne DOI“ und zählt nicht als Problem. Dublette: gleiche `pdf_url` oder gleicher Datei-Hash ergibt `quelle_vorhanden`.
- `spur-hochladen` bekommt `--autoren "Nachname, Vorname; …"`, `--jahr`, `--art`, `--institution` und `--url`; ohne `--doi` entsteht daraus derselbe Eintrag.
- Neues MCP-Werkzeug `search_log` (nur lesend, Parameter `project_id`, `cursor`): liefert die Anfragen (Zeit, Suchtext, Filter, Seite, je Dienst Status und Trefferzahl) und unter `prisma` die Summen `identifiziert` (Treffer je Dienst und gesamt), `dubletten`, `gesichtet`, `aufgenommen`, `ausgeschlossen` (nach Grund), `nicht_beschaffbar` (nach `nicht_frei`, `bot_schutz`, `pdf_fehlt`). Es gilt `identifiziert − dubletten = gesichtet`.
- Entscheidung je Treffer: „aufgenommen“ entsteht durch `source_add` oder Upload mit der DOI, „nicht beschaffbar“ durch einen Eintrag auf der Beschaffungsliste. Für „ausgeschlossen“ gibt es das neue MCP-Werkzeug `paper_exclude` (`project_id`, `doi` oder `titel`, `grund` als freier Text bis 200 Zeichen); ein Treffer ohne Entscheidung zählt als „gesichtet, offen“. Die Web-Ansicht des Protokolls und der CSV-Export zeigen dieselben Spalten und Summen.
- Dubletten werden über die normalisierte DOI erkannt, ohne DOI über Titel (klein, ohne Satzzeichen) und Jahr.
- Bestehende Protokolleinträge bleiben lesbar; ihnen fehlen die neuen Felder, sie zählen in `prisma` mit dem, was sie haben.
- Europe PMC bekommt einen Fake im `PaperFake`; die echte Adresse ist per Schalter einstellbar wie bei den anderen Diensten.
Nachtrag (2026-11-16, Owner: Brauchbares aus dem Altprojekt `academic-research` aufnehmen; die Einzelheiten sind Annahmen des Planers):
- Titelabgleich gegen falsche PDFs: Ein Ausweichweg kann das PDF eines anderen Werks liefern. Nach jedem geladenen PDF vergleicht spur den Titel aus den Metadaten mit dem Text der ersten drei Seiten und dem Titelfeld des PDFs (klein geschrieben, ohne Satzzeichen und Akzente). Es passt, wenn mindestens die Hälfte der Titelwörter mit vier oder mehr Zeichen vorkommt, mindestens aber drei (bei weniger als drei solchen Wörtern alle). Drei Seiten statt nur des Anfangs, weil Repositorien oft ein Deckblatt voranstellen.
- Ergebnis im Feld `titelabgleich` der Quelle: `passt`, `abweichend` oder `nicht_pruefbar` (die ersten drei Seiten haben keine Textebene, oder der Titel hat kein Wort mit vier Zeichen). `nicht_pruefbar` ist kein Fehltreffer; die Quelle wird aufgenommen wie bisher.
- Beim Download durch den Server weist `abweichend` den Fundort ab: Er steht in `versucht` mit dem Ergebnis `falsches_pdf`, der nächste Fundort wird versucht. `falsches_pdf` zählt nicht als Bot-Schutz; liefert kein Fundort ein passendes PDF und gab es sonst keine HTML- oder 401/403/429/503-Antwort, lautet der Status `pdf_fehlt`.
- Beim Upload (Einmal-Link, auch aus dem Browser-Weg des Plugins) und bei `pdf_url` mit `metadaten` wird nicht abgewiesen, weil die Person das PDF selbst gewählt hat: Die Quelle entsteht mit `titelabgleich: "abweichend"`, die Antwort und `sources_list` tragen den Hinweis „Titel im PDF passt nicht zu den Metadaten“, das Quellen-Panel zeigt ihn an der Quelle. Übersetzte Titel können so einen Hinweis auslösen; er ist deshalb eine Warnung und kein Fehler.
- Bereits aufgenommene Quellen werden nicht nachträglich abgeglichen; ihnen fehlt das Feld.

## Access
Alle optional, Tests nutzen Fakes: `UNPAYWALL_EMAIL`, `CROSSREF_MAILTO`, `OPENALEX_API_KEY`, `SEMANTIC_SCHOLAR_API_KEY`.

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
- Die E2E-Suite bekommt je Feature Schritte (`p12f1` …) und läuft nach dem Zurücksetzen der Testdaten vollständig grün, auch alle älteren Features.
- `spur-dev test` bleibt über 80 % Zeilenabdeckung; `node --test tools/tests/*.test.mjs` ist grün (auch der Vertragstest `mcp-vertrag.test.mjs`).
- Overleafs eigene Suiten bleiben grün bis auf die bekannte Upstream-Liste.
