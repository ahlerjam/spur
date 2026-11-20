# Fortschritt P15

## Entscheidungen (umkehrbar)
- f1: `source_search` liefert wie bisher die Position des Suchbegriffs, nicht des Satzanfangs. Damit Schritt 2 (Position 6037) und Schritt 3 (Text ab 6000 enthält den Satz) beide gelten, steht in `lang2024` der Suchbegriff „persisted after twelve weeks“ bei Zeichen 6.037; der Satz beginnt 11 Zeichen davor.
- f1: `ab_zeichen` hat im Schema keine Untergrenze; ein negativer Wert ergibt im Werkzeug `eingabe_ungueltig` mit `feld: "ab_zeichen"` (wie bei `source_add`), keinen Schemafehler des MCP-SDK.
- f2: `pdftocairo -scale-to 1600` liefert 1601 px (rundet auf); das Seitenbild entsteht deshalb mit einer Auflösung aus der Seitengröße (`pdfinfo`) und einem halben Pixel Abstand zur Grenze. Transkripte (VTT) haben wie Web-Schnappschüsse keine Seitenbilder und liefern ebenfalls `quelle_ohne_seiten`.
- f2: `smith2024.pdf` hat auf PDF-Seite 4 jetzt ein Balkendiagramm (nur Vektorgrafik); der extrahierte Text aller Seiten ist byte-gleich mit vorher. Das Seitenbild habe ich angesehen: drei Balken (blau, orange, grün) mit Achsen unter dem Seitentext.

## Angepasste ältere Tests
- Unit-Test „source_read kürzt auf max_zeichen“ prüft die Antwort mit `toEqual`; sie enthält jetzt zusätzlich `ab_zeichen`, `bis_zeichen` und `zeichen_gesamt`.
- `pdf.test.mjs`: `seitenBild` nimmt die Breite jetzt als Option (`{ breite }`), weil die längste Kante (`{ kante }`) dazukam.
- E2E `f9` prüft die genaue Werkzeugliste; sie enthält jetzt die P15-Werkzeuge.

## Replies
