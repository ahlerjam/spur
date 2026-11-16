Type: api, web

# spur P13: Verlässliche Literaturdaten

## Zweck
Die von spur erzeugten `.bib`-Einträge waren in einer echten Arbeit unvollständig oder falsch: Band und Heft fehlten fast immer, das Jahr war das der Online-Vorabveröffentlichung, HTML-Entities standen im Titel, Preprints waren Zeitschriftenartikel ohne Zeitschrift, die Autorenreihenfolge kam aus arXiv statt aus dem PDF, und hochgeladene PDFs bekamen gar keinen Eintrag. Dieser Plan macht die Einträge so, dass ein APA-Literaturverzeichnis ohne Nacharbeit stimmt.

## Nutzer
Forschende, die mit spur ein Literaturverzeichnis nach APA 7 (biblatex-apa) erzeugen; Claude als MCP-Client.

## Was Nutzer danach können
- Sich darauf verlassen, dass ein per DOI aufgenommener Artikel Band, Heft, Seiten und das Jahr der Heftausgabe trägt.
- Titel und Zeitschriftennamen ohne `&amp;` und andere Entities lesen.
- Preprints korrekt als Preprint zitieren.
- Sehen, wenn die Autoren im PDF anders stehen als in den Metadaten.
- Für jedes hochgeladene PDF einen `.bib`-Eintrag vorfinden.
- Mit `bib_list` erkennen, welchen bestehenden Einträgen etwas fehlt.

## Context
- `pruefung/bib.mjs` (`bibEintrag`): immer `@article`, Felder nur `author`, `title`, `journal`, `year`, `pages`, `doi`. `Crossref.werkAuswerten` liest weder `volume` noch `issue`; das Jahr kommt aus `issued` (frühestes Datum, oft online first). Echte Fälle: Oldemeyer 2024 statt 2025, Morley 2021 statt 2023.
- `latexSicher` maskiert LaTeX-Sonderzeichen, dekodiert aber keine Entities; aus `&amp;` wird `\&amp;`.
- arXiv: `arxivMetadaten` setzt `typ: 'preprint'`, das wird nicht ausgewertet; Namen werden am letzten Leerzeichen geteilt. Echter Fall: Bei Gandhi/Joshi war die Reihenfolge aus den arXiv-Metadaten anders als auf dem PDF.
- Upload (`hochladen/UploadLinkController.mjs`): Ein `.bib`-Eintrag entsteht nur, wenn die DOI zu einem offenen Eintrag der Beschaffungsliste passt.
- `bib_list` fragt Crossref je Eintrag ab und zeigt den Referenzstatus.
- biblatex-apa führt Preprints als `@online` mit `eprint` (Name des Archivs), `doi` und `date` (Beispiel 10.8:73a in den Testreferenzen des Pakets).
- P12 legt Einträge für Quellen ohne DOI an (`@thesis`, `@report`, …); dieser Plan lässt sie unverändert.

## Decisions
Owner-Entscheidungen (2026-11-16):
- Band, Heft und Jahr der Heftausgabe aus Crossref übernehmen, Entities säubern, Preprints als Preprint anlegen, Autoren gegen das PDF abgleichen, beim Upload immer einen Eintrag erzeugen.
- Ein Upload mit DOI bekommt immer einen `.bib`-Eintrag, auch ohne Eintrag auf der Beschaffungsliste.
Annahmen (ohne Rückfrage getroffen):
- Jahr: `published-print`, sonst `issued`. Laut Crossref-Formatbeschreibung (geprüft am 2026-11-16) ist `issued` das frühere der beiden Daten `published-print` und `published-online`; `volume`, `issue` und `page` heißen dort so. Liefert eine Antwort zusätzlich `journal-issue.published-print`, gilt es nach `published-print` und vor `issued`. Weicht das gewählte Jahr vom Online-Jahr ab, trägt die Quelle zusätzlich `jahrOnline`; der Key einer neuen Quelle nutzt das Jahr der Heftausgabe.
- Neue Felder im Eintrag: `volume`, `number`; `pages` wie bisher. Hat ein Artikel eine Artikelnummer statt Seiten (Crossref `article-number`), steht sie im Feld `eid` und `pages` entfällt; so führt es biblatex-apa in seiner Testreferenz 10.1:6 (`EID = {e0209899}`). Eintragstyp nach Crossref-`type`: `journal-article` → `@article`, `book-chapter` → `@incollection` mit `booktitle`, `publisher`, `book`/`monograph` → `@book` mit `publisher`, `proceedings-article` → `@inproceedings` mit `booktitle`, `posted-content` → Preprint, alles andere → `@misc`.
- Preprint (arXiv-DOI oder Crossref `posted-content`): `@online` mit `author`, `title`, `date` (Jahr), `eprint = {arXiv}` bzw. der Name des Archivs, `doi`; kein `journal`.
- Entities: Benannte und numerische HTML-Entities sowie Tags wie `<i>`, `<sub>`, `<sup>` in Titel, Zeitschrift, Autoren und Verlag werden vor dem Maskieren aufgelöst (`&amp;` → `&`, danach `\&`); `<i>…</i>` wird `\textit{…}`. Bestehende Einträge ändert spur nicht von selbst.
- Autorenabgleich nach dem Einlesen des PDFs, nur für Quellen mit Text: Stehen alle Nachnamen aus den Metadaten auf der ersten Seite und dort in anderer Reihenfolge, schreibt spur die Reihenfolge des PDFs in den Eintrag und merkt `autoren: 'aus_pdf'`. Fehlt mindestens ein Nachname auf der ersten Seite, bleibt die Reihenfolge der Metadaten und die Quelle bekommt den Hinweis `autoren: 'abweichend'`. Sonst `autoren: 'bestaetigt'`. Der Vergleich ignoriert Groß- und Kleinschreibung und Diakritika. `source_add`, `sources_list` und das Quellen-Panel zeigen den Zustand; nur `abweichend` ist ein sichtbarer Hinweis („Autoren im PDF nicht gefunden – bitte prüfen“).
- Upload ohne DOI und ohne Metadaten: Eintrag `@misc` mit dem Titel aus den PDF-Metadaten, sonst dem Dateinamen ohne Endung, und dem Hinweis `metadaten: 'unvollstaendig'` an der Quelle. Upload mit `--doi`: Metadaten aus Crossref wie bei `source_add`; kennt Crossref die DOI nicht, gilt der Weg ohne DOI.
- `bib_list` bekommt je Eintrag `abweichungen`: eine Liste aus Feld, Wert im Eintrag und Wert laut Crossref für fehlendes oder anderes `volume`, `number`, `pages`, `year` und für einen Eintragstyp, der nicht zur Art des Werks passt. Leere Liste heißt: stimmt. Abweichungen sind Hinweise, kein `problem: true`. Der Prüfbericht zeigt sie je Referenz als neutrales Abzeichen „Literaturdaten unvollständig“ mit den Feldern; korrigiert wird von Hand oder durch Claude mit `doc_edit`.
- Ist Crossref nicht erreichbar, ist `abweichungen` `null` mit dem Grund, nie eine leere Liste.

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
- Die E2E-Suite bekommt je Feature Schritte (`p13f1` …) und läuft nach dem Zurücksetzen der Testdaten vollständig grün, auch alle älteren Features.
- `spur-dev test` bleibt über 80 % Zeilenabdeckung; `node --test tools/tests/*.test.mjs` ist grün (auch der Vertragstest `mcp-vertrag.test.mjs`).
- Overleafs eigene Suiten bleiben grün bis auf die bekannte Upstream-Liste.
