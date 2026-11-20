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

## Angepasste ältere Tests
- Meldung `spur_fehler_link_verbraucht` nennt nicht mehr `source_upload_link`, weil es jetzt zwei Arten von Links gibt (Code `link_verbraucht` unverändert).
- Unit-Test „source_read kürzt auf max_zeichen“ prüft die Antwort mit `toEqual`; sie enthält jetzt zusätzlich `ab_zeichen`, `bis_zeichen` und `zeichen_gesamt`.
- `pdf.test.mjs`: `seitenBild` nimmt die Breite jetzt als Option (`{ breite }`), weil die längste Kante (`{ kante }`) dazukam.
- E2E `f9` prüft die genaue Werkzeugliste; sie enthält jetzt die P15-Werkzeuge.

## Replies
