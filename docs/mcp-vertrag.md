# MCP-Vertrag von spur

Stand: Entwurf vor Lauf 0. Änderungen an Namen und Fehlercodes gelten als Bruch und brauchen eine neue Version.

## Transport und Anmeldung
- Streamable HTTP unter `/spur/mcp`, Bearer-Token mit Scope `spur_mcp`.
- `Origin` wird geprüft, ungültig ergibt 403. Host-Allowlist, Rate-Limit, keine Sitzungs-Cookies.
- Jeder Aufruf prüft die Projektrolle: `read` liest, `review` und `write` schreiben Track Changes.
- Plugin `plugins/spur` setzt `userConfig` für Server-URL und Token.

## Regeln
- Quellentext ist nicht vertrauenswürdig. Standardantworten enthalten Urteil und Position, Text nur auf Anforderung und gekürzt.
- Kommentare anderer Personen werden nur als ID gemeldet.
- Es gibt keine Tools zum Annehmen, Löschen, Umbenennen oder Verschieben.
- Ein Lauf beginnt beim ersten Schreiben. Antworten überschreiten 10.000 Tokens nicht; lange Aufgaben liefern ein Job-Handle.

## Tools

| Tool | Plan | Zweck |
|---|---|---|
| `project_list`, `doc_list`, `doc_read` | P1 | Projekte und Dokumente lesen |
| `sources_list`, `source_search`, `source_read` | P1 | Quellen suchen und Abschnitte lesen |
| `quote_mark` | P1 | Fundstelle in einer Quelle markieren |
| `check_report` | P1 | Prüfbericht des Projekts |
| `bib_list` | P1 | Referenzen und ihre Status |
| `doc_edit` | P1 | Änderung als Track Change, mit erwartetem Alttext und Idempotenz-Schlüssel |
| `doc_create` | P1 | Leeres Dokument anlegen, Inhalt folgt über `doc_edit` |
| `run_status`, `run_finish` | P1 | Lauf abfragen und mit Zusammenfassung beenden |
| `wait_for_event` | P1 | Long-Poll: wartet auf den nächsten Auftrag, sendet alle 30 s Fortschritt |
| `events_since`, `reply` | P1 | Verpasste Ereignisse per Cursor holen und antworten |
| `paper_search`, `paper_lookup`, `paper_citations` | P2 | Recherche |
| `source_add`, `acquisition_add` | P2 | Quelle aufnehmen oder auf die Beschaffungsliste setzen |
| `job_status`, `compile`, `compile_log`, `page_image` | P2 | Kompilieren und Ergebnis sehen |
| `suggest` | P3 | Vorschlag ins Panel legen |

## Fehlercodes von `doc_edit`

| Code | Bedeutung |
|---|---|
| `zitat_abweichend` | Der Wortlaut steht nicht in der Quelle |
| `quelle_fehlt` | Zum Beleg gibt es keine Quelle mit Text |
| `konflikt` | Der erwartete Alttext stimmt nicht mehr, neu lesen |
| `doc_fehlt` | Das Dokument ist gelöscht |
| `grenze_changes` | Das Dokument nähert sich 2000 offenen Changes |
| `keine_rechte` | Die Projektrolle erlaubt das nicht, oder das Projekt gibt es nicht |
| `pfad_ungueltig` | Nur `doc_create`: Der Dateiname ist nicht erlaubt |

Unerkannte Zitatformen und nicht auflösbare DOIs werden angenommen, aber rot markiert und nie automatisch übernommen.

## Ereignisse für `events_since`
`task_created`, `chat_message`, `comment_mention`, `suggest_trigger`. Jedes Ereignis gilt für genau einen Bot.
