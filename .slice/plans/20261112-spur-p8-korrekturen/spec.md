Type: web, api

# spur P8: Korrekturen an Prüfung, Werkzeugen und Meldungen

## Zweck
Neun Schwächen aus der echten Arbeit mit einem Paper beheben: Der Prüfbericht zeigt korrekte DOIs rot, verschweigt markierte Stellen, übersieht eigene Zitatmakros und zählt ausgeblendete Vermerke mit; die Zahlenprüfung meldet Datumsangaben; `tex_package_add` scheitert an Grenzen und hinterlässt Reste; `doc_create` meldet nur „interner Fehler“; `wait_for_event` muss ständig neu gestartet werden; der PDF-Betrachter nennt eine Proxy-Sperre „PDF-Wiedergabe-Fehler“. Alles, was sich ändert, steht danach auch in der Doku.

## Nutzer
Forschende, die mit Claude Code in spur schreiben und dem Prüfbericht vertrauen müssen; Claude als MCP-Client; Admins, die Grenzen einstellen und Fehler im Log zuordnen.

## Was Nutzer danach können
- Dem Prüfbericht trauen: arXiv- und andere DataCite-DOIs sind grün geprüft, die Zählung nennt markierte Stellen, eigene Zitatmakros werden geprüft, ausgeblendete Vermerke zählen nicht.
- Datum, Uhrzeit und Versionsnummern schreiben, ohne dass ein Lauf „Zahl ohne Beleg“ meldet.
- Große Schriftpakete (Fira, Lato) ins Projekt holen; ein Abbruch hinterlässt nichts und blockiert nichts.
- Bei einem Werkzeugfehler lesen, was los ist; bei einem internen Fehler eine Fehler-ID nennen, die der Admin im Log findet.
- Claude warten lassen, ohne den Aufruf von Hand neu zu starten.
- Bei einer Proxy-Sperre lesen, dass ein Proxy blockiert, statt neu zu kompilieren.

## Context
- Prüfung: `Crossref.werk` fragt nur `api.crossref.org`; 404 wird `referenz:'nicht_gefunden'`, `problem:true`, rotes Abzeichen „DOI bei Crossref unbekannt“ und rote Markierung, 24 h negativ gecacht. Kein Aufruf an doi.org oder DataCite im Server. Der Dev-Fake (`dev/PaperFake.mjs`, Schalter `SPUR_PAPER_API_BASE` in `dev-schalter.json`) beantwortet arXiv-DOIs bewusst mit 404.
- Zählung: `zaehlung` in `PruefManager` zählt nur `status` (`geprueft`, `ohne_quelle`, `nicht_pruefbar`); `geprueft` heißt „wurde geprüft“, auch bei `problem:true` (abweichend, OCR unbestätigt, DOI unbekannt, Rückzug). Ein reines `\cite` ohne Zitat zählt als geprüft. Leser: `check_report`, Panel, Sprachdateien, Vertrag.
- Zitate: `pruefung/latex.mjs` erkennt `enquote, textquote, textcquote, blockquote`, die Umgebung `quote` und „…“. Bei `\zitat{Text} \cite{k}` bleibt der Wortlaut ungeprüft und die Stelle gilt als geprüft; auch die Schreibsperre in `SchreibManager` (kein erfundener Wortlaut) greift dort nicht. Maskiert werden nur Kommentare und Verbatim, nicht `\iffalse…\fi`, `\note{}` oder leer definierte Makros. Der Abschnitts-Cache hängt an `stempel`; alles, was die Erkennung ändert, muss dort hinein.
- Einstellungen je Projekt liegen in der Sammlung `spurSettings` (Muster Projekt-Standard `{projectId, userId:null}`).
- Zahlen: `schreiben/zahlen.mjs` nimmt „12.11.2026“ als eine Zahl; gemeldet werden auch „12“ aus „12. November 2026“, „14“ und „30“ aus „14:30“ und „1.2.3“. Gemeldete Zahlen blockieren die automatische Annahme.
- Pakete: `TexPakete.hinzufuegen` zählt die Drossel vor jeder Prüfung, kennt bei 5xx keinen Wiederholversuch und nur einen Spiegel, rollt bei Fehlern im Upload nichts zurück und hält einen teilweise gefüllten Ordner für „schon im Projekt“. Die Bytes werden erst nach vollem Erfolg gebucht. Grenzen (20 MB, 50 MB, 20 je Stunde) sind fest; die Admin-Seite „Grenzen“ kennt nur Ein/Aus. Overleaf erlaubt 2000 Einträge je Projekt (`TooManyFilesError`). Für `hinzufuegen` gibt es keinen Unit-Test, der Fake kennt weder 5xx noch Teilabbruch.
- `doc_create`: Alles außer `WerkzeugFehler`/`Problem` wird in `McpEndpunkt` zu `interner_fehler`; geloggt wird nur `{err, werkzeug}`. Im Code gefundene Wege dorthin: Projekt über 2000 Einträgen; ein Pfadteil heißt wie eine vorhandene Datei (`folder_not_found`); Fehler von project-history beim Setzen des Lauf-Labels; 500 oder Timeout des document-updater; `ergebnisse.tex` ist keine Textdatei; ein Fehler beim Aufräumen verdeckt den ersten und lässt ein leeres Dokument zurück, das den nächsten Versuch mit `konflikt` blockiert. Die echte Ursache auf dem Server ist nicht belegt (Log nicht gelesen).
- `wait_for_event`: Standard 1800 s; je Bot ein offener Long-Poll, ein neuer bricht den alten ab, der alte antwortet „Bitte erneut aufrufen“. `events_since` markiert nichts als zugestellt und liefert ohne Cursor die ältesten 100. Claude Code schiebt jeden MCP-Aufruf nach 120 000 ms in den Hintergrund (dokumentiert unter code.claude.com/docs/en/mcp, „Automatic backgrounding of long tool calls“; nur per Umgebungsvariable des Nutzers abschaltbar, nicht durch ein Plugin); Progress-Meldungen verhindern nur den Leerlauf-Abbruch nach 5 Minuten.
- PDF: `pdf-js-viewer.tsx` macht aus jedem Ladefehler `rendering-error`; Status und Content-Type werden nicht geprüft. spurs eigene Abrufe (`frontend/js/api.ts`) zeigen bei einer Antwort ohne JSON nur `statusText`.
- Doku weicht schon heute ab: `mcp-contract.md` nennt `paper_lookup` (gibt es nicht) und beschreibt `doc_create` als leeres Dokument; ADR 0003 nennt `/spur:lauf` (gibt es nicht).

## Decisions
Owner-Entscheidungen (2026-11-12):
- DOIs: Kennt Crossref eine DOI nicht, fragt spur doi.org nach der Registrierstelle und holt bei DataCite Titel, Autoren und Jahr. Ergebnis grün mit „Registriert bei DataCite“ und dem Zusatz, dass es dort keine Rückzugsmeldungen gibt. Andere Registrierstellen: „Registriert bei <Name>, Metadaten nicht geprüft“, neutral, kein Problem. Rot nur, wenn doi.org die DOI nicht kennt („DOI nicht registriert“). Ist doi.org oder DataCite nicht erreichbar: „nicht prüfbar“, nicht rot.
- Zählung: zusätzlich zur bisherigen Zählung die Zahl der markierten Stellen; Text im Panel „Zitierstellen: 74 geprüft, davon 13 markiert, 2 ohne Quelle, 1 nicht prüfbar“. Ein reines `\cite` ohne wörtliches Zitat zählt als „Beleg ohne Wortlaut“ und nicht mehr als geprüft.
- Makros: spur erkennt Zitatmakros aus der Präambel (Definition bildet auf `\enquote`, `\textquote`, `\blockquote` oder Anführungszeichen ab) und ausgeblendete Inhalte (leer definiertes Makro, `\iffalse…\fi`, Beamer-`\note` ohne `show notes`). Dazu im Prüfbericht eine Projekt-Einstellung mit zwei Listen, „Zitatmakros“ und „Ausgeblendete Makros“. Der Bericht nennt, wie viele Stellen er als ausgeblendet übersprungen hat. Erkannte Zitatmakros gelten auch für die Schreibsperre.
- Datum, Uhrzeit und Versionsnummern sind keine „Zahl ohne Beleg“.
- Pakete: Abbruch rollt vollständig zurück, Reste blockieren keine Neuinstallation, bei 5xx und Netzfehlern Wiederholversuche und danach der zweite Spiegel. Neue Standards: 100 MB je Paket, 300 MB je Projekt, 60 gelungene Installationen je Stunde und Person; alle drei auf der Admin-Seite „Grenzen“ einstellbar.
- `doc_create`: ohne Server-Log geplant; alle im Code gefundenen Ursachen bekommen klare Fehler und je einen Test, interne Fehler eine Fehler-ID.
- `wait_for_event`: kurzer Poll (Standard 100 s) mit sauberem Wiederanlauf; keine MCP-Tasks, keine Channels in diesem Plan.
- Alles, was sich ändert, kommt in die Doku (Owner: „alles auch in die Doku“).
- Der Server auf Hetzner wird nicht angefasst.

Annahmen (ohne Rückfrage getroffen):
- Registrierstelle über `https://doi.org/doiRA/<doi>`, Metadaten über `https://api.datacite.org/dois/<doi>`; beide über Schalter auf einen Fake umlenkbar wie `SPUR_PAPER_API_BASE`. Der bisherige Negativ-Cache für „bei Crossref unbekannt“ wird beim Update nicht weiterverwendet.
- Neue Statuswerte und Felder sind Ergänzungen; bestehende Felder von `check_report` und `bib_list` bleiben erhalten. Neues Zählfeld `markiert`, neuer Status `beleg_ohne_wortlaut`, neues Feld `uebersprungen`, neues Feld `registrierstelle`.
- Makro-Einstellung darf ändern, wer im Projekt schreiben darf; Namen ohne Backslash, nur Buchstaben und `@`, höchstens 30 je Liste. Die Einstellung hat Vorrang vor der Erkennung; ein Name in „Ausgeblendete Makros“ blendet auch ein sichtbar definiertes Makro aus.
- Datum: `TT.MM.JJJJ`, `TT.MM.JJ`, `TT.MM.`, `T. Monat JJJJ` (deutsch und englisch, auch `November 12, 2026`), ISO `JJJJ-MM-TT`; Uhrzeit `HH:MM` und `HH:MM:SS`, auch mit „Uhr“; Versionsnummern mit mindestens zwei Punkten oder nach „Version“, „v“.
- Pakete: 3 Versuche je Spiegel mit kurzer Pause, zweiter Spiegel `https://mirror.ctan.org/systems/texlive/tlnet`; Zurückrollen entfernt angelegte Dateien, den Ordner, die Reservierung und den Eintrag am Lauf. Ein Ordner unter `tex-pakete/` ohne Eintrag in `spurTexPackages` gilt als Rest und wird vor der Installation entfernt. Leeres Admin-Feld heißt Standardwert; die Speicher-Grenze je Projekt und Overleafs 2000 Einträge haben Vorrang und liefern eigene Fehlercodes (`speicher_voll`, neu `projekt_zu_viele_dateien`). Die Fehlermeldung zur Drossel nennt die eingestellte Zahl. Ein 5xx des Spiegels meldet „Paketquelle antwortet mit Fehler <status>“.
- `doc_create`: neue Codes `projekt_zu_viele_dateien`, `pfad_ist_datei`, `dienst_nicht_erreichbar` (mit Hinweis, es später erneut zu versuchen); scheitert das Aufräumen, wird das geloggt, der erste Fehler bleibt die Antwort, und ein leeres Dokument desselben Bots aus einem gescheiterten Versuch blockiert den nächsten Versuch nicht. Fehler-ID: 8 Zeichen, steht in der MCP-Antwort („Fehler-ID a1b2c3d4“) und im Log neben Projekt, Werkzeug, Bot und Pfad; nie Inhalte oder Tokens im Log.
- `wait_for_event`: `max_sekunden` bleibt wählbar (1 bis 3600), Standard 100. Antwort bei Zeitablauf `{ereignis: null, cursor, hinweis}`. Ein neuer Aufruf desselben Bots beendet den alten still mit `{ereignis: null, abgeloest: true}` und der Hinweis sagt, nicht erneut aufzurufen. `events_since` ohne Cursor liefert die neuesten Ereignisse; zugestellte Ereignisse kommen über `wait_for_event` nicht noch einmal. MCP-Anweisungen, Werkzeugbeschreibung, `SKILL.md`, Startbefehl im Panel und README beschreiben den Ablauf; die README nennt `CLAUDE_CODE_MCP_AUTO_BACKGROUND_MS` als Möglichkeit für Nutzer.
- Proxy-Meldung: Eine Antwort gilt als fremd, wenn sie auf eine PDF-Anfrage kein PDF ist (Content-Type nicht `application/pdf` oder kein `%PDF`-Anfang) oder auf eine spur-API-Anfrage kein JSON. Text: „Ein Proxy oder Filter in deinem Netz blockiert diese Anfrage (Status 403). Das liegt nicht an deinem Dokument. Wende dich an deine IT oder versuch es in einem anderen Netz.“ (englisch sinngemäß); Status nur, wenn bekannt. Die Änderung am PDF-Betrachter ist ein Kern-Patch und kommt mit Begründung in die ADR-Liste.
- Texte deutsch geduzt und englisch in beiden Sprachdateien.

## Access
Alle optional, Tests nutzen Fakes: `CROSSREF_MAILTO`. Neue Adressen im Betrieb: `doi.org`, `api.datacite.org` (ohne Schlüssel).

## Quality bar
- Web: Tastatur, sichtbarer Fokus, Kontrast mindestens 4,5:1, jedes Feld hat ein Label, Fehler als Text, kein horizontales Rollen bei 360 px, keine Konsolenfehler, keine nativen `alert`/`confirm`/`prompt`; nach Speichern liegt der Fokus sinnvoll.
- API/MCP: bestehende Felder und Codes bleiben; jeder neue Fehler hat einen festen Code und sagt, was zu tun ist; Rechte werden bei jedem Aufruf für das Projekt geprüft; wiederholte Aufrufe (`tex_package_add`, `doc_create`) sind gefahrlos.
- Sicherheit: Abrufe an doi.org und DataCite nur an diese festen Hosts mit Timeout; DOI wird vor dem Einsetzen in die Adresse kodiert; Paketdownload weiter nur von den beiden festen Spiegeln mit Pfadprüfung; Logs ohne Inhalte, Tokens oder Mailadressen.
- Fehlermeldungen sagen, was passiert ist und was zu tun ist, ohne Entschuldigung.
- Doku: Kein Werkzeug, Feld, Code oder Grenzwert im Code, der in `docs/mcp-contract.md` und README fehlt oder dort anders steht.
- Texte: deutsch mit humanizer-de, englisch und README mit humanizer geprüft.

### Tests (TDD)
- Jede Änderung beginnt mit einem roten Test; jeder behobene Fehler hat einen Test, der ihn nachstellt (auch `TexPakete.hinzufuegen`, Fake mit 5xx und Teilabbruch).
- E2E bekommt `p8f1` bis `p8f11` und läuft nach dem Zurücksetzen der Testdaten vollständig grün, auch alle älteren Features.
- Overleafs eigene Suiten bleiben grün bis auf die bekannte Upstream-Liste.
