# Fortschritt P9

## Ausgangslage
- Volle E2E-Suite vor jeder Änderung (2026-11-13): alles grün bis auf `p6f3` (Timeout 5 s auf „Claude wird
  benachrichtigt“ im Review-Panel). Wird im Abschluss erneut geprüft.

## Entscheidungen im Lauf (umkehrbar)
- f1: spur-Dialoge nutzen Overleafs `themed`-Modal (wie „Projekt teilen“). „Schließen“, „Speichern“, „Kopieren“
  kommen aus Overleafs Schlüsseln `close`, `save`, `copy`, `copied`; die spur-Duplikate sind entfernt. Dialoge mit
  Hauptaktion (Holen, Löschen, Webseite) schließen mit „Abbrechen“.
- f1: Innenabstand der Panels = Overleafs Kopfzeile (`$spur-rand`, `--spacing-04`). Überschriften in Panels ab h5.
  `tools/tests/oberflaeche.test.mjs` prüft Farben, doppelte Selektoren und die entfernten Schlüssel.
- f2: Die Liste bleibt nach Dateinamen sortiert. Der Eintrag ist ein Knopf mit dem Titel; trägt die Quelle Metadaten,
  steht der Dateiname versteckt im zugänglichen Namen (unterscheidet gleiche Titel, ältere Schritte finden ihn).
  Suchtreffer im Text bringen ihre Quelle mit, damit Treffer jenseits der geladenen Liste öffnen.
- f3: Seitenbilder werden in der gezeigten Breite (Gerätepixel, auf 200 px aufgerundet, höchstens 4800) gerendert und
  je Breite abgelegt. Über dem Bild liegt eine durchsichtige Textebene aus `pdftotext -bbox-layout` (Route
  `…/seiten/:seite/textebene`); Scans haben keine Lage, ihr erkannter Text steht aufklappbar unter dem Bild.
  100 % heißt „An Breite anpassen“. Die Seitenleiste merkt sich ihren Zustand je Person im `localStorage`.
  Testschalter `SPUR_SEITENBILD_FEHLER` (Fake-Steuerung) lässt das Seitenbild scheitern.

- f4: Filter „Ohne Quelle“ und „Nicht prüfbar“ folgen dem Status der Stelle, „Markiert“ dem Feld `problem`. Der
  Tooltip im Editor nennt die roten und gelben Befunde derselben Stelle (Texte aus `pruefung/befunde.ts`, wie die
  Abzeichen). Den leeren Filter prüft die E2E im neuen Projekt „E2E Bericht Grün“, weil „E2E Bericht“ in jedem Filter
  Treffer hat.
- f5: Der Schalter nutzt die vorhandene Einstellung `autoAnnehmen` (je Projekt und Person), darum keine Migration. Er
  wirkt nur beim Schreiben; `run_finish` nimmt nichts mehr nach, setzt aber einen Lauf ohne offene Changes auf
  „angenommen“. Rot im Sinne der Annahme: unbekannte Zitierform, Wortlaut nicht prüfbar, DOI unbekannt, Quelle
  zurückgezogen (abweichender Wortlaut und fehlende Quelle weist `doc_edit` wie bisher ab). Die IDs roter Changes stehen
  am Lauf (`rotAenderungen`); Schalter und Sammelannahme lassen sie aus. Die Sammelannahme lässt einen noch offenen Lauf
  offen. „Lauf rückgängig“ nimmt Angenommenes stapelweise vom jüngsten zum ältesten zurück, nach einem Probelauf ohne
  die offenen Changes; passt der volle Kontext (40 Zeichen) nicht, sucht es mit 20 und 10 Zeichen auf beiden Seiten.
  E2E nutzt das neue Projekt „E2E Automatik“, weil ältere Features „E2E Lauf“ in festem Zustand erwarten.
- f6: Startbefehl „bekannt“ merkt sich der Browser je Person (`localStorage`). Testschalter `SPUR_CLAUDE_FEHLER`
  lässt die Abfrage des Panels scheitern; `SPUR_AUTOMATIK_FEHLER` das Speichern des Schalters.
- f8: Testschalter `SPUR_MATRIX_FEHLER` (Zelle speichern) und `SPUR_PRUEFBERICHT_FEHLER` (Zahl im Löschdialog).
- f9: Beide Admin-Seiten teilen `.spur-admin-seite` (1100 px) und `.spur-admin-abschnitt`. Suche und Blättern (50) der
  Nutzertabelle laufen im Browser über die schon geladenen Daten.
- f10: 196 deutsche Schlüssel ergänzt (Liste der Flächen in `tools/tests/sprache.test.mjs`). Relative Zeiten über
  Momentjs mit deutscher Locale; „von dir“ über den neuen Schlüssel `last_updated_date_by_you`. „Papierkorb“ statt
  „Löschen“ für `trash`.
- f11: Grund und Füllung des Schriftzugs sind zwei gleiche Spans in einer Box; die Füllung wird mit `clip-path` von unten
  freigelegt.
- E2E: Der Lauf hebt vor jedem Feature alle `page.route` auf (eine angehaltene Route aus einem abgebrochenen Schritt hielt
  sonst jede spätere Anfrage fest). Fehlermeldungen nennen die Zeilen im Stapel.

## Needs decision

## Vorschläge (außerhalb dieses Plans)
