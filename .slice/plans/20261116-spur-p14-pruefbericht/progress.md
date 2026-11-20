# Fortschritt P14

## Entscheidungen (umkehrbar)
- Transkripte (VTT) ohne Versatz bleiben bei der Seite `nicht_pruefbar`; die PDF-Seitenbasis gilt nur für PDFs (die Spec nennt nur PDF-Seiten).
- Nach dem Zitat zählt als reine Seitenangabe `(S.~x)`, `(p. x)`, `(pp. x)` und `(x)`.
- Auch großgeschriebene Autor-im-Satz-Befehle (`\Citet`, `\Citeauthor`, `\Nptextcite`) leiten ein Zitat ein.
- Nennt der nachfolgende Beleg denselben Key ohne Seite, gilt die Seite des vorangestellten Befehls.
- Ein `\textcite` & Co., auf das im selben Satz ein eigenes Zitat folgt, belegt nicht das vorige Zitat; ein Beleg nach einer Leerzeile (neuer Absatz) gehört nie zum Zitat davor. Beides fiel im E2E-Lauf auf: Sonst verschwand das zweite Zitat.
- Mehrere Keys mit Wortlaut, der in keiner Quelle steht: Der Befund hängt am ersten Key mit Quelle.
- Zeilen-IDs: Die erste Zeile einer Stelle behält ihre bisherige ID, weitere Keys bekommen eine eigene.
- Der Prüfcache trägt eine Versionsnummer der Prüflogik (`PRUEFLOGIK`), damit gespeicherte Abschnitte mit alter Bewertung nicht weiter gelten.
- `bibBereichPruefen` meldet bei Mehrfachzitaten nur die Zeilen der geänderten Einträge.

## Angepasste ältere Tests
- `\footfullcite` war in älteren Tests (Unit, E2E, Testdaten „E2E Bericht“) das Beispiel für eine unbekannte Zitierform. Die Spec macht es zu einem bekannten Befehl; die Tests nutzen jetzt `\meincite`.
- `f7` (E2E Bericht): Die zurückgezogene Quelle hat keine PageLabels. Ihre Seite war „nicht prüfbar“, jetzt gilt nach der Spec die PDF-Seite: „PDF-Seite: stimmt“.
- Unit-Test „kann die Seite ohne Versatz nicht prüfen“: Ohne Versatz prüft spur jetzt gegen die PDF-Seite (Spec, Annahme „Seite ohne gedruckte Seitenzahlen“).

## Abschluss
- /simplify (4 Prüfer): übernommen `klammerEnde` aus latex.mjs statt Kopie, Mathe-Umgebungen nur einmal, Lage im Dokument nur bei Zahlen, Wortlaut je Key bis zum ersten Treffer, Zeilen-ID aus Position und Key, Set statt Flag für \textquote/\blockquote ohne Beleg. Nicht übernommen: Neuentwurf der Zitat-Beleg-Zuordnung als eigener Nachlauf und Lage über den Lezer-Parser (große Umbauten, als Vorschlag notiert).
- /code-review medium auf `b1c2658728..HEAD` (nur P14; die formale Plan-Basis enthält die eingemergten Pläne P12, P13, P16): behoben, dass `\resizebox`/`\scalebox` ihren Inhalt aus der Zahlenprüfung nahmen, und Phantom-Keys bei Mehrfachzitaten mit Klammer nach Leerraum. Nicht geändert, weil die Spec es so festlegt: PDF-Seitenbasis auch bei bekannter, aber unpassender Crossref-Spanne; Zahlen direkt vor Einheiten auch im Fließtext; Satzende-Regel ohne Abkürzungsliste; Lage nach der Startposition.
- /security-review (P14-Diff): keine Befunde mit hoher Konfidenz.
- Gesamtlauf E2E nach der letzten Codeänderung: 119 ok, `p16f1b` übersprungen (Dev-Image älter als P16, nicht P14).
- Ansichten bei 360 und 1280 px: Prüfbericht „E2E P14 Preprint“, Quellenansicht `weber2018` (Seite 41), Prüfbericht „E2E P14 Varianten“; kein horizontales Rollen.

## Vorschläge
- Zitat-Beleg-Zuordnung als ein Nachlauf über die fertige Zeilenliste statt Vorwärtssuche je Zitat mit Korrekturen (Befund aus /simplify).
- Satzende-Erkennung mit Abkürzungen („vgl.“, „Abb.“, „et al.“), damit ein vorangestelltes `\textcite` auch über solche Stellen hinweg verknüpft wird.
- Die Testdaten von „E2E P14 Varianten“ nutzen `\citealp` mit biblatex; der Bericht ist richtig, das PDF hat dort einen Compile-Fehler.

## Replies
