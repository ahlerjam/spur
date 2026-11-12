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
- f6: Installiert ist ein Paket, wenn es einen Eintrag in `spurTexPackages` hat und sein Ordner Dateien enthält; der
  Eintrag und der Eintrag am Lauf entstehen erst nach dem letzten Upload. Ein Ordner ohne Eintrag ist ein Rest und wird
  vor der Installation entfernt. Je Projekt und Paket läuft ein Aufruf (Sperre in `spurDrossel`, `_id`
  `tex-sperre:<projekt>:<paket>`, nach 10 min veraltet); ein zweiter wartet und sieht das Ergebnis. Upload-Fehler
  rollen zurück (auch `tex-pakete/`, wenn sonst leer) und melden `paket_abgebrochen`. Ein Abbruch beim Client bricht
  die Installation nicht ab. Die Testschalter `SPUR_TEX_UPLOAD_FEHLER` und `SPUR_TEX_UPLOAD_PAUSE_MS` gelten nur im
  Dev-Stack über die Fake-Steuerung (`testSchalter`), nie aus der Umgebung.
- f6: Der TeX-Live-Fake hängt jetzt unter dem Paper-Fake (`/spur/dev/crossref/texlive` und `/texlive-b`), damit
  `stoerungen` je Spiegel greifen. `spurtest-riesig` ist jetzt 101 MB (p7f5 erwartet „100 MB“), neu sind
  `spurtest-gross` (30 MB entpackt) und `carlito` (fünf Dateien).
- f7: Die Drossel zählt gelungene Installationen in `spurDrossel` (`tex-pakete:<person>`, Zeitstempel der letzten
  Stunde) statt mit Overleafs RateLimiter, weil die Grenze einstellbar ist und Fehlversuche nicht zählen.
- f7: Die Admin-API der Grenzen (`.json`, PUT, POST) antwortet Nicht-Admins mit 403 und Meldung statt mit Overleafs
  Umleitung auf `/restricted` (der ein PUT nicht folgen kann, Ergebnis war 404). Die Seite selbst leitet weiter um.
- f8: „Derselbe Aufruf zweimal“ heißt im E2E derselbe Pfad und Inhalt mit neuem Idempotenz-Schlüssel; mit demselben
  Schlüssel liefert spur wie bisher das frühere Ergebnis (`wiederholt: true`). Ein leeres Dokument aus einem
  gescheiterten Versuch wird als Rest in `spurEdits` (`schluessel: rest:<projekt>:<pfad>`) vermerkt und nur vom selben
  Bot und nur leer übernommen. Testschalter: `SPUR_DOKUPDATER_500`, `SPUR_DOC_AUFRAEUMEN_FEHLER`,
  `SPUR_DOC_CREATE_FEHLER`. Die Log-Zeile zur Fehler-ID prüft der Builder mit `spur-dev logs web` (eine Zeile mit
  `fehlerId`, `werkzeug`, `projectId`, `pfad`, `botId`, ohne Inhalt; 2026-11-12 geprüft), nicht die E2E-Suite.
- f9: `events_since` markiert gelesene Ereignisse als zugestellt; ohne Cursor liefert es die neuesten 100 (vorher die
  ältesten). Der Wecker hört jetzt ab Beginn des Wartens mit, vorher konnte ein Auftrag zwischen Abfrage und Schlaf
  bis zu 5 s liegen bleiben. Testschalter `SPUR_WARTEN_S` verkürzt die Standardzeit von 100 s.
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
