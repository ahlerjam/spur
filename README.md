# spur

spur ist eine selbst gehostete Schreibumgebung für wissenschaftliche Arbeiten auf Basis von [overleaf-cep](https://github.com/yu-i-i/overleaf-cep). Sie verwalten Quellen im Editor, fügen Zitate per Knopf ein und sehen in einem Prüfbericht, ob Wortlaut, Seite und Referenz stimmen und ob eine Arbeit zurückgezogen wurde. Ihr eigenes Claude Code schreibt mit, ohne Zitate erfinden zu können.

## Installation

Sie brauchen Docker mit Compose und `make`. MongoDB 8 startet nicht auf Linux-Kerneln 6.19 bis 7.0.13 ([SERVER-121912](https://jira.mongodb.org/browse/SERVER-121912)); Server brauchen einen Kernel bis 6.18 oder ab 7.0.14.

```sh
git clone https://github.com/ahlerjam/spur.git
cd spur
make start
```

`make start` legt beim ersten Start ein `.env` mit einem zufälligen `OVERLEAF_INVITE_TOKEN_SECRET` an und startet das veröffentlichte Image. Ohne dieses Secret startet der Container nicht. spur läuft danach auf <http://localhost:8080>. Das erste Administratorkonto legen Sie unter `/launchpad` an.

| Befehl | Wirkung |
|---|---|
| `make start` | Startet spur |
| `make stop` | Stoppt spur |
| `make seed` | Legt Demo-Daten an |
| `make test` | Führt die Unit-Tests aus |
| `make e2e` | Führt Playwright gegen den laufenden Stack aus |

`SPUR_URL`, `SPUR_PORT` und `SPUR_IMAGE` ändern Adresse, Port und Image. Die Sprache gilt für die ganze Installation: Standard ist Deutsch, `OVERLEAF_SITE_LANGUAGE=en` im `.env` stellt auf Englisch um. Backups umfassen das Volume `spur_data` und die MongoDB.

Betreiben Sie spur öffentlich, ist die Compile-Sandbox Pflicht:

```sh
SPUR_DATA_DIR=/srv/spur docker compose -f docker-compose.yml -f docker-compose.sandbox.yml up -d
```

### HTTPS

Für einen Server im Netz gehört ein Reverse Proxy mit TLS vor spur. Im `.env` stehen dann:

```sh
SPUR_URL=https://spur.example.org
OVERLEAF_SECURE_COOKIE=true
```

Beispiel für [Caddy](https://caddyserver.com), das Zertifikate selbst holt:

```
spur.example.org {
	reverse_proxy localhost:8080 {
		flush_interval -1
	}
}
```

`flush_interval -1` reicht Antworten sofort durch. Das braucht der MCP-Endpunkt `/spur/mcp`, der lange auf Aufträge wartet und alle 30 Sekunden Fortschritt sendet. Läuft der Proxy nicht auf demselben Rechner, ergänzen Sie seine Adresse in `OVERLEAF_TRUSTED_PROXY_IPS` (zum Beispiel `loopback,10.0.0.5`).

## Entwicklung und Tests

Entwickelt wird mit `spur-dev` aus `tools/spur-dev/`: `tools/spur-dev/spur-dev install` legt den Befehl an, `spur-dev up` startet den Stack aus dem Dev-Image mit dem eingehängten Quellcode.

| Befehl | Wirkung |
|---|---|
| `spur-dev test` | spur-Unit-Tests mit Abdeckungsbericht für `modules/spur/app/src` (mindestens 80 % der Zeilen) |
| `spur-dev upstream web` | Overleafs web-Unit-Suite |
| `spur-dev upstream frontend` | Overleafs Frontend-Suite, mit den Tests unter `modules/spur/test/frontend` |
| `spur-dev upstream du` | Unit- und Acceptance-Tests des document-updater |
| `spur-dev upstream alle` | Alle drei Suiten nacheinander |
| `spur-dev upstream vergleich` | Dieselben Suiten auf `main` (Overleaf), `ext-ce` (overleaf-cep) und dem aktuellen Stand; schreibt die Liste bekannter Fehler neu |
| `spur-dev run modules/spur/test/e2e/vorbereiten.mjs` | Bereitet die E2E-Suite vor; danach `make e2e` |

Die `upstream`-Befehle laufen in einem eigenen Container mit `NODE_ENV=test` und einer eigenen Test-Datenbank und enden mit der Zeile `bestanden, fehlgeschlagen, bekannt, neu`. Sie scheitern nur an neuen Fehlern. Fehler, die schon in Overleaf oder overleaf-cep auftreten, stehen mit Herkunft und Grund in `tools/tests/upstream-bekannt.json`; Testdateien, die Module von Overleaf Server Pro brauchen, stehen in `tools/tests/upstream-ausschluss.json`. Ein Eintrag mit Herkunft `spur` ist nicht erlaubt: Was spur kaputt macht, wird behoben. Einzelne Dateien prüfen Sie mit `spur-dev upstream web test/unit/src/…`. In jedem Pull Request laufen die Jobs `test` (Stack, Unit-Tests, E2E) und `upstream`.

## Claude und Ihre Daten

Unter Einstellungen, „Claude verbinden“, erzeugt spur ein Token und zeigt die Befehle, die das Plugin `spur` aus diesem Repository in Claude Code einrichten:

```sh
claude plugin marketplace add ahlerjam/spur
claude plugin install spur@spur --config server_url=https://ihre-spur-adresse/spur/mcp --config token=<Token>
```


Inhalte, die Claude liest, gehen an Anthropic. Dazu gehören Dokumente und Quellen, auch Interviews. Die Verantwortung dafür liegt bei Ihnen.

## Herkunft

spur baut auf [overleaf-cep](https://github.com/yu-i-i/overleaf-cep) auf, der Extended Community Edition von [Overleaf](https://www.overleaf.com). Von dort stammen unter anderem Track Changes und Kommentare, Sandbox-Compiles, LDAP-, SAML- und OpenID-Anmeldung, Git- und Zotero-Integration sowie die Admin-Werkzeuge. Ein wöchentlicher Job holt Änderungen von overleaf-cep als Pull Request.

> [!CAUTION]
> Ohne Sandbox-Compiles haben alle Nutzer beim Kompilieren vollen Zugriff auf den Container (Dateisystem, Netz, Umgebungsvariablen). Betreiben Sie spur ohne Sandbox nur, wenn Sie allen Nutzern vertrauen.

Overleaf® ist eine eingetragene Marke. spur ist kein Produkt von Overleaf und wird von Overleaf weder betrieben noch unterstützt.

## Authors

[The Overleaf Team](https://www.overleaf.com/about)\
[yu-i-i](https://github.com/yu-i-i), [davrot](https://github.com/davrot) — CE extensions; references to adapted code are listed in [`CREDITS`](CREDITS.md). See also the authors of individual commits.\
spur: [ahlerjam](https://github.com/ahlerjam).

## License

The code in this repository is released under the GNU AFFERO GENERAL PUBLIC LICENSE, version 3. A copy can be found in the [`LICENSE`](LICENSE) file.

Copyright (c) Overleaf, 2014-2026.\
Copyright (c) @yu-i-i, @davrot, 2024-2026, for CE extensions.

Portions of the code are derived from other open-source projects; see [`CREDITS`](CREDITS.md).
