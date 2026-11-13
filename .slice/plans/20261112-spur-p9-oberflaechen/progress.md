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

## Hinweise zur Prüfung
- f11: Die Projektliste bekommt ihre Projekte mit der Seite (vorab geladen) und zeigt den Ladebildschirm darum nicht
  so lange, dass ihn die E2E halten könnte. Sie nutzt denselben Baustein (`loading-branded.tsx`) wie Editor und
  Freigabelink; die E2E misst Editor (hell, dunkel, 360 px) und Freigabelink. Die erste, vom Server gerenderte Fassung
  (`ide-react.pug`, `new_from_template.pug`) hat dieselbe Struktur.
- f10 Schritt 5 (`OVERLEAF_SITE_LANGUAGE=en`): Die englischen Texte bleiben unverändert in `en.json`; neu ist nur
  `last_updated_date_by_you` („__lastUpdatedDate__ by you“). Ein Neustart mit englischer Sprache liegt außerhalb der
  E2E-Suite, die eine deutsche Instanz voraussetzt.

## Abschluss
- /simplify: übernommen: ungenutzter Import, Seitenbild-Breite schon im Browser auf 200-px-Stufen (stabile Adresse,
  Cache). Übersprungen (Vorschläge): gemeinsamer Platzhalter- und Menüknopf-Baustein für Quellen, Recherche und
  Vorschläge; Zählung der offenen Änderungen aus den schon geladenen Läufen ableiten (zählt aber auch Läufe jenseits
  der 20 gezeigten); doppelte `getDocument`-Aufrufe in `allesAnnehmen`/`zuruecknehmen`; Farbe von Formular-Labels im
  dunklen Modal in Overleafs `modal.scss` statt in `spur.scss` (Kern-Patch); Moment-Locale zentral beim Start setzen.
- Security (Subagent, ohne `/security-review`-Remote): behoben: rote Einschübe, die jemand durch Tippen in Stücke teilt
  (neue IDs), blieben für „Alles Offene jetzt annehmen“ nicht rot; jetzt zählt auch die Zeit (`rotZeiten`).
  Offen (niedrig): Seitenbilder in vielen Breiten rendern ohne Drossel; gleichzeitige Renderings ohne atomares Umbenennen
  (bestehendes Muster).
- /code-review (medium, Basis bis HEAD): behoben: Momentjs-Locale wurde global deutsch (`formatDate` jetzt mit Sprache
  der Oberfläche, globale Locale zurück auf Englisch); doppelte Leerzeile. Die übrigen Befunde betreffen Code aus P8
  (Proxy-Erkennung bei 404 im PDF-Betrachter, Zahlenfilter für Uhrzeit und Version, Rückrollen von `latexmkrc`, Drossel
  nicht atomar, zweiter TeX-Live-Spiegel bei 404, Cache „nicht registriert“, Makronamen mit `@`) und stehen als
  Vorschläge unten.

## Vorschläge (aus dem Review, außerhalb dieses Plans)
- PDF-Betrachter: Proxy-Sperre nur bei 2xx-HTML melden, nicht bei 404/500.
- Zahlen ohne Beleg: Verhältnisse wie „1:20“ und Einheiten wie „V 230“ nicht als Uhrzeit/Version ausfiltern.
- TeX-Pakete: `latexmkrc` beim Rückrollen zurücksetzen; Drossel atomar zählen; bei 404 den zweiten Spiegel versuchen.
- Crossref: „nicht registriert“ kürzer cachen; DataCite-404 nicht als „nicht erreichbar“ melden.
- Prüfung: eigene Zitatmakros mit `@` im Namen erkennen.

## Nachtrag nach dem Ende des ersten Laufs
- Behoben: p9f3 (403 des Testschalters ist gewollt), p9f4 (Tooltip beim Überfahren liegt in einer Hülle von CodeMirror),
  p9f11 (die Zugriffsseite des Freigabelinks hatte eine eigene Kopie des Schriftzugs, jetzt Kern-Patch in
  `access-attempt-screen.tsx`; Tokens entstehen erst beim Einschalten des Linkzugriffs).
- Ältere Schritte an P9 angepasst: Export der Beschaffung im Menü, neue Quellenliste, Startbefehl aufklappen, Backlog
  41 Einträge, README „Grenzen“; Chatverlauf rollt in eigenem Bereich unter den Läufen (neueste Nachricht unten
  sichtbar). Label und Hinweis unter dem gesperrten Eingabefeld bleiben lesbar (Overleaf graut sie sonst aus).
- Letzter voller E2E-Lauf (2026-11-13, nach der letzten Änderung): alle Features grün, auch `p6f3`. Davor behoben:
  Blätterknöpfe der großen Ansicht schrumpften bei 360 px unter 24 px (p5f6); `seitenAnfrage` las das CSRF-Token,
  während die Seite nach dem Anmelden noch weiterleitete (p7f9, nur im vollen Lauf).
- Screenshots bei 360 und 1280 px (Quellen, Prüfbericht, Claude, Recherche, Vorschläge, große Ansicht, Import-Dialog,
  Projektliste, Grenzen, Workflows) liegen außerhalb des Repos. Auffällig, aber gelassen: Im Import-Dialog bei 360 px
  ist die Sammlungsauswahl neben dem Knopf schmal („Schlaf u…“); „Choose Files“ ist die Sprache des Browsers.
