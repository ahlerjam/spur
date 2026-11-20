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

## Gestaltung (taste)
Nachgetragen: P14 baut keine neue Ansicht, sondern drei Abzeichen in die bestehende Berichtszeile ein; Farben und Schriften kommen aus dem vorhandenen Badge-System und Overleafs Design (kein DESIGN.md im Repo).
- Farben (vorhandene Klassen, keine Literale): Erfolg `bg-success` für „PDF-Seite: stimmt“, Warnung `bg-warning` für „Wortlaut auf PDF-Seite N gefunden“ (markiert, wie „gefunden auf S. N“), Hinweis `bg-info` für „Seitenzahl aus dem Seitentext erkannt“ (Herkunft, kein Befund), Gefahr `bg-danger` unverändert für „DOI nicht registriert“; Grund der Fläche ist der Panel-Hintergrund des Editors.
- Schrift: Overleafs Sans für Auszug und Abzeichen, Monospace nur für den Key (wie bisher), keine neue Schrift.
- Skizze einer Zeile:
  ```
  main.tex:8   gandhi2024
  Replay strengthens memory traces.
  [Wortlaut: exakt] [Wortlaut auf PDF-Seite 6 gefunden]
  ```
  Mehrere Keys einer Stelle stehen als eigene Zeilen mit demselben Ort untereinander (main.tex:6 je Key).
- Bewusst nicht: kein eigenes Symbol für „PDF“, keine zweite Farbe für die Seitenbasis; der Unterschied steht im Wort („PDF-Seite“ statt „Seite“), weil die Spec ihn so benennt.

## Abschluss
- /simplify (4 Prüfer): übernommen `klammerEnde` aus latex.mjs statt Kopie, Mathe-Umgebungen nur einmal, Lage im Dokument nur bei Zahlen, Wortlaut je Key bis zum ersten Treffer, Zeilen-ID aus Position und Key, Set statt Flag für \textquote/\blockquote ohne Beleg. Nicht übernommen: Neuentwurf der Zitat-Beleg-Zuordnung als eigener Nachlauf und Lage über den Lezer-Parser (große Umbauten, als Vorschlag notiert).
- /code-review medium auf `b1c2658728..HEAD` (nur P14; die formale Plan-Basis enthält die eingemergten Pläne P12, P13, P16): behoben, dass `\resizebox`/`\scalebox` ihren Inhalt aus der Zahlenprüfung nahmen, und Phantom-Keys bei Mehrfachzitaten mit Klammer nach Leerraum. Nicht geändert, weil die Spec es so festlegt: PDF-Seitenbasis auch bei bekannter, aber unpassender Crossref-Spanne; Zahlen direkt vor Einheiten auch im Fließtext; Satzende-Regel ohne Abkürzungsliste; Lage nach der Startposition.
- /security-review (P14-Diff): keine Befunde mit hoher Konfidenz.
- Gesamtlauf E2E nach der letzten Codeänderung: 119 ok, `p16f1b` übersprungen (Dev-Image älter als P16, nicht P14).
- Unit-Gate nach der letzten Codeänderung: `spur-dev test` grün (94,34 % Zeilen), `node --test tools/tests/*.test.mjs` 79 grün.
- Taste (slice:taste): keine neue Komponente, nur drei Abzeichentexte im bestehenden Badge-System (Farben aus den vorhandenen Klassen success/warning/info/danger); keine Tells aus der Liste; 360 px ohne Überlauf, Konsole nur mit Overleafs Permissions-Policy-Warnungen. Texte mit humanizer-de und humanizer geprüft, ohne Befund.
- Ansichten bei 360 und 1280 px: Prüfbericht „E2E P14 Preprint“, Quellenansicht `weber2018` (Seite 41), Prüfbericht „E2E P14 Varianten“; kein horizontales Rollen.

- Nachgeholt auf der formalen Plan-Basis `64f017e6..HEAD` (enthält die eingemergten Pläne P12, P13, P16): /code-review medium, /simplify mit vier Prüfern und eine Sicherheitsprüfung des ganzen Diffs (keine Befunde mit hoher Konfidenz). P14-Code daraus behoben: Frontend-Typ `versatzQuelle` kennt `seitentext`, `zeilenBewerten` prüft den Wortlaut je Key nicht doppelt, verwaister Kommentar in latex.mjs. Befunde im Code der anderen Pläne stehen unten als Vorschläge, weil Arbeit außerhalb der Plan-Features nicht gebaut wird.

- Letzter Stand nach der Nachprüfung (Code-Commit `98099bd`): `spur-dev test` grün (94,34 % Zeilen), Gesamtlauf E2E 119 ok, `p16f1b` übersprungen (Dev-Image); sechs Screenshots (Prüfbericht Preprint, Quellenansicht weber2018, Prüfbericht Varianten, je 360 und 1280 px) auf diesem Stand neu aufgenommen, ohne Überlauf.

## Vorschläge
- Zitat-Beleg-Zuordnung als ein Nachlauf über die fertige Zeilenliste statt Vorwärtssuche je Zitat mit Korrekturen (Befund aus /simplify).
- Satzende-Erkennung mit Abkürzungen („vgl.“, „Abb.“, „et al.“), damit ein vorangestelltes `\textcite` auch über solche Stellen hinweg verknüpft wird.
- Englischer Text „Quote found on PDF page …“ heißt in den übrigen Abzeichen „Wording“; einheitlich wäre „Wording found on PDF page …“.
- Die Kopfzeile des Berichts nennt „ohne Quelle“ zweimal (markiert und nicht markiert, Aufschlüsselung aus P10), etwa „1 ohne Quelle, 1 nicht prüfbar, 3 ohne Quelle“; mit mehreren Keys je Stelle kommt das öfter vor. Ein Zusatz wie „davon nicht markiert“ würde es auflösen.
- Die Testdaten von „E2E P14 Varianten“ nutzen `\citealp` mit biblatex; der Bericht ist richtig, das PDF hat dort einen Compile-Fehler.

### Aus der Prüfung des ganzen Plan-Diffs (Code aus P12, P13, P16)
- P13 `pruefung/bib.mjs:146`: Quelle ohne DOI mit Werkangaben (Upload mit `--art thesis`) bekommt einen leeren `@article`, wenn das PDF irgendwo eine DOI nennt; `OHNE_DOI[quelle.meta?.art]` sollte allein entscheiden.
- P16 `kompilieren/Kompilieren.mjs:69`: Der Compile-Job bleibt `laeuft`, bis das Nachschlagen fehlender Pakete fertig ist (bis 30 s je Spiegel, Fehlschlag nicht gecacht); erst `fertig` setzen und die Pakete beim Lesen auflösen.
- P16 `fehlende-pakete.tsx:26`: Ab der 21. fehlenden Datei verschwinden Zeilen nach der Serverantwort.
- P12 `Suchprotokoll.mjs:47`: `error.writeErrors` als Array angenommen; `[error.writeErrors ?? error].flat()` wäre robuster (Treiberverhalten nicht verifiziert).
- P13 `pruefung/bib.mjs:8`: Rückfall für Felder ohne Klammern sucht den Feldnamen im ganzen Eintrag; nur an Feldgrenzen zulassen.
- P12 `recherche/dienste.mjs:253`: DOI in der Europe-PMC-Suche in Anführungszeichen setzen (`DOI:"…"`).
- P12/P13: Pause und Retry-After stehen doppelt (`zeit.warten`/`netz.warten`, `pauseMs` in Crossref und wiederholen.mjs, zwei Wiederholschleifen); ein Helfer `mitWiederholung` in `wiederholen.mjs`.
- P12: `prisma()` liest bei jeder Seite des Suchprotokolls alle Treffer; nur auf der ersten Seite oder per Aggregation in Mongo zählen. Dublettenregel in `Recherche.zusammenfuehren` und `Suchprotokoll.schluesselVon` vereinheitlichen; der Grund „nicht beschaffbar“ steht an zwei Stellen.
- P14: `seitenbasis` beim Aufnehmen an der Quelle festlegen statt in `seitenStatus` nach `art` zu unterscheiden.

### Aus dem zweiten Code-Review auf `64f017e6..HEAD` (nach /simplify)
- Behoben (P14): Argumente von Einstellungsbefehlen enden an einer Leerzeile; vorher fiel eine Klammergruppe im nächsten Absatz aus der Zahlenprüfung.
- P14, bewusst nach Spec belassen: Bücher oder Scans mit Vorspann und ohne erkannte Seitenzahlen werden gegen die PDF-Seite geprüft; ein Zitat von S. 45 auf PDF-Seite 45 gilt als „PDF-Seite: stimmt“, auch wenn gedruckt S. 33 dasteht. Das Abzeichen nennt die PDF-Seite; ob solche Quellen besser einen bestätigten Versatz brauchen, wäre eine Owner-Entscheidung.
- P16 `TexPakete.mjs:172`: Ausfall der Paketdatenbank kurz vorhalten. P12 `werkzeuge.mjs:420`: `paper_search` liefert ab Seite 50 einen Cursor, der wieder Seite 50 liefert. P12 `Recherche.mjs:82`: Fehler beim Protokollieren lässt die Suche scheitern. P12 `Beschaffung.mjs:42`: `vormerken` überschreibt beschaffte Einträge. `.slice/decisions.md`: D15 doppelt vergeben.

## Replies
