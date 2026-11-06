# 0003: Eigenes Claude Code über HTTP-MCP und Plugin

## Context and Problem Statement
Nutzer bringen ihr eigenes Claude mit. Ein Drittprodukt darf keinen claude.ai-Login anbieten. Channels sind Preview und brauchen ein Dev-Flag.

## Considered Options
- Lokales Claude Code als MCP-Client
- Server-Agent mit API-Key
- Connector und Cloud-Sessions

## Decision Outcome
Lokales Claude Code spricht per HTTP-MCP mit spur, eingerichtet über ein Plugin mit Token in `userConfig`. Aufträge kommen über das Long-Poll-Tool `wait_for_event` mit Fortschrittsmeldungen. Lauf 0 hat das am 2026-11-06 mit Claude Code 2.1.319 belegt: Der Aufruf wandert nach zwei Minuten in den Hintergrund, und ein eintreffender Auftrag weckt die untätige Session ohne Channel und ohne Dev-Flag. Rückfallebene ist `/spur:lauf` im Terminal, ein Channel bleibt optional.

### Consequences
- spur speichert keine Abo-Daten von Claude.
- Aufträge gehen nur an eine offene Session. Nach jedem Auftrag ruft Claude `wait_for_event` erneut auf; das steht in den Server-Instructions und im Plugin-Skill.
- Die Inbox speichert Ereignisse mit Cursor, damit nichts verloren geht, wenn gerade kein Aufruf wartet.
- Token gelten 90 Tage, sind widerrufbar und haben nie mehr Rechte als das Overleaf-Konto.
- Connector und Cloud-Knopf stehen im Backlog; die HTTP-Schnittstelle bleibt dafür offen.
