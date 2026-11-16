Type: api, web

# spur P15: Werkzeuge, die Claude beim Arbeiten gefehlt haben

## Zweck
Claude konnte lange Quellenseiten nicht zu Ende lesen, Abbildungen in Quellen nicht ansehen, keine Bilder ins Projekt legen, für eine Farbumstellung rund 20 Einzel-Edits brauchen, den Stand eines Laufs nicht deuten und die Klassendatei `apa7.cls` nicht nachschlagen. Dieser Plan ergänzt die Werkzeuge dafür.

## Nutzer
Claude als MCP-Client und die Forschenden, die mit ihm in spur schreiben.

## Was Nutzer danach können
- Jede Stelle einer Quellenseite lesen, auch hinter Zeichen 4.000.
- Eine Quellenseite als Bild ansehen, etwa eine Abbildung oder Tabelle.
- Abbildungen als Bilddatei ins Projekt legen: eigene vom Rechner oder einen Ausschnitt aus einer offen lizenzierten Quelle mit fertiger Quellenangabe.
- Ein Muster an allen Stellen eines Dokuments in einem Schritt ersetzen.
- Am Lauf erkennen, was automatisch angenommen wurde und was noch zur Prüfung steht.
- Dateien der TeX-Installation lesen, um das Verhalten einer Klasse zu verstehen.
- Pakete auch dann nachladen, wenn der erste Spiegel sie nicht hat.

## Context
- `source_read` (`mcp/werkzeuge.mjs`): Parameter `pdf_seite` und `max_zeichen`, Obergrenze `MAX_QUELLTEXT = 4000`, immer ab Seitenanfang; `gekuerzt` zeigt die Kürzung. `source_search` liefert Positionen (echter Fall: Treffer an Position 4858 und 6037 waren nicht lesbar).
- `page_image` rendert nur das zuletzt kompilierte `output.pdf` (`kompilieren/Kompilieren.mjs`). Seitenbilder von Quellen gibt es als Web-Route für die Vorschau (`SpurRouter.mjs`), nicht über MCP.
- `doc_create` erlaubt nur `.tex`, `.bib`, `.txt`, `.md`. Binärdateien sind in Overleaf Projektdateien, keine Dokumente; Track Changes gibt es dafür nicht. `tex_package_add` legt bereits Dateien an, die zum Lauf gehören und mit „Lauf rückgängig“ verschwinden.
- Quellen liegen außerhalb des Projektbaums (ADR 0005). Eine Quelle trägt `nurProjekt`, wenn Unpaywall keine Lizenz nennt; die Lizenz selbst wird bisher nicht dauerhaft gespeichert (prüfen, sonst ergänzen).
- `doc_edit` (`schreiben/SchreibManager.mjs`): Der Alttext muss genau einmal vorkommen, sonst `konflikt` (`spur_fehler_alttext_mehrfach`). Echter Fall: rund 20 Edits für eine Farbumstellung.
- Läufe (`schreiben/LaufAktionen.mjs`): `sofortAnnehmen` nimmt Änderungen direkt nach `doc_edit` an, rot markierte nie (ADR 0002, Nachtrag). Der Lauf steht danach auf `angenommen`. Echter Fall: Claude wusste nicht, ob die Änderungen noch als Track Changes zur Prüfung stehen.
- TeX: Claude wollte `apa7.cls` von CTAN laden, um die Beschriftung „Note.“ und einen Fehler bei leeren Deckblattfeldern zu verstehen; der Abruf scheiterte. Die Datei liegt im Image.
- `tex_package_add` (`kompilieren/TexPakete.mjs`) versucht den zweiten Spiegel nur bei 5xx und Netzfehlern, nicht bei 404 (Backlog).

## Decisions
Owner-Entscheidungen (2026-11-16):
- `source_read` bekommt den Startpunkt `ab_zeichen`; Quellenseiten sind als Bild abrufbar.
- Bilder im Projekt: PNG, JPG und PDF. Abbildungen aus Quellen nur bei offener Lizenz und mit Quellenangabe; sonst zeichnet Claude nach oder nennt den Rechtevorbehalt.
- `doc_edit` bekommt einen Modus für alle Vorkommen in einem Track Change.
- Auto-Annahme bleibt, wie sie ist; `run_status` und `run_finish` melden den Stand klar.
- Ein Werkzeug liest Dateien der TeX-Installation.
- `tex_package_add` versucht bei 404 den zweiten Spiegel.
Annahmen (ohne Rückfrage getroffen):
- `source_read`: neuer optionaler Parameter `ab_zeichen` (ganze Zahl ≥ 0, Standard 0). Die Antwort nennt `ab_zeichen`, `bis_zeichen`, `zeichen_gesamt` und `gekuerzt`. Ein Wert hinter dem Seitenende ergibt leeren Text mit `zeichen_gesamt`, keinen Fehler. Die Positionen sind dieselben, die `source_search` liefert; die Obergrenze je Aufruf bleibt 4.000.
- Neues Werkzeug `source_page_image` (`project_id`, `quelle_id`, `pdf_seite`): liefert die Seite als PNG wie `page_image`, längste Kante höchstens 1.600 px. Für Web-Schnappschüsse ohne Seiten: 409 `quelle_ohne_seiten`. Seite außerhalb des Dokuments: 404 `seite_nicht_gefunden` mit der Seitenzahl der Quelle.
- Neues Werkzeug `source_figure_add` (`project_id`, `quelle_id`, `pdf_seite`, `ausschnitt` als `{x, y, breite, hoehe}` in Anteilen 0–1 der Seite, `pfad` im Projekt mit Endung `.png`): legt den Ausschnitt mit 300 dpi als Projektdatei an. Nur wenn die Quelle eine der Lizenzen CC BY, CC BY-SA, CC BY-NC, CC BY-NC-SA, CC0 oder „public domain“ trägt; sonst 409 `lizenz_fehlt` mit dem Satz, dass die Abbildung nachgezeichnet („in Anlehnung an“) oder die Erlaubnis eingeholt werden muss. Lizenzen mit „ND“ gelten als nicht offen, weil ein Ausschnitt eine Bearbeitung ist. Die Antwort nennt `lizenz` und unter `quellenangabe` eine fertige Zeile für die Bildunterschrift mit `\textcite`-Key, PDF-Seite und Lizenz. Die Lizenz wird beim Aufnehmen an der Quelle gespeichert; Quellen von vor dem Update haben keine und liefern `lizenz_fehlt`.
- Eigene Bilder: `source_upload_link` bleibt für Quellen. Neues Werkzeug `file_upload_link` (`project_id`) liefert einen Einmal-Link (15 Minuten, bis 20 Dateien); `spur-hochladen <link> bild.png --projektdatei abbildungen/bild.png` legt die Datei im Projekt ab. Erlaubt: `.png`, `.jpg`, `.jpeg`, `.pdf`, je höchstens 10 MB, geprüft am Dateianfang, nicht an der Endung; sonst `dateityp_nicht_erlaubt` bzw. `zu_gross`. Existiert der Pfad, `konflikt`.
- Bilddateien gehören zum Lauf wie die Dateien von `tex_package_add`: Die Laufkarte listet sie, „Lauf rückgängig“ entfernt sie. Die Grenzen `projekt_zu_viele_dateien` und `projekt_voll` gelten.
- ADR 0005 bekommt einen Nachtrag: Quellen bleiben außerhalb des Projektbaums; ein Ausschnitt daraus wird nur bei offener Lizenz zur Projektdatei.
- `doc_edit`: neuer Parameter `alle_vorkommen: true`. Dann darf der Alttext mehrfach vorkommen; alle Vorkommen werden ersetzt und erscheinen als Track Changes desselben Laufs. Die Antwort nennt `ersetzt` (Anzahl). 0 Vorkommen ergibt wie bisher den Fehler für nicht gefundenen Alttext. Höchstens 500 Vorkommen je Aufruf, darüber 422 `zu_viele_vorkommen` mit der Zahl. Die Prüfungen auf erfundenen Wortlaut und unbelegte Zahlen laufen über den neuen Text jedes Vorkommens; schlägt eine fehl, wird nichts geschrieben. Ohne den Parameter bleibt das Verhalten unverändert, und die Fehlermeldung bei mehrfachem Alttext nennt den neuen Parameter.
- `run_status` und `run_finish` liefern zusätzlich `aenderungen` mit `gesamt`, `automatisch_angenommen`, `offen` (als Track Change sichtbar), `rot` (wegen eines Prüfbefunds nie automatisch angenommen) und einen Satz `hinweis`, der den Stand in Worten sagt und nennt, dass „Lauf rückgängig“ auch angenommene Änderungen zurücknimmt. Die Laufkarte im Browser zeigt dieselben drei Zahlen.
- Neues Werkzeug `tex_file_read` (`name`, optional `ab_zeile`): sucht die Datei über den Dateinamen in der TeX-Installation des Kompilierdienstes (wie `kpsewhich`), liefert Pfad, Zeilenzahl und bis zu 40.000 Zeichen ab `ab_zeile`. Erlaubte Endungen: `.cls`, `.sty`, `.bst`, `.bbx`, `.cbx`, `.lbx`, `.def`, `.cfg`, `.clo`, `.tex`, `.ldf`. Nur Dateinamen ohne Pfadanteile; alles andere 422 `eingabe_ungueltig`. Nicht gefunden: 404 `tex_datei_nicht_gefunden` mit dem Hinweis auf `tex_package_add`. Dateien aus `tex-pakete/` des Projekts werden zuerst gefunden. Kein Zugriff außerhalb des TeX-Baums.
- `tex_package_add`: Antwortet der erste Spiegel mit 404, wird der zweite gefragt; erst wenn beide 404 liefern, gilt das Paket als nicht vorhanden.

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
- Die E2E-Suite bekommt je Feature Schritte (`p15f1` …) und läuft nach dem Zurücksetzen der Testdaten vollständig grün, auch alle älteren Features.
- `spur-dev test` bleibt über 80 % Zeilenabdeckung; `node --test tools/tests/*.test.mjs` ist grün (auch der Vertragstest `mcp-vertrag.test.mjs`).
- Overleafs eigene Suiten bleiben grün bis auf die bekannte Upstream-Liste.
