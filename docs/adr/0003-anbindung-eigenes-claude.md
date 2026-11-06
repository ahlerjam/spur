# 0003: Eigenes Claude Code über HTTP-MCP und Plugin

## Context and Problem Statement
Nutzer bringen ihr eigenes Claude mit. Ein Drittprodukt darf keinen claude.ai-Login anbieten. Channels sind Preview und brauchen ein Dev-Flag.

## Considered Options
- Lokales Claude Code als MCP-Client
- Server-Agent mit API-Key
- Connector und Cloud-Sessions

## Decision Outcome
Lokales Claude Code spricht per HTTP-MCP mit spur, eingerichtet über ein Plugin mit Token in `userConfig`. Grundlage ist Abruf mit Inbox. Der Sofort-Weg (Long-Poll, Monitor oder Channel) wird in Lauf 0 mit echtem Claude entschieden; Rückfallebene ist `/spur:lauf` im Terminal.

### Consequences
- spur speichert keine Abo-Daten von Claude.
- Token gelten 90 Tage, sind widerrufbar und haben nie mehr Rechte als das Overleaf-Konto.
- Connector und Cloud-Knopf stehen im Backlog; die HTTP-Schnittstelle bleibt dafür offen.
