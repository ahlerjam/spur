# Fortschritt P12

## Recipe changes
- Stack: `spur-dev up` aus diesem Worktree, `dev-schalter.json` = `{"SPUR_PAPER_API_BASE": "http://127.0.0.1/spur/dev/crossref"}`.
- Browser-Suite wie in P5: `.playwright-mcp/mach-wrapper.sh [p12f1,…]` (gitignoriert) erzeugt `start.js`, das `spur-e2e.js` startet, ohne zu warten; `poll.js` fragt das Ergebnis in Aufrufen unter 60 s ab. Der Gesamtlauf braucht auf diesem Rechner etwa 19 Minuten.
- `spur-dev test` zeigt nur die letzten 60 Zeilen. Für die Liste aller roten Tests half ein kleiner Läufer im Modulordner (nicht im Repo), der vitest über `vitest/node` mit JSON-Reporter startet: `spur-dev run modules/spur/test/<läufer>.mjs`.
- Neue Übersetzungsschlüssel, die das Frontend nutzt, müssen zusätzlich in `services/web/frontend/extracted-translations.json` stehen; sonst zeigt die Oberfläche den Schlüssel.

## Rauchtest vor dem Bauen
- Gesamtlauf auf dem Stand vor P12: 96 von 98 grün. Rot waren `p5f8` (Backlog hat seit dem Commit „Ideen aus dem Altprojekt“ 45 statt 41 Einträge; Zahl im Schritt angepasst) und `p10f4` (der Lauf beim Laden der Seite und der angestoßene Compile überholen sich, ein übersprungener Lauf ersetzt das Log mit dem Hinweis; der Schritt zählt den Hinweis jetzt erst, wenn er 3 s stehen bleibt). Beide danach grün.

## Entscheidungen
- E2E-Schlüssel `p12f1` bis `p12f5`, Projekt „E2E P12 Quellen“.
- Unpaywall: Feldnamen `oa_locations`, `host_type`, `url_for_pdf`, `url_for_landing_page`, `license` über Context7 belegt (Datenformat-Doku des Clients unpywall, die Unpaywalls Schema wiedergibt). Fehlt `oa_locations` in einer Antwort, nimmt spur `best_oa_location`.
- f1: `unpaywall.status` liefert `{ frei, fundorte }` statt `{ frei, pdf, lizenz }`. Sagt Unpaywall „frei“, kennt aber keine PDF-Adresse, fragt spur trotzdem Europe PMC; erst ohne jeden Fundort bleibt es bei `nicht_frei`.
- f1: Ergebnisse in `versucht`: `html`, der HTTP-Status als Text (`403`, `404`, …), `kein_pdf` (2xx, weder PDF noch HTML), `falsches_pdf`, `zu_gross`, `gesperrt` (Adresse nicht erlaubt), `netzfehler`. Wiederholt werden nur Netzfehler, 429 und 503. Ein unlesbares PDF zählt als `kein_pdf`, der nächste Fundort wird versucht.
- f1: Fehler tragen Zusatzfelder (`Problem.zusatz`): Über MCP stehen sie neben `fehler` und `detail`, in Web-Antworten als Erweiterungsfelder nach RFC 9457.
- f1: Der Titelabgleich läuft in `QuellenManager.aufnehmen`, sobald der Aufrufer einen Titel vorgibt (DOI-Aufnahme, Upload mit `doi` oder `titel`). Beim Upload mit `doi` holt spur dafür die Metadaten der angegebenen DOI; vorher kamen sie nur aus einer DOI im PDF-Text.
- f1: Die Lizenz des Fundorts steht an der Quelle (`lizenz`) und im Quellen-Panel („Lizenz: CC BY“).
- Fake: Werke mit `nurDoi` kennt Crossref per DOI, sie tauchen in keiner Suche auf. `fundorte` je Werk mit `liefert` (Dateiname, `html` oder Status); Störungen für alle Fundorte über `stoerungen.fundort`.
- f2: `Beschaffung.aufnehmenOderVormerken` umschließt die Aufnahme per DOI für MCP (`source_add`) und die Web-Route. Bei `nicht_frei` und `bot_schutz` legt sie den Eintrag an (Felder `grund`, `adresse`) oder ergänzt einen vorhandenen; der Fehlertext sagt dann, dass das Paper auf der Liste steht. Lässt sich der Eintrag nicht anlegen, kommt der ursprüngliche Fehler ohne diesen Satz.
- f2: „Beste Adresse“ ist die Artikelseite (`url_for_landing_page`) des ersten Fundorts, der den Server abgewiesen hat, sonst dessen PDF-Adresse. Sie steht bei `bot_schutz` auch in der Antwort (`adresse`). Die Liste verlinkt sie nur mit http(s).
- f2: Ein von Hand angelegter Eintrag (`acquisition_add`) hat keinen Grund und zeigt kein Abzeichen.
- f3: Suchdienste wiederholen 429, 503 und Netzfehler (höchstens 3 Versuche, 20 s). `versuche` je Dienst ist die höchste Zahl an Versuchen für eine einzelne Anfrage; 0 heißt: Antwort aus dem Cache. Die Pausenregel teilen sich Suche und Volltext-Download (`recherche/wiederholen.mjs`).
