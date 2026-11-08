# Fortschritt 20261106-spur-p4-quellen

## Needs decision
(keine offenen Punkte)

## Entscheidungen
- Finish-Basis: Die Skill-Formel ergibt `6a2b311948^`. Dazwischen liegen 41 fremde Commits (P11, State-Commits von P2 und P4). `/simplify`, `/code-review` und die Sicherheitsprüfung laufen deshalb auf `73b6bf177a..HEAD`, also genau auf der Arbeit dieses Laufs (wie in P1).
- E2E-Schlüssel: Die Features heißen in `spur-e2e.js` `p4f1` bis `p4f4`, weil `f1` bis `f15` schon P1 gehören. P2 läuft parallel und hängt eigene Schlüssel an.
- f1, Rechte: Markieren verlangt wie bisher Schreibrecht. Kommentieren und Zuweisen dürfen wie in Overleaf alle eingeladenen Mitglieder, auch mit Leserecht (Overleafs `comment` gilt auch für `readOnly`). Nutzer mit reinem Freigabelink sind ausgeschlossen (`blockRestrictedUserFromProject`). Zuweisen geht nur an eingeladene Mitglieder und den Owner. „Stelle bestätigt“ (f2) verlangt Schreib- oder Review-Recht.
- f1, live: Neue Zitate, Kommentare, Zuweisungen und Bestätigungen gehen als `spur:zitate` über Overleafs Echtzeit-Kanal des Projekts, OCR-Fortschritt als `spur:quellen`. Die Meldung trägt nur die Quellen-ID; die Panels laden über die normalen Routen nach. So geht über den Socket nichts an der Rechteprüfung vorbei, und real-time leitet die Meldungen ohnehin nicht an Link-Nutzer weiter.
- f1, Hinweis: Zugewiesene Zitate erscheinen im Quellen-Panel als Hinweis mit „Öffnen“ und „Erledigt“. „Erledigt“ nimmt die Zuweisung weg.
- f2, OCR: Seiten werden mit `pdftoppm -r 300 -gray` gerastert und von `tesseract … -l deu+eng tsv` gelesen; Text und Konfidenz kommen aus der TSV-Ausgabe. Die Erkennung läuft im Web-Prozess im Hintergrund, Seite für Seite. Steht sie länger als 10 Minuten still (Prozess neu gestartet), zeigt die Quelle „Texterkennung abgebrochen“ und lässt sich neu starten. Unter 70 % mittlerer Konfidenz heißt es „OCR unsicher, Sichtprüfung nötig“, auf der Seite „Erkennung unsicher (Konfidenz … %)“, immer in Text.
- f2, Prüfbericht: Ein Treffer in einer OCR-Quelle heißt „Wortlaut: OCR, nicht bestätigt“ (zählt als Problem, also nie automatisch übernommen), bis ein bestätigtes Zitat derselben Quelle den zitierten Text enthält; dann „Wortlaut: von Mensch bestätigt“. Abweichender Wortlaut bleibt „abweichend“.
- f2, Fixture: `scan.pdf` trägt auf Seite 1 den Satz „Short naps restore attention in night shift workers.“ als Graustufenbild ohne Textebene, Seite 2 ist leer. `erzeuge-fixtures.mjs` rastert dafür eine Textseite mit `pdftocairo` und bettet die PNG-Daten mit PNG-Prädiktor ein (keine neuen Pakete). P1 sieht weiter „Kein Text, nicht prüfbar“.
- f3, Abruf: `node:http`/`https` mit eigener `lookup`-Funktion. Gesperrt sind Loopback, private Netze, Link-Local (auch 169.254.169.254), CGNAT, Multicast und die IPv6-Gegenstücke, geprüft an der Adresse, mit der sich der Socket verbindet, und nach jeder Umleitung (höchstens 5). Dazu 15 s Zeitlimit, höchstens 5 MB, nur HTML oder Text, keine Zugangsdaten in der URL. Im Dev-Stack (`SPUR_DEV=1`) ist das lokale Netz offen, weil die Testseite dort liegt (`/spur/dev/web/testseite`).
- f3, Inhalt: Text per `sanitize-html` ohne erlaubte Tags (Absätze aus Block-Elementen), Titel aus `<title>`, SHA-256 über den Text, die HTML-Datei liegt als Quelldatei daneben. Schlüssel aus dem Titel (sonst Host und Pfad). Zitate daraus: `\enquote{…} \autocite{key}` ohne Seite, `.bib`-Eintrag `@online` mit `title`, `url`, `urldate`. Der Prüfbericht prüft den Wortlaut gegen den Schnappschuss und hat für Webseiten keine Seitenprüfung.
- f3, `SPUR_NOW`: In der ganzen Suite fest gesetzt, hinge „Claude verbunden“ (Herzschläge, P1 f10) an einer festen Zeit. Der E2E-Schritt setzt `SPUR_NOW` deshalb nur für die Aufnahme über die Dev-Route `POST /spur/dev/zeit` (nur bei `SPUR_DEV=1`) und gibt die Zeit danach wieder frei. Die Route setzt den Wert im Web-Prozess; `dev-schalter.json` ist im Container schreibgeschützt eingehängt.
- f4: Der Hinweis erscheint unter der Werkzeugleiste, sobald eine `.vtt`-Datei hochgeladen wird, und verschwindet beim nächsten Upload einer anderen Datei. Der E2E-Schritt liest die README über ein Dateifeld, weil das run-code-Werkzeug kein `fs` hat.

## Recipe changes
- In dieser Cloud-Session lief das Setup-Skript der Umgebung nicht: Es gab weder `spur-dev` noch einen laufenden Docker-Dienst oder Images. Der Builder hat den unveränderten Stand `tools/spur-dev/spur-dev install --cloud` ausgeführt (`git diff agent HEAD -- tools/spur-dev` leer); `spur-dev up` startete Docker selbst und zog die Images. Bitte das Feld „Setup script“ der Umgebung prüfen.
- In dieser Cloud-VM gibt es keine Sandbox: `spur-dev` mit Umleitung (`> datei`) oder Pipe funktioniert hier, anders als in `CLAUDE.md` beschrieben.
- Browser-Suite wie in P11: Wrapper in `.playwright-mcp/` erzeugen, der `spur-e2e.js` startet und das Ergebnis an `page.__e2eErgebnis` hängt, dann in Aufrufen unter 60 s abfragen.

## /simplify (73b6bf177a..HEAD)
- Umgesetzt: Live-Meldungen zu Zuweisungen tragen die betroffene Person (`an`), nur deren Hinweis lädt nach (vorher lud jedes Mitglied bei jedem Zitat `/zitate/zugewiesen`); `zugewiesen` lädt die Quellen mit einer `$in`-Abfrage statt einzeln; die Zuweisungsprüfung vergleicht nur IDs (`getInvitedMemberIds`) statt Namen aller Mitglieder zu laden; der Prüfbericht lädt bestätigte Zitate nur für OCR-Quellen und gar nicht ohne sie; ein Helfer für die beiden Live-Ereignisse; `_.mean` statt zweimal handgeschriebener Mittelwert; `zitatFuerClient` statt dreimal `(…[z])[0]`; totes Feld `ich` in `/team` entfernt; `anzeigename()` statt doppeltem Ausdruck für Webseiten-Titel; E2E-Helfer `vorBibliographieEinfuegen` statt zweimal kopiertem Block.
- Nicht umgesetzt:
  - SSRF-Prüfung aus `services/linked-url-proxy` (`isBlockedIp` mit `ipaddr.js`) übernehmen: modulprivat in einem anderen Dienst, `ipaddr.js` ist im web-Paket nicht deklariert (neues Paket wäre Stoppgrund). Vorschlag: gemeinsame Bibliothek in `libraries/` mit dieser Prüfung, dann auch `Settings.blockedNetworks` beachten.
  - Tabelle der Quellenarten (Seiten ja/nein, Zitierstelle) und abgeleitetes `textBestaetigungNoetig` statt `art === 'web'` / `status === 'ocr'` an mehreren Stellen: lohnt mit der nächsten Quellenart; heute je zwei bis drei Stellen.
  - `dev-schalter.json` beschreibbar einhängen statt `zeitFestlegen` im Prozess: braucht eine Änderung an `spur-dev` (nur per `install` durch einen Menschen). Vorschlag für den Owner.
  - Helfer in `spur-e2e.js` als `sitzung(page)`-Fabrik statt `alsSeite`: berührt alle P1-Features; für neue Mehrnutzer-Schritte empfohlen.
  - OCR-Seiten parallel rastern, Ereignisse drosseln: eine Seite dauert mehrere Sekunden, ein Ereignis je Seite ist schon selten; parallele Tesseract-Läufe würden den Web-Prozess stärker belasten.
  - `htmlZuText` in einen Worker: Eingabe ist auf 5 MB begrenzt; Vorschlag, falls große Seiten auffallen.
  - Gemeinsames Formular-Gerüst für Kommentar und Webseite, Team-Liste zwischenspeichern, gemeinsamer Namens-Helfer mit `ClaudeZugang` (dort andere Regel für den Bot-Namen): kleiner Gewinn, andere Felder bzw. Zwecke.
  - `ocrStarten` gibt `{ quelle, lauf }` zurück; `lauf` nutzen nur die Tests, um auf das Ende zu warten. Bleibt als Naht für Tests.
- E2E nach /simplify (9c00667b18), nach `vorbereiten.mjs`: f1–f15 ok, p4f1–p4f4 ok.

## /code-review medium 73b6bf177a..HEAD
- Behoben (20ae90dcf8, Unit-Tests zuerst):
  - SSRF: IPv4-gemappte IPv6-Adressen in Hex-Schreibweise (`[::ffff:127.0.0.1]` wird zu `::ffff:7f00:1`) umgingen die Sperre. Die Sperre nutzt jetzt `net.BlockList` (prüft gemappte Adressen gegen die IPv4-Regeln) und sperrt zusätzlich NAT64, 6to4, Teredo, `::/96`.
  - OCR: höchstens zwei Läufe zugleich (429 `ocr_ausgelastet`), Abbruch, wenn die Quelle gelöscht wird, Fehler des Hintergrundlaufs werden geloggt statt als unbehandelte Rejection zu enden; eine fertige OCR-Quelle lässt sich nicht neu erkennen (bestätigte Stellen passten sonst nicht mehr zum Text).
  - Holen aus anderem Projekt kopierte Kommentare, Zuweisungen und eine laufende Texterkennung mit; jetzt nicht mehr. Bestätigungen von Stellen gelten weiter, weil sie den Quelltext betreffen.
  - Webseiten mit gleichem Titel: Schlüssel mit Zähler (`…-2`), dieselbe Adresse ergibt „Diese Webseite ist schon als Quelle vorhanden („Titel“).“ statt der Aufforderung, eine Datei umzubenennen.
  - Hinweis auf Zuweisungen nennt bei Webseiten den Titel statt des Dateinamens; Kommentar ohne Zuweisung schickt kein leeres `$set`.
- Abgleich mit Spec und Schritten: alle vier Features und die Zustände „Markierungen: keine, viele, von anderen“ und „OCR: läuft, fertig, unsicher“ (Status als Text) sind abgedeckt; nichts fehlt.

## Sicherheitsprüfung (Subagent, `git diff 73b6bf177a..HEAD`)
`/security-review` scheitert hier an fehlendem `origin/HEAD`; deshalb wie vom Skill vorgesehen ein Subagent.
- Kein Befund mit Konfidenz ≥ 8. Geprüft: SSRF (Lookup im Socket, Umleitungen, IP-Literale, Zeit- und Größenlimit), Rechte und Projektbindung der neuen Routen, Inhalte der Echtzeit-Meldungen, `execFile` ohne Shell, XSS (nur React-Text, HTML-Datei nur als Download), `.bib`-Maskierung, Dev-Routen nur bei `SPUR_DEV=1`.
- Kandidaten unter 8, nicht umgesetzt (Vorschläge): Grenze für Kommentare je Zitat oder Rate-Limit; Rate-Limit und Parallelgrenze für `/quellen/web`; OCR-Grenze je Projekt statt je Prozess und Seitenobergrenze; weitere reservierte Netze (`192.0.2.0/24`, `fec0::/10`).

## Ansichten (taste, Quality bar), 360 und 1280 px
Aufgenommen (`.playwright-mcp/*-360.png`, `*-1280.png`, nicht im Repo): Quellen-Panel mit Zuweisungshinweis, Zitatliste mit Namen, Zuweisung und Kommentaren, offenes Kommentarformular, Filter „Von mir“, Liste mit OCR-Status, „Text wird erkannt: Seite 1 von 2“, Scan-Vorschau mit OCR-Hinweis und bestätigtem Zitat, Prüfbericht mit „Wortlaut: von Mensch bestätigt“, Webseiten-Formular mit „Seite nicht erreichbar“, Liste mit Webseite (Titel, „Webseite · abgerufen am 1. November 2026“, URL), Webseiten-Vorschau, Transkript-Hinweis. Kein horizontaler Überlauf (`scrollWidth` = Fensterbreite in allen Aufnahmen). Konsolenfehler nur die gewollten 502/409 der Fehlerzustände.
Behoben nach der Sichtprüfung:
- Hinweise ohne Knopf (Transkript) liefen im 185 px breiten Panel rechts aus dem Kasten: langes Wort bestimmte die Mindestbreite. Jetzt `overflow-wrap: anywhere` und Silbentrennung.
- URL in der Webseiten-Vorschau wurde abgeschnitten: Meta-Zeilen brechen um.
- „Text wird erkannt: Seite 0 von 2“ zeigt jetzt die Seite, die gerade läuft („Seite 1 von 2“).
- Zitate aus Webseiten zeigten „S. 1“: Schnappschüsse haben keine Seiten, die Angabe entfällt.
- Die Zitatliste zeigte beim Öffnen kurz „Markieren Sie oben Text …“, bevor die Zitate geladen waren: Ladezustand ergänzt.
- OCR-Hinweis in der Vorschau hatte die Schriftgröße des Fließtexts: jetzt Meta-Größe, fett.
- Formular-IDs aus `useId()` statt aus dem API-Pfad; Zuweisungshinweis kürzt lange Zitate auf etwa 60 Zeichen.
Offen (Kern-Layout, wie in P1): Bei der Standardbreite des Panels (185 px) werden Hinweise mit Symbol sehr schmal und hoch; das Panel lässt sich verbreitern.

## Abschluss
- Overleafs Suiten (`spur-dev upstream alle` nach 5744e75817): web zuerst `neu: 2`, nämlich die beiden echten OCR-Unit-Tests, die unter der Last der ganzen Suite länger als 60 s brauchten. Behoben in 631dde70ac: Tesseract mit `OMP_THREAD_LIMIT=1` (OpenMP belegte sonst alle Kerne und überbuchte parallele Läufe), nur noch zwei echte Erkennungen in den Tests, 180 s Zeit. Danach `spur-dev upstream web`: bestanden 5581, fehlgeschlagen 173, bekannt 173, neu 0. frontend: 1674/14/14/0, du: 784/0/0/0.
- Tesseract mit `deu` und `eng` steht im Produktions-Basisimage (`server-ce/Dockerfile-base`), nicht nur im Dev-Image.
- P1-Code prüft nirgends `status === 'text'` als „hat Text“; `quelle_fehlt` entsteht nur ohne Quelle, OCR-Quellen sind also für `doc_edit` normale Quellen (Wortlaut „OCR, nicht bestätigt“ blockiert nicht).
- Letzter voller E2E-Lauf nach der letzten Code-Änderung (631dde70ac), nach `vorbereiten.mjs`: f1–f15 ok, p4f1–p4f4 ok.
- Unit-Tests: 516 grün, Zeilen 98,58 %. spur-Frontend-Tests: 25 grün.

## Vorschläge
- Gemeinsame SSRF-Prüfung für web und linked-url-proxy in `libraries/` (mit `Settings.blockedNetworks`).
- Rate-Limit für `/quellen/web` und Kommentare; OCR-Grenze je Projekt und Seitenobergrenze.
- `dev-schalter.json` im Dev-Stack beschreibbar einhängen; dann kann `zeitFestlegen` entfallen.
- Markierungen auch im Seitentext der Vorschau hervorheben (heute nur in der Liste).

## /simplify (zweite Runde, Endstand 73b6bf177a..5de8f6701f, alle vier Prüfer abgewartet)
- Umgesetzt: Teamregel an einer Stelle (`Team.mitgliederIds`, auch für die Zuweisungsprüfung); `_.unescape` statt drei handgeschriebener Ersetzungen; Notification-Regeln für schmale Panels gelten für alle Meldungen im Panel (`.spur-panel .notification-content`), nicht nur für Hinweise; Tesseract-Optionen als Konstante neben `GRENZEN`; tote Klasse `spur-ocr-wortlaut` entfernt; bestätigte Zitate ohne Kopieren je Eintrag gruppiert; Crossref-Abruf und Abfrage der bestätigten Zitate parallel; Duplikat- und Schlüsselprüfung in `webAufnehmen` parallel; Namensabfrage mit entdoppelten IDs; Ladebedingungen der Zitatliste über `geladen`.
- Nicht umgesetzt: `UserGetter.getUsers` statt direkter Abfrage (zieht schwere Abhängigkeiten in die Unit-Tests, die nur `mongodb` ersetzen); `_.truncate` (anderes Kürzungsverhalten); gemeinsamer Lade-Hook über die P1-Panels (Umbau ohne Verhaltensgewinn, wie in P1); doppeltes Nachladen nach eigenen Aktionen durch das Echo der Live-Meldung (ein GET mehr je Aktion; Absender-Filter wäre ein Vorschlag); doppelter `IST_DEV`-Schutz bei `zeitFestlegen` (bewusst zweite Absicherung); Roh-Buffer statt UTF-8-Neukodierung (die Datei soll als UTF-8 liegen); Vorab-Lesen in `kommentieren` (liefert den 404 sauber).
- Danach: Unit-Tests 516 grün, spur-Frontend-Tests 25 grün.
