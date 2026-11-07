Type: web, api

# spur P3: Claude in der App

## Zweck
Nutzer sprechen im Editor mit ihrem Claude, rufen es an Textstellen und bekommen zwei vorsichtige Vorschläge, ohne den Text ungefragt zu ändern.

## Nutzer
Wie P1.

## Was Nutzer können
- Im Chat-Panel mit der eigenen Claude-Session sprechen.
- `@claude` an einer Textstelle im Kommentar schreiben.
- Vorschläge zu Compile-Fehlern und beleglosen Argumenten ein- oder ausschalten.
- Fertige Workflows als MCP-Prompts starten, im Terminal oder per Knopf im Panel.

## Zustände der Oberfläche
Chat: nicht verbunden, wartet, antwortet, lange Unterhaltung. Vorschläge: aus, keine, mehrere, Tageslimit erreicht.

## Decisions
- Es gelten `docs/adr`, `docs/mcp-vertrag.md` und die Entscheidungen aus P1 und P2.
- Weckweg ist `wait_for_event` aus P1. Ein Channel ist nicht nötig.
- Nur zwei Schalter: Compile-Fehler und belegloses Argument, je Aus oder Vorschlag, Standard Aus, pro Nutzer mit Projekt-Standard. Keine Stufe Auto. Weitere Schalter stehen in `docs/backlog.md`.
- Auslöser: 60 Sekunden Tipp-Pause oder Kompilieren. Standardlimit 50 pro Tag, einstellbar.
- Vorschläge liegen nur im Panel. Übernehmen startet einen normalen Lauf.
- `@claude` erreicht nur die Session der schreibenden Person. Der Kommentartext anderer Personen geht nur als ID an Claude.
- Workflows sind MCP-Prompts des spur-Servers: Literaturüberblick, Methodenteil, Folien aus Paper. Eine Quelle für den Text: `prompts/get` und der Panel-Knopf liefern denselben Text, der Panel-Knopf legt ihn vollständig in den Auftrag, weil Claude MCP-Prompts nicht selbst aufrufen kann (nicht verifiziert). Argumente sind einzelne Wörter. Keine Workflow-Skills im Plugin. Standardtexte liegen im Modul, Site-Admins ändern sie im Admin-Bereich, gespeichert in Mongo.

## Testbarkeit
Wie P1 mit `SPUR_FAKE_AGENT=1`. Der echte Weckweg wird je Meilenstein von Hand geprüft.

## Quality bar
Wie P1. Der Chat ist per Tastatur bedienbar, neue Nachrichten werden Screenreadern angesagt.
