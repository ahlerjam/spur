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

## Needs decision

## Vorschläge (außerhalb dieses Plans)
