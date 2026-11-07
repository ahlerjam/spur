Type: web, api

# spur P2: Recherche und Design

## Zweck
Forschende finden passende Literatur, beschaffen sie, strukturieren ihr Material und lassen Claude Layout, Folien und Zahlen im echten Compile-Ergebnis kontrollieren.

## Nutzer
Wie in P1: Forschende und Studierende, die spur und ihr Claude Code nutzen.

## Was Nutzer können
- Paper über arXiv, OpenAlex, Crossref und Semantic Scholar suchen, Zitationen folgen und die Suche als Protokoll exportieren.
- Open Access prüfen und per DOI aufnehmen.
- Nicht freie Paper auf eine Beschaffungsliste setzen, exportieren, in der Bibliothek holen und das PDF zuordnen.
- Aus Zotero und Ordnern importieren, Notizen führen und eine Literaturmatrix pflegen.
- Claude kompilieren, Log und gerenderte Seiten sehen und Folien bauen lassen.
- Zahlen aus `ergebnisse.tex` nutzen und bei frei getippten Zahlen gewarnt werden.
- KI-Nutzung als Text exportieren.
- Semantische Suche als Betreiber einschalten.

## Zustände der Oberfläche
Suche: leer, lädt, Dienst nicht erreichbar, Limit erreicht, viele Treffer mit Seiten. Beschaffungsliste: leer, teilweise erledigt. Matrix: leer und 300 Zeilen. Semantik: aus, indexiert mit Fortschritt, fertig.

## Decisions
- Es gelten `docs/adr` und `docs/mcp-vertrag.md` sowie alle Entscheidungen aus P1.
- `.bib`-Einträge kommen aus DOI-Metadaten, nie vom Modell.
- arXiv: höchstens eine Anfrage alle 3 Sekunden über die ganze Installation. Keine nutzerübergreifende Volltext-Ablage. Metadaten dürfen geteilt werden.
- OpenAlex und Semantic Scholar laufen serverweit gedrosselt und mit Cache. Fehlt ein Key, zeigt spur den Hinweis und nutzt die anderen Dienste.
- Semantic Scholar wird namentlich genannt, wo Ergebnisse von dort stammen.
- Open Access heißt nicht wiederverwendbar. spur zeigt nur den Status, keine Lizenzaussage.
- Bibliothek: eine URL-Vorlage mit `{doi}`, Standard `https://doi.org/{doi}`. spur verlinkt nur und ruft nichts ab.
- Import baut auf `modules/zotero` auf. Bestehende Keys bleiben erhalten.
- Zahlen: Claude rechnet lokal, `ergebnisse.tex` läuft über `doc_create` und `doc_edit` als Track Change. Die Warnung ist eine Heuristik und gilt für Claudes Fließtext, nicht für Mathe, Seitenzahlen und Jahre.
- KI-Offenlegung nennt Zweck, Dateien, Läufe, Annahmequote, Modell nur, wenn gemeldet, sonst Freitext.
- Semantische Suche: Schalter `SPUR_SEMANTIC_SEARCH`, Standard aus. Modell `multilingual-e5-small` mit Transformers.js, geladen beim Einschalten in ein Volume. Vektoren als Binärfeld in Mongo, Brute Force. Treffer sind nie ein Prüfbeleg.
- Lange Aufgaben liefern ein Job-Handle.

## Testbarkeit
Wie P1, dazu `SPUR_PAPER_API_BASE` mit aufgezeichneten Antworten aller Dienste und `SPUR_FAKE_EMBEDDINGS=1`. Der Test mit echtem Modell läuft einmal von Hand außerhalb der Sandbox.

## Access
- `OPENALEX_API_KEY`
- `SEMANTIC_SCHOLAR_API_KEY`
- `UNPAYWALL_EMAIL`
- `CROSSREF_MAILTO`

## Quality bar
Wie P1. Zusätzlich: Listen paginiert, Dienstfehler nennen den betroffenen Dienst, kein Absturz bei Teilausfall.

### Tests (TDD)
- Test zuerst: Für jede neue oder geänderte Server-Logik entsteht zuerst ein roter Unit-Test (vitest unter `modules/spur/test/unit`), dann der Code, der ihn grün macht. Jeder behobene Fehler bekommt zuerst einen Test, der ihn nachstellt.
- Jede neue Oberfläche bekommt Frontend-Tests im Stil von Overleafs Frontend-Tests (Komponente rendern, bedienen, Ergebnis prüfen), dazu ihre Schritte in der E2E-Suite `test/e2e/spur-e2e.js`.
- Jedes Feature erweitert die E2E-Suite um seine Schritte; die Suite läuft nach `vorbereiten.mjs` vollständig grün.
- Overleafs eigene Suiten (web Unit, Frontend, document-updater) bleiben grün bis auf die Liste bekannter Upstream-Fehler im Repo; ein neuer roter Test dort ist ein Fehler dieses Plans.
