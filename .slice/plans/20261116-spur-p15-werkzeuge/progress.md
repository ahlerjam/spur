# Fortschritt P15

## Entscheidungen (umkehrbar)
- f1: `source_search` liefert wie bisher die Position des Suchbegriffs, nicht des Satzanfangs. Damit Schritt 2 (Position 6037) und Schritt 3 (Text ab 6000 enthält den Satz) beide gelten, steht in `lang2024` der Suchbegriff „persisted after twelve weeks“ bei Zeichen 6.037; der Satz beginnt 11 Zeichen davor.
- f1: `ab_zeichen` hat im Schema keine Untergrenze; ein negativer Wert ergibt im Werkzeug `eingabe_ungueltig` mit `feld: "ab_zeichen"` (wie bei `source_add`), keinen Schemafehler des MCP-SDK.
- f2: `pdftocairo -scale-to 1600` liefert 1601 px (rundet auf); das Seitenbild entsteht deshalb mit einer Auflösung aus der Seitengröße (`pdfinfo`) und einem halben Pixel Abstand zur Grenze. Transkripte (VTT) haben wie Web-Schnappschüsse keine Seitenbilder und liefern ebenfalls `quelle_ohne_seiten`.
- f2: `smith2024.pdf` hat auf PDF-Seite 4 jetzt ein Balkendiagramm (nur Vektorgrafik); der extrahierte Text aller Seiten ist byte-gleich mit vorher. Das Seitenbild habe ich angesehen: drei Balken (blau, orange, grün) mit Achsen unter dem Seitentext.
- f3: Die Speichergrenze des Projekts meldet bei Bildern wie überall `speicher_voll` (die Spec nennt `projekt_voll`; das ist in spur die Grenze für `tex-pakete/`). Die Zahl der Einträge meldet `projekt_zu_viele_dateien`.
- f3: Legt eine Bilddatei einen Ordner neu an (etwa `abbildungen/`), merkt sich der Lauf ihn; „Lauf rückgängig“ entfernt ihn nur, wenn danach nichts mehr darin liegt. So verschwindet der Ordner aus dem Dateibaum, ohne eigene Dateien der Person zu löschen.
- f3: Der Upload-Link für Projektdateien nutzt dieselbe Adresse wie für Quellen (`/spur/hochladen/<token>`); der Link merkt sich seine Art. Ein Quellen-Link mit `projektdatei` antwortet `falscher_link`, ein Datei-Link ohne `projektdatei` `eingabe_ungueltig`. Fehler kommen als Problem-JSON mit Status (422, 413, 409), damit `spur-hochladen` den Grund ausgibt.
- f3: `spur-hochladen --projektdatei` gilt für genau eine Datei; die Ausgabe lautet `<datei>: Datei <pfad>`.
- f3: Pfade für Projektdateien: Abschnitte aus Buchstaben, Ziffern, Leerzeichen und `-_.()`, nicht mit Punkt oder Leerzeichen beginnend, höchstens 200 Zeichen. Der Dateityp muss zur Endung passen (ein PNG mit `.jpg` ist `dateityp_nicht_erlaubt`), weil pdfLaTeX den Typ an der Endung erkennt.
- f3: `quellenangabe` lautet `Aus \textcite{<key>}, S. <PDF-Seite>, Lizenz <Name>.`; Unpaywall-Angaben wie `CC-BY-4.0` oder `pd` werden auf `cc-by` bzw. `public-domain` normalisiert.
- f4: Mit `alle_vorkommen` zählt jede Ersetzung als eigene Änderung des Laufs (Laufkarte „Änderungen: 12“); ohne den Parameter bleibt es eine je `doc_edit`. Überlappende Treffer zählen einmal (wie `replaceAll`). Ein leerer Alttext mit `alle_vorkommen` ist `eingabe_ungueltig` (`feld: "alt"`). Die Grenze offener Changes (1990) prüft der neue Modus samt der neuen Changes, der alte Weg bleibt unverändert.
- f4: Im Browser nimmt die E2E die 12 Ersetzungen erst mit „Alle annehmen“ an; „Lauf rückgängig“ zeigt die Karte nur für angenommene Läufe (wie bisher), danach stehen alle 12 `fill=blue!20` wieder da.
- f5: Eine Bearbeitung (`doc_edit`) erkennt spur am Seed ihrer Change-IDs (`tc` in `spurUpdate`, RangesTracker setzt ihn vor jede ID). Der Lauf merkt sich je Bearbeitung `{seed, anzahl, rot}`, angenommene Changes ihren Seed. `offen` kommt live aus den Track Changes im Dokument, also stimmt es auch nach dem Annehmen im Browser. `rot` bleibt nach dem Annehmen stehen (Zahl der rot markierten Änderungen des Laufs); der Satz im `hinweis` nennt nur offene rote.
- f5: `hinweis` nutzt Zahlwörter bis zwölf (aus `spur_zahlwoerter` der Sprachdatei), darüber Ziffern. Ohne Lauf (nur `reply` legt keinen an) liefert `run_status` `lauf: null`, `aenderungen.gesamt: 0` und einen Satz ohne Zahlen.
- f5: Die Laufkarte zeigt „2 automatisch angenommen, 1 offen“ unter „Dateien · Änderungen“, nur wenn der Lauf etwas geändert hat.
- f6: `tex_file_read` nimmt zusätzlich `project_id` (Leserecht): Dateien aus `tex-pakete/` des Projekts werden zuerst gefunden, dafür braucht das Werkzeug das Projekt. Die Antwort nennt `herkunft` (`projekt` oder `installation`).
- f6: `kpsewhich` läuft aus einem leeren Ordner (es sucht sonst auch im Arbeitsordner des Servers); ein Treffer außerhalb von `SELFAUTOPARENT` und `TEXMFLOCAL` gilt als nicht gefunden. Ungültige Namen erreichen `kpsewhich` nicht. Im CLSI-Log stand nach dem E2E-Lauf kein Zugriff auf `/etc` (`spur-dev logs clsi`).
- f6: Antwortet ein Spiegel mit 404, fragt spur sofort den nächsten; `paket_unbekannt` erst, wenn alle 404 melden. 404 auf dem einen und Ausfall auf dem anderen Spiegel ergibt `spiegel_nicht_erreichbar`, weil spur dann nicht weiß, ob es das Paket gibt. Der TeX-Live-Fake liefert `spurzwei` nur auf dem zweiten Spiegel.

## Needs decision
- f5: Soll eine Zahl ohne Beleg eine Änderung rot machen (nie automatisch angenommen)?
  Interim: Wie bisher (Entscheidung „Auto-Annahme bleibt, wie sie ist“) bleibt nur ein Zitat-Prüfbefund rot; Zahlen ohne Beleg werden gemeldet und trotzdem automatisch angenommen. Die E2E-Ausgangslage von f5 nutzt deshalb als rote Änderung ein nicht prüfbares Zitat (`\meincite{smith2024}`) statt einer Zahl ohne Beleg.
  Options: A (empfohlen) so lassen, Zahlen bleiben ein Hinweis | B Zahlen ohne Beleg wie rote Zitate nie automatisch annehmen

## Angepasste ältere Tests
- `texPaketeHinzufuegen.test.mjs`: „meldet ein unbekanntes Paket ohne Wiederholung und ohne zweiten Spiegel“ fragt jetzt laut Spec auch den zweiten Spiegel (Backlog-Punkt).
- `laufAktionen.test.mjs`: `laufDaten` liefert am Lauf zusätzlich `stand`; angenommene Changes tragen `seed`. `werkzeuge.test.mjs`: `run_status`/`run_finish` liefern zusätzlich `aenderungen` und `hinweis`.
- Meldung `spur_fehler_alttext_mehrfach` nennt jetzt `alle_vorkommen` (Spec); Code `konflikt` unverändert.
- Meldung `spur_fehler_link_verbraucht` nennt nicht mehr `source_upload_link`, weil es jetzt zwei Arten von Links gibt (Code `link_verbraucht` unverändert).
- Unit-Test „source_read kürzt auf max_zeichen“ prüft die Antwort mit `toEqual`; sie enthält jetzt zusätzlich `ab_zeichen`, `bis_zeichen` und `zeichen_gesamt`.
- `pdf.test.mjs`: `seitenBild` nimmt die Breite jetzt als Option (`{ breite }`), weil die längste Kante (`{ kante }`) dazukam.
- E2E `f9` prüft die genaue Werkzeugliste; sie enthält jetzt die P15-Werkzeuge.

## Abschluss
- Prüfbereich: Die formale Plan-Basis (`0ad7efe`, Elternteil von `slice: plan …p15`) enthält die schon geprüften Pläne P12–P14 und P16. /simplify, /code-review und die Sicherheitsprüfung laufen deshalb auf dem Diff dieses Laufs, `44fa98d70b..HEAD`.
- /simplify (vier Prüfer): übernommen: Upload-Link speichert seine Höchstzahl (`max`) und verbraucht mit `$expr` statt `$or` je Art; eine Lizenzliste statt zwei; Cache-Suffix der Seitenbilder aus der Größe abgeleitet; TeX-Wurzeln für `tex_file_read` einmal je Prozess ermittelt; `dateityp` und `pfadPruefen` ohne überflüssige Bedingungen. Nicht übernommen: eine Prüfung über die ganze Spanne statt je Vorkommen bei `alle_vorkommen` (die Spec verlangt die Prüfung jedes Vorkommens; eine Spanne würde unveränderte Zitate dazwischen mitprüfen); Ordner als eigener Eintrag `art: 'ordner'` (würde beim Rückgängigmachen auch Dateien der Person im Ordner löschen); Change-IDs statt Seed (Changes werden beim Tippen geteilt und bekommen neue IDs, der Seed ist der stabile Schlüssel, den spur selbst vergibt); gemeinsamer Helfer für Projektpfade und Temp-Ordner (Umbau über den Diff hinaus, als Vorschlag notiert).

## Vorschläge
- Ein Helfer `projektPfade(projectId)` neben `projektEintraege.mjs` für die drei Stellen, die `getAllEntities` zu einer Pfadliste machen (TexPakete, Projektdatei, LaufAktionen), und ein `mitTempOrdner(prefix, fn)` für das wiederkehrende mkdtemp/rm.
- `bereichPruefen` lädt Projekt und Kontext je Aufruf; bei `alle_vorkommen` mit vielen Treffern, die Zitate berühren, wären Dokumente und Kontext einmal zu laden.

## Replies
