# Fortschritt P8

## Entscheidungen im Lauf (umkehrbar)
- f1: Die Kette Crossref → doi.org → DataCite steckt in `Crossref.pruefen`; `Crossref.werk` bleibt reines Crossref
  (Quellen-Aufnahme und PDF-Metadaten nutzen weiter Crossref bzw. die arXiv-API). Das Ergebnis von doi.org/DataCite
  liegt im selben Cache unter `ra:<doi>`; nicht erreichbar wird nie gecacht. Andere Registrierstellen heißen
  `referenz: "registriert"` (neu), DataCite `referenz: "gefunden"` mit `registrierstelle: "datacite"`.
- f1: DOIs werden je Pfadteil kodiert (der Schrägstrich bleibt), Teile `.`/`..` werden ohne Abruf als nicht
  registriert behandelt. Ältere E2E-Schritte (f7, p6f4) erwarten jetzt „DOI nicht registriert“ statt „DOI bei
  Crossref unbekannt“.
- f2: `markiert` = geprüfte Stellen mit `problem: true`; eine Stelle mit Quelle, aber ohne Wortlaut, bekommt
  `status: "beleg_ohne_wortlaut"`, `grund: "kein_wortlaut"`. Die genaue Kopfzeile von „E2E Bericht“ prüft f7 gleich
  nach dem Öffnen (frische Daten, `ZAEHLUNG_BERICHT`, gezählt: 3 markiert); p8f2 vergleicht die Zahl mit dem Filter
  und `check_report`, weil f7 das Projekt danach ändert.
- f3/f4: Erkannt werden `\newcommand`, `\renewcommand`, `\providecommand`, `\def` und `\NewDocumentCommand` in
  allen `.tex`-Dateien des Projekts (nicht in `.sty`). Die Listen liegen in `spurSettings` als `pruefMakros` am
  Projekt-Eintrag (`userId: null`), Route `GET|PUT /spur/project/:id/pruefbericht/makros` (PUT nur mit Schreibrecht).
  Die Eingabe trennt Namen an Komma oder Leerraum. Die Schreibsperre lädt das Projekt jetzt, sobald der geänderte
  Bereich einen Befehl oder „ enthält (vorher nur bei bekannten Zitatbefehlen), damit eigene Makros greifen.
- E2E: Das run-code-Werkzeug bricht nach 60 s ab. Die Suite läuft darum im Hintergrund des Playwright-Prozesses
  (Wrapper mit `page.__e2e`, Ergebnis per zweitem Aufruf abgefragt); der Wrapper liegt im ignorierten
  `.playwright-mcp/`.
- Einzelne Testdateien laufen mit `spur-dev upstream web|frontend modules/spur/test/...` (Ergebnis in
  `/root/.cache/spur-dev/upstream/aktuell/*.json`).

## Handprüfungen nach dem Merge
- f1: `https://doi.org/doiRA/10.48550/arXiv.2401.01234` und `https://api.datacite.org/dois/10.48550/arXiv.2401.01234`
  gegen die echten Hosts (Antwortformat und Schrägstrich im Pfad; offline nicht prüfbar).

## Needs decision

## Vorschläge (außerhalb dieses Plans)
