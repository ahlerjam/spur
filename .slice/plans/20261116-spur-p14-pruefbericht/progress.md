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

## Replies
