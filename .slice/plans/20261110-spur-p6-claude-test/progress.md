# Fortschritt P6

## Entscheidungen im Lauf (umkehrbar)
- f1: `claude --help` zeigt `--allowedTools <tools...>` als variadische Option. Ein direkt folgender Prompt würde als
  Werkzeugname geschluckt; der Startbefehl setzt deshalb `--` vor den Prompt:
  `claude --allowedTools "…" -- "Warte mit wait_for_event auf Aufträge aus spur."`. Der echte Start bleibt Handprüfung
  nach dem Merge (Spec).
- f1: Das Claude-Panel fragt den Status alle 2 s statt 5 s ab, damit „Claude verbunden“ auch mit Antwortzeit binnen 5 s
  erscheint (`useAbfrage` hat dafür einen optionalen Takt).
- f2: Die @claude-Stelle kommt zuerst aus den Ranges des document-updater (`getProjectRanges`), dann aus dem Docstore.
  „Seit mehr als 10 Minuten geschlossen“ prüft die E2E-Suite mit einem Dokument, das im Lauf noch nie geladen war; zum
  Kommentieren muss es ohnehin geöffnet werden.
- f3: Neuer Erweiterungspunkt `reviewPanelComments` (wie `railEntries`) in Overleafs Review-Panel: Module heben Teile
  eines Kommentars hervor und zeigen Hinweise unter dem Eingabefeld. Kern-Patch in
  `review-panel-expandable-content.tsx`, `review-panel-add-comment.tsx`, `review-panel-comment-content.tsx` und
  `utils/comment-extensions.ts`. Farbe wie Overleafs Erwähnungen (`--content-info-themed`).
- f4: Crossref wiederholt bei 429/503 bis zu vier Versuche (Retry-After, sonst 1, 2, 4 s; höchstens 5 s je Pause). Die
  5-Minuten-Sperre im Speicher ist weg. `referenz` hat statt `unbekannt` den Zustand `nicht_pruefbar` mit
  `grund: crossref_nicht_erreichbar`; 404 bleibt `nicht_gefunden`, angezeigt als „DOI bei Crossref unbekannt“.
- f4/f5: Der Paper-Fake kennt `stoerungen` je Dienst oder `crossref:<doi>` (Status, Retry-After, Anzahl, Abbruch) und
  `cachesLeeren` (Crossref- und Paper-Cache), nur im Dev-Stack.
- f5: `paper_search`/`paper_citations` liefern `dienste` (je Dienst `geantwortet`, `gedrosselt`, `nicht_erreichbar`)
  und `hinweis`, wenn keiner geantwortet hat. Das Feld `hinweise` (Dienst ohne Key aus) entfällt.
- f6: Unpaywall nimmt `UNPAYWALL_EMAIL`, sonst `CROSSREF_MAILTO`. Im Dev-Stack mit Paper-Fake gilt weiter eine
  Testadresse, die die E2E-Suite über den Schalter leeren kann (`umgebung()` in `schalter.mjs`).
- f7: Zahlen, die irgendwo in `ergebnisse.tex` (Wurzelordner) stehen, gelten als belegt, auch mit anderem
  Dezimalzeichen.
- f8: Einordnung je Zitierstelle: Crossref-Ausfall vor fehlender Quelle, dann fehlende Seitenangabe (nur bei
  wörtlichem Zitat), dann Quelle ohne Text. Die Abschnitts-Statistik heißt intern `abschnitte` und erscheint weder im
  Panel noch in `check_report`.
- f9: TeX Live zieht Paketabhängigkeiten aus der tlpdb nach (lokal belegt für beamer: pgf, translator, xcolor). Für
  mhchem, chemformula und siunitx sind `chemgreek` und `translations` ausdrücklich aufgenommen; ungetestet, weil der
  Image-Bau hinter dem Proxy nicht geht. Beleg ist der Smoke-Test nach dem Merge.

## Handprüfungen nach dem Merge
- f1: echter Start von Claude Code mit dem neuen Startbefehl.
- f9: Workflow `Smoke` auf spur ist grün (kompiliert APA und Folien mit metropolis, ngerman, mhchem, chemformula,
  siunitx).

## Needs decision
- f7: Gilt eine Zahl, die in `ergebnisse.tex` steht, auch im Fließtext als belegt?
  Interim: Nur in Formeln und siunitx-Werten (`\qty{75.7}{…}` mit 75.7 in `ergebnisse.tex` wird nicht gemeldet, wie
  f7 Schritt 4 verlangt). Im Fließtext bleibt eine getippte Zahl gemeldet, auch wenn `ergebnisse.tex` sie als Makrowert
  hat; das hält p2f8 („bitte als Makro einsetzen“) grün.
  Options: A (empfohlen) so lassen, Fließtext soll das Makro nutzen | B überall als belegt werten und p2f8 anpassen |
  C nirgends als belegt werten, nur Makros zählen (f7 Schritt 4 entfiele)

## Abschluss: Review-Befunde
- Behoben: Crossref-Ausfallfenster verlängert sich nicht mehr durch Einzelversuche.
- Geprüft, nicht geändert:
  - Crossref bei Netzfehlern und Timeouts: nachträglich behoben, 30 s Negativ-Cache nur für Netzfehler (keine HTTP-Antwort).
    HTTP-Antworten wie 503 sperren weiter nicht, damit f4 Schritt 7 (sofortige Aufnahme) gilt.
  - Takt im Claude-Panel per Effekt: Der Status kommt aus demselben Hook, der den Takt braucht. Der eine zusätzliche
    Render beim Wechsel von verbunden/getrennt ist gewollt.
  - Zweimal `zahlenOhneBeleg` in `SchreibManager`: Der erste Lauf entscheidet billig, ob `ergebnisse.tex` überhaupt
    geladen werden muss. Ein Nachfiltern geht nicht, weil die Ausnahme nur für Formeln und siunitx-Werte gilt.
  - Späte Unpaywall-Prüfung in `perDoi`, Dienste ohne Schlüssel (so in der Spec entschieden), Prompt-Quoting (eigene
    Übersetzungen ohne Sonderzeichen), 1.000/1,000, `\item [3 …]` (Spec: optionale Argumente nicht melden), Robustheit
    des Dev-Fakes.
- /security-review: keine Befunde.

## Abschluss: Screenshots (360 und 1280 px)
Token-Dialog, Claude-Panel, Kommentar mit @claude (Antwort und neuer Kommentar mit Hinweis), Prüfbericht mit Zählung
und Gründen, Recherche mit Dienst-Hinweis, Zitationen ohne antwortenden Dienst und Quellen-Vorschau, je 360 und 1280 px;
kein seitliches Rollen, keine Seitenfehler. Gesamtlauf der E2E-Suite nach der letzten Code-Änderung (Commit 15091690bd um 13:48, Lauf beendet 13:58): 53 von 53 ok.

## Vorschläge (außerhalb dieses Plans)
- Overleafs Review-Panel schneidet bei 360 px die Kommentare links an (Overleaf-Layout, nicht der spur-Patch).
- Die Marke „Nicht frei“ in der Recherche (P2) hat im dunklen Design wenig Kontrast.
