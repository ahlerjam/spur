# 0001: spur als Modul im web-Dienst

## Context and Problem Statement
spur ergänzt overleaf-cep um Quellen, Prüfung und eine MCP-Schnittstelle. Der Betrieb soll so einfach bleiben wie bei Overleaf, und Updates vom Fork sollen wenig kosten.

## Considered Options
- Modul `services/web/modules/spur` mit wenigen Kern-Patches
- Eigener Dienst `services/spur`
- Sidecar-Container

## Decision Outcome
Modul im web-Dienst. Ein eigener Dienst bräuchte rund ein Dutzend neue interne Endpunkte für Baum, Dateien, Compile und Label sowie Workspace, runit und nginx-Regel. Kern-Patches bleiben auf `settings.defaults.js`, Sprachdateien, History-Anzeige, neue document-updater-Endpunkte und den Hook `projectDuplicated` in `ProjectDuplicator.mjs` begrenzt. Der Hook ist eine Zeile und lässt ein kopiertes Projekt den Hinweis „Quellen wurden nicht mitkopiert“ zeigen. Dazu kommt das Nachladen unbekannter Autoren im Review-Panel (`changes-users-context.tsx`, `review-panel-change-user.tsx`): Der Claude-Bot ist kein Projektmitglied, seine erste Änderung erschiene sonst bis zum Neuladen als „Deleted user“.

### Consequences
- Keine neue Datenbank und kein neuer Dienst.
- Rechenintensive Arbeit läuft als Kindprozess oder Job, nicht im Request.
- Jeder Fork-Update-PR muss die Kern-Patches mitprüfen.
