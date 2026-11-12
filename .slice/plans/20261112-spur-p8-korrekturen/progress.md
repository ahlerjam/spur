# Fortschritt P8

## Entscheidungen im Lauf (umkehrbar)
- f1: Die Kette Crossref → doi.org → DataCite steckt in `Crossref.pruefen`; `Crossref.werk` bleibt reines Crossref
  (Quellen-Aufnahme und PDF-Metadaten nutzen weiter Crossref bzw. die arXiv-API). Das Ergebnis von doi.org/DataCite
  liegt im selben Cache unter `ra:<doi>`; nicht erreichbar wird nie gecacht. Andere Registrierstellen heißen
  `referenz: "registriert"` (neu), DataCite `referenz: "gefunden"` mit `registrierstelle: "datacite"`.
- f1: DOIs werden je Pfadteil kodiert (der Schrägstrich bleibt), Teile `.`/`..` werden ohne Abruf als nicht
  registriert behandelt. Ältere E2E-Schritte (f7, p6f4) erwarten jetzt „DOI nicht registriert“ statt „DOI bei
  Crossref unbekannt“.
- Einzelne Testdateien laufen mit `spur-dev upstream web|frontend modules/spur/test/...` (Ergebnis in
  `/root/.cache/spur-dev/upstream/aktuell/*.json`).

## Handprüfungen nach dem Merge
- f1: `https://doi.org/doiRA/10.48550/arXiv.2401.01234` und `https://api.datacite.org/dois/10.48550/arXiv.2401.01234`
  gegen die echten Hosts (Antwortformat und Schrägstrich im Pfad; offline nicht prüfbar).

## Needs decision

## Vorschläge (außerhalb dieses Plans)
