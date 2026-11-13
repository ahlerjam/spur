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

- Nach der Abnahme (f5 zurück auf `passes: false`): Der Schalter war beim Speichern `disabled`, „Nichts offen“
  ebenso; der Browser ließ den Fokus auf die Seite fallen. Jetzt: Der Schalter bleibt bedienbar (`aria-busy`, ein
  zweiter Wechsel wird während des Speicherns ignoriert), „Nichts offen“ ist `aria-disabled` und bekommt nach dem
  Dialog den Fokus. Dasselbe Muster steckte in jedem Knopf mit `isLoading` (Overleafs `OLButton` setzt dabei
  `disabled`): Der neue Baustein `lade-knopf.tsx` gibt einem Knopf, der beim Start des Ladens den Fokus hatte, ihn
  danach zurück, sofern niemand ihn woanders hingesetzt hat; alle 22 ladenden Knöpfe in spur nutzen ihn.
  `tools/tests/oberflaeche.test.mjs` weist einen ladenden `OLButton` in spur ab.
- /simplify (Fokus-Fix): übernommen: ein Ref weniger in `LadeKnopf`, `useImperativeHandle` statt Callback-Ref, Fokus
  nach dem Dialog per Effekt statt `requestAnimationFrame`, E2E-Helfer `fokusAuf`, Repo-Prüfung gegen ladende
  `OLButton`. Übersprungen (Vorschlag): Overleafs `OLButton` selbst beim Laden mit `aria-disabled` statt `disabled`
  bauen (Kern-Patch, ändert alle ladenden Knöpfe von Overleaf und deren Upstream-Tests).
- /code-review (medium, `b252f41fcb..HEAD`): behoben: Repo-Prüfung übersah `isLoading` hinter Props mit `>` (jetzt
  Scan mit Klammertiefe); `LadeKnopf` schrieb beim Rendern in ein Ref (jetzt beim Auslösen) und holte den Fokus auch
  nach einem Klick in den Seitentext zurück (jetzt nicht mehr, `pointerdown` woanders verwirft ihn); zwei schnelle
  Wechsel des Schalters vor dem nächsten Rendern (Ref statt Zustand); E2E-Warten ohne Meldung. Übersprungen: „Nichts
  offen“ ist fokussierbar, aber wirkungslos – gewollt, damit der Fokus nach dem Annehmen nicht auf der Seite landet.
  jsdom lässt den Fokus auf gesperrten Knöpfen; die Tests setzen ihn darum selbst auf die Seite wie Chrome.
- E2E p6f3 (wackelte schon vor P9): Der Schritt tippte, bevor Overleaf den neuen Kommentar platziert und selbst
  fokussiert hatte; der Text ging mit dem ersten Eintrag verloren. Er wartet jetzt auf diesen Fokus (Feld im
  Shadow-DOM) und prüft, dass der Text im Feld steht.
- E2E p5f6: Die Blätterknöpfe sind genau 24 × 24 px; der Schritt vergleicht jetzt ganze Pixel (Bruchteile beim
  Öffnen des Dialogs) und nennt bei einem Fehler die Maße.
- /code-review (medium, `74da65505c..HEAD`, nur E2E-Schritte): behoben: p6f3 wartet auf den Fokus ohne Annahme über den
  Shadow-Host, löst das Feld bei jeder Abfrage neu auf und meldet Fokus und Feldinhalt; p5f6 rundet nicht mehr, sondern
  misst erst nach dem Ende der Einblend-Animationen (abgebrochene Animationen zählen als fertig).
- /simplify (`74da65505c..HEAD`, E2E-Schritte): übernommen: `fokusAuf` prüft über einen Locator mit `:focus`, der bei
  jeder Abfrage neu aufgelöst wird und Shadow-DOMs sieht; p6f3 nutzt ihn statt einer eigenen Warteschleife; Meldungen
  werden nur im Fehlerfall gebaut. Übersprungen: ein gemeinsamer Helfer fürs Warten auf Animationen (nur eine Stelle).
- Security (Subagent, `b252f41fcb..HEAD`): keine sicherheitsrelevanten Befunde. `alles-annehmen` und `automatik`
  verlangen auf dem Server Schreibrecht (`schreiben`-Kette, `darfSchreiben`); `aria-disabled` statt `disabled`
  schwächt nichts, der Knopf öffnet nur den Rückfragedialog. Keine neuen Dev-Routen, kein `innerHTML`.
- Screenshots aller Ansichten bei 360 und 1280 px nach der letzten Änderung an der Oberfläche neu aufgenommen
  (Projektliste, Quellen, Prüfbericht, Claude, Recherche, Vorschläge, Import, große Ansicht, Grenzen, Workflows).
- Screenshots nach dem Fokus-Fix: Claude-Panel mit „Nichts offen“ bei 360 und 1280 px; der Fokusring ist per Tastatur
  sichtbar (2 px blau), auch auf dem gesperrt aussehenden Knopf.
- Security: Der Fix ändert nur Fokus und ARIA im Browser, keine Route, keine Rechte, keine Eingaben an den Server;
  keine eigene Sicherheitsprüfung nötig.

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
  Im Claude-Panel steht der Automatik-Schalter allein in der Zeile, sein Label groß und fett darunter; Vorschlag:
  Label in Textgröße neben den Schalter. Die Aufnahme der großen Ansicht bei 360 px stammt von vor dem Fix der
  Blätterknöpfe; deren Größe prüft p5f6.
