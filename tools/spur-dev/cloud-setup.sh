#!/bin/bash
# Setup-Skript für die Cloud-Umgebung „spur“ auf claude.ai/code. Inhalt in das Feld
# „Setup script“ der Umgebung kopieren. Läuft als root vor dem Start von Claude Code;
# das Ergebnis (spur-dev und die gezogenen Images) landet im Umgebungs-Cache.
set -uo pipefail
QUELLE=https://raw.githubusercontent.com/ahlerjam/spur/agent/tools/spur-dev

(service docker start >/dev/null 2>&1 || nohup dockerd >/var/log/dockerd.log 2>&1 &) || true
for _ in $(seq 1 30); do docker info >/dev/null 2>&1 && break; sleep 1; done

mkdir -p /opt/spur-dev
curl -fsSL "$QUELLE/spur-dev" -o /opt/spur-dev/spur-dev
curl -fsSL "$QUELLE/compose.yml" -o /opt/spur-dev/compose.yml
bash /opt/spur-dev/spur-dev install --cloud

# Images vorab ziehen, damit jede Session sie aus dem Cache hat.
docker pull -q ghcr.io/ahlerjam/spur-dev:amd64 &
docker pull -q mongo:8.0 &
docker pull -q redis:6.2 &
wait
exit 0
