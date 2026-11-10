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
