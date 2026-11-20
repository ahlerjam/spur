# Fortschritt P15

## Entscheidungen (umkehrbar)
- f1: `source_search` liefert wie bisher die Position des Suchbegriffs, nicht des Satzanfangs. Damit Schritt 2 (Position 6037) und Schritt 3 (Text ab 6000 enthält den Satz) beide gelten, steht in `lang2024` der Suchbegriff „persisted after twelve weeks“ bei Zeichen 6.037; der Satz beginnt 11 Zeichen davor.
- f1: `ab_zeichen` hat im Schema keine Untergrenze; ein negativer Wert ergibt im Werkzeug `eingabe_ungueltig` mit `feld: "ab_zeichen"` (wie bei `source_add`), keinen Schemafehler des MCP-SDK.

## Angepasste ältere Tests
- Unit-Test „source_read kürzt auf max_zeichen“ prüft die Antwort mit `toEqual`; sie enthält jetzt zusätzlich `ab_zeichen`, `bis_zeichen` und `zeichen_gesamt`.

## Replies
