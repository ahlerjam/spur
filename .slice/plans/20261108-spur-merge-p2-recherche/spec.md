Type: web, api

# spur: P2 Recherche und Design auf den Agent-Zweig bringen

## Zweck
Plan `20261106-spur-p2-recherche` ist fertig (alle 10 Features bestanden, unabhängig abgenommen), ließ sich aber nicht in den Agent-Zweig mergen, weil Plan `20261106-spur-p4-quellen` inzwischen dieselben Dateien geändert hat. Dieser Plan führt beide Stände zusammen, ohne dass Nutzer eine Funktion von P2 oder P4 verlieren.

## Nutzer
Wie in P1, P2 und P4: Forschende und Studierende, die spur und ihr Claude Code nutzen.

## Was Nutzer können
Alles aus P2 (Literatursuche, Open Access, Beschaffungsliste, Import, Notizen und Matrix, Compile-Ergebnis, Zahlen aus `ergebnisse.tex`, KI-Offenlegung, semantische Suche) und alles aus P4 (Zitate gemeinsam nutzen, OCR-Scans, Webseiten-Schnappschüsse, Hinweis zu Interviews) zusammen in einer Anwendung.

## Context
Der Stand von P2 liegt auf `origin/slice/run-20261106-spur-p2-recherche` (Commit d93d6d865f). Der Merge des Agent-Zweigs in diesen Zweig scheitert mit Konflikten in 15 Dateien: SpurRouter, SpurController, QuellenManager, ZitatManager, quellen-panel/zitate.tsx, spur.scss, die Locale-Dateien, spur-e2e.js und vier Unit-Tests. Die Specs und Features beider Pläne liegen unter `.slice/plans/20261106-spur-p2-recherche/` und `.slice/plans/20261106-spur-p4-quellen/`.

## Decisions
- Es gelten `docs/adr`, `docs/mcp-vertrag.md` und alle Entscheidungen aus P1, P2 und P4.
- Der Lauf-Zweig wird wie immer aus dem Agent-Zweig erzeugt. Der Builder mergt `origin/slice/run-20261106-spur-p2-recherche` dort hinein (`git merge --no-edit`, Konflikte von Hand lösen). Kein Rebase, kein Force-Push, keine Änderung am P2-Zweig.
- Bei Konflikten bleibt das Verhalten beider Seiten erhalten. Keine Funktion von P2 oder P4 wird gestrichen oder abgeschwächt. Ist das nicht möglich, steht die Frage unter `## Needs decision` in `progress.md`.
- Locale-Dateien: die Schlüssel beider Seiten bleiben, Dubletten mit unterschiedlichem Text werden gemeldet, nicht still überschrieben.
- Es entsteht keine neue Funktion. Neue Dateien und Änderungen dienen nur dem Zusammenführen und dem Wiederherstellen grüner Tests.
- Die Pläne P2 und P4 sowie ihre `features.json` werden nicht verändert.

## Testbarkeit
Wie P1, P2 und P4: `spur-dev test` und die E2E-Datei, dazu `SPUR_PAPER_API_BASE` mit aufgezeichneten Antworten und `SPUR_FAKE_EMBEDDINGS=1`. Der Test mit echtem Modell bleibt Handarbeit außerhalb der Sandbox.

## Quality bar
- Der Merge-Commit enthält keine Konfliktmarker (`<<<<<<<`, `=======`, `>>>>>>>`) in irgendeiner Datei.
- `spur-dev test` ist grün, nach dem letzten Code-Änderung gezeigt.
- Die E2E-Schritte aus P2 (f1 bis f10) und P4 (f1 bis f4) laufen gegen die laufende Anwendung und bestehen.
- Oberflächen aus beiden Plänen sind bei 360 und 1280 px ohne Layoutbruch (`spur.scss` ist eine der Konfliktdateien).
