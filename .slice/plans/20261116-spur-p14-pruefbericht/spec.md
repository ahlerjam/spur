Type: api, web

# spur P14: Prüfbericht ohne blinde Flecken und ohne Rauschen

## Zweck
In einer echten Arbeit liefen Zitate mit vorangestelltem `\textcite[S.~x]{…}` als „Beleg ohne Wortlaut“, bei Preprints galt die Seite als „nicht prüfbar“, und `zahlen_ohne_beleg` meldete TikZ-Koordinaten und Einstellungswerte. Beim Lesen des Codes kam dazu: Von mehreren Keys in einem Beleg wird nur der erste geprüft, und Varianten wie `\Textcite` gelten als unbekannt. Dieser Plan schließt diese Lücken.

## Nutzer
Forschende, die dem Prüfbericht vertrauen müssen; Claude, das nach dem Schreiben `check_report` liest und auf `zahlen_ohne_beleg` reagiert.

## Was Nutzer danach können
- Autor-im-Satz-Zitate („Smith (2024, S. 347) schreibt: ‚…‘“) geprüft sehen.
- Sich darauf verlassen, dass bei `\parencite{a,b}` beide Quellen geprüft werden.
- Großgeschriebene und verwandte Zitierbefehle ohne „nicht prüfbar“ nutzen.
- Seitenangaben in Preprints prüfen lassen.
- Grafiken bearbeiten lassen, ohne dass Koordinaten als unbelegte Zahlen gemeldet werden.

## Context
- `pruefung/latex.mjs`: Ein Zitat (`\enquote`, „…“, `\textquote`, `quote`-Umgebung) sucht seinen Beleg nur dahinter (`folgenderBeleg`) oder im optionalen Argument. Steht `\textcite[S.~12]{key}` davor, entsteht eine eigene Zeile der Form `beleg` ohne Wortlaut; das Zitat selbst hat keinen Beleg und fällt bei `\enquote` und „…“ ganz weg. Echter Fall: `\textcite[S.~4]{oldemeyer2025} beschreiben dies als \enquote{…}` lief als `beleg_ohne_wortlaut`.
- `BELEG_BEFEHLE`: `cite`, `autocite`, `parencite`, `textcite`, `footcite`, `citep`, `citet`. Jeder andere Name mit „cite“ (`\Textcite`, `\Parencite`, `\citeauthor`, `\citeyear`, `\nptextcite`, `\citealp` …) gilt als `unbekannt` und zählt als „nicht prüfbar“.
- `pruefung/bewertung.mjs` (`zeileBewerten`): `const [beleg] = fund.belege`, weitere Keys werden nie geprüft.
- `seitenStatus`: Hat die Quelle keinen `versatz` (keine erkannten gedruckten Seitenzahlen, typisch bei Preprints), ist die Seite `nicht_pruefbar`. Echter Fall: Berndtsson und Asatiani, Seitenfeld passte nicht zur gedruckten Seite.
- `schreiben/zahlen.mjs` prüft nur das Textstück, das `doc_edit` schreibt. Grafik-Umgebungen werden nur entfernt, wenn `\begin{tikzpicture}` und `\end{tikzpicture}` beide im Stück stehen. Bei einem Edit mitten in einer Grafik fehlen sie; gemeldet wurden echte Werte wie „0.4“ und „4.4,0“. `\tikzset`, `\pgfplotsset`, `\tikzstyle`, `\geometry`, `\hypersetup`, `\captionsetup` und Längenangaben sind nicht ausgenommen.
- ADR 0004 bleibt: Der Server prüft Wortlaut und Existenz, kein inhaltliches Urteil über Paraphrasen. Die Paraphrasenprüfung übernimmt der Gegenprüf-Agent im Plugin (Plan P17).

## Decisions
Owner-Entscheidungen (2026-11-16):
- `\textcite` vor dem Zitat erkennen, Preprint-Seiten über PDF-Seiten prüfbar machen, LaTeX-Konfigurationswerte aus `zahlen_ohne_beleg` herausfiltern.
- Alle Keys eines Mehrfachzitats prüfen; `\Textcite`, `\Parencite`, `\citeauthor`, `\citeyear` und verwandte Formen erkennen.
- Paraphrasen prüft der Server nicht.
Annahmen (ohne Rückfrage getroffen):
- Vorangestellter Beleg: Ein Zitat ohne nachfolgenden Beleg wird mit dem letzten `\textcite`, `\Textcite`, `\citet`, `\citeauthor` oder `\nptextcite` davor verknüpft, wenn dieser im selben Satz steht (kein Satzende `.`, `!`, `?` gefolgt von Leerraum und kein Absatz dazwischen) und höchstens 300 Zeichen entfernt ist. Die Seite kommt aus dessen optionalem Argument; fehlt sie dort und folgt dem Zitat ein `\parencite[S.~x]{key}` oder ein reines `(S.~x)`, gilt diese Seite. Der vorangestellte Beleg erzeugt dann keine eigene Zeile `beleg_ohne_wortlaut`. Ein nachfolgender Beleg hat Vorrang vor einem vorangestellten.
- Erkannte Befehle zusätzlich: Großschreibung jedes bekannten Befehls (`\Textcite`, `\Parencite`, `\Autocite`, `\Cite`, `\Citet`, `\Citep`), `smartcite`, `supercite`, `fullcite`, `footfullcite`, `nptextcite`, `citealp`, `citealt`, `citeauthor`, `citeyear`, `citeyearpar`, `citetitle` und die Mehrfachformen `cites`, `parencites`, `textcites`, `autocites`, `footcites` (jedes Paar aus optionalen Argumenten und Key zählt als eigener Beleg). Sternformen wie bisher. `\nocite` bleibt ausgenommen. Was danach noch „cite“ im Namen trägt und unbekannt ist, bleibt `unbekannt`.
- Mehrere Keys: Eine Stelle ohne Wortlaut mit n Keys ergibt n Zeilen, je Key eine, mit eigener Referenzprüfung; die Zählung zählt jede. Eine Stelle mit Wortlaut und mehreren Keys gilt als geprüft, wenn der Wortlaut in mindestens einer der Quellen steht; die Zeile nennt diese Quelle, die übrigen Keys erscheinen als eigene Zeilen ohne Wortlaut. Jede Zeile trägt `key`; bestehende Felder bleiben.
- Seite ohne gedruckte Seitenzahlen: Hat die Quelle keinen `versatz`, wird die Seitenangabe gegen die PDF-Seite geprüft. Stimmt sie, lautet der Status `stimmt` mit `seitenbasis: "pdf"`; steht der Wortlaut auf einer anderen PDF-Seite, `gefunden` mit `gefundenAuf` und `seitenbasis: "pdf"`. Der Bericht zeigt dazu „PDF-Seite“ statt „Seite“. Quellen mit `versatz` verhalten sich wie bisher (`seitenbasis: "gedruckt"`). `nicht_pruefbar` bleibt nur, wenn der Wortlaut gar nicht gefunden wurde oder keine Zahl in der Seitenangabe steht.
- Zahlenprüfung: `doc_edit` übergibt der Prüfung zusätzlich die Position des Stücks im Dokument. Liegt die Position innerhalb einer Grafik-Umgebung (die bisherigen plus `scope`, `tikzcd`, `circuitikz`, `forest`, `pgfonlayer`), einer Mathe-Umgebung gilt die bestehende Formelregel, innerhalb der Präambel (vor `\begin{document}`) wird nichts gemeldet. Unabhängig von der Position nicht gemeldet: Argumente von `\tikzset`, `\tikzstyle`, `\pgfplotsset`, `\usetikzlibrary`, `\geometry`, `\hypersetup`, `\captionsetup`, `\setstretch`, `\linespread`, `\rule`, `\resizebox`, `\scalebox`, `\includegraphics` (bereits), `\newlength`, `\addtolength`, `\definecolor` (bereits), Spaltenangaben von `tabular`/`tabularx`/`array` (`p{0.3\textwidth}`), Zahlen direkt vor einer Längeneinheit (`pt`, `mm`, `cm`, `in`, `em`, `ex`, `bp`, `\textwidth`, `\linewidth`, `\columnwidth`, `\baselineskip`) und Koordinatenpaare der Form `(x,y)` in Zeilen, die mit `\draw`, `\node`, `\path`, `\fill`, `\filldraw`, `\coordinate`, `\clip` oder `\addplot` beginnen.
- Weiter gemeldet werden Zahlen in `\node`-Beschriftungen (Text in geschweiften Klammern einer Grafik) nicht; Zahlen in Tabellenzellen und im Fließtext wie bisher. Die Regeln zu Formeln, siunitx, Datum, Version und Software aus P6, P8 und P10 bleiben unverändert und ihre Tests grün.

## Quality bar
- MCP und API: bestehende Fehlercodes und Felder bleiben unverändert; neue Zustände, Felder und Hinweise haben feste Schlüssel und stehen in `docs/mcp-contract.md`. Listen sind paginiert (50 je Seite, `cursor`).
- Zugriff wird bei jedem Aufruf für das angesprochene Projekt geprüft; ein Konto ohne Schreibrecht kann nichts ändern.
- Fehlermeldungen sagen, was passiert ist und was zu tun ist. Ein Ausfall eines fremden Dienstes wird nie als Befund über die Arbeit ausgegeben.
- Fremder Text (Metadaten, Quellen, Dateinamen, Logs) wird als Daten behandelt; SSRF-Schutz (`netz.mjs`) gilt für jede neue ausgehende Anfrage.
- Web: per Tastatur bedienbar mit sichtbarem Fokus, Kontrast mindestens 4,5:1 (hell und dunkel), kein horizontales Rollen bei 360 px, keine Konsolenfehler, keine nativen `alert`/`confirm`/`prompt`.
- Texte: deutsch geduzt und englisch in beiden Sprachdateien; deutsche Texte mit humanizer-de, englische mit humanizer geprüft.

### Tests (TDD)
- Jede Änderung an Server- oder Frontend-Logik beginnt mit einem roten Test unter `services/web/modules/spur/test/unit` bzw. `test/frontend`; die echten Fälle aus `## Context` sind als Testfälle enthalten.
- Externe Dienste laufen über die vorhandenen Fakes (`PaperFake`, `TexLiveFake`); neue Störungen bekommen Schalter im Fake.
- Die E2E-Suite bekommt je Feature Schritte (`p14f1` …) und läuft nach dem Zurücksetzen der Testdaten vollständig grün, auch alle älteren Features.
- `spur-dev test` bleibt über 80 % Zeilenabdeckung; `node --test tools/tests/*.test.mjs` ist grün (auch der Vertragstest `mcp-vertrag.test.mjs`).
- Overleafs eigene Suiten bleiben grün bis auf die bekannte Upstream-Liste.
