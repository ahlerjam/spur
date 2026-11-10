Type: web, api

# spur P8: Grenzen für Projekte je Nutzer und Speicher je Projekt

## Zweck
Admins einer gemeinsam genutzten spur-Installation (z. B. spur.ahler.org auf einem kleinen Server) wollen verhindern, dass einzelne Nutzer unbegrenzt Projekte anlegen oder ein Projekt den Speicher füllt. Dieser Plan bringt eine Projekt-Grenze je Nutzer und eine Speicher-Grenze je Projekt, einstellbar im Admin-Bereich, mit Übersicht und klaren Meldungen. Alle Inhalte sind vom Owner entschieden.

## Nutzer
Admins, die Grenzen setzen und überwachen; Nutzer, die an eine Grenze stoßen; Claude, das über MCP Dateien anlegt.

## Was Nutzer danach können
- Admins setzen im Admin-Bereich einen Standard für alle (Projekte je Nutzer, GB je Projekt; leer = unbegrenzt) und je Nutzer eine Ausnahme.
- Admins sehen in einer Übersicht Projekte je Nutzer und Speicher je Projekt und wer nah an einer Grenze ist.
- Nutzer sehen, wie viele Projekte sie noch anlegen dürfen und wie voll ein Projekt ist, und bekommen beim Erreichen eine Meldung, die sagt, was zu tun ist.

## Context
- Overleaf kennt nur `maxEntitiesPerProject` (Anzahl Dateien) und `MAX_UPLOAD_SIZE` (Größe je Upload); keine Projektzahl je Nutzer und keine Speicher-Grenze je Projekt.
- Projekte entstehen über „Neues Projekt“ (leer, Vorlage), Hochladen (ZIP), Kopieren, Übertragung der Eigentümerschaft und Zurückholen aus dem Papierkorb; archivierte und Papierkorb-Projekte bleiben Projekte des Nutzers.
- Speicher eines Projekts: hochgeladene Dateien (Filestore/History-Blobs), spur-Quellen (PDF, Scans, VTT, Webseiten-Schnappschüsse) und seit P7 TeX-Pakete unter `tex-pakete/`. Uploads kommen aus dem Editor (Datei hochladen, verknüpfte Datei), aus spur (Quellen) und über MCP (`source_add`, `tex_package_add`).
- Admin-Bereich: admin-tools aus overleaf-cep (Nutzerliste, Projektliste) und spur-Einstellungsseiten (z. B. Workflows unter `/spur/admin/…`).
- P7 ändert admin-tools (Einladungslinks); P8 baut darauf auf.

## Decisions
Owner-Entscheidungen (2026-11-10):
- Projekt-Grenze: zählt alle Projekte, deren Eigentümer der Nutzer ist, auch archivierte und solche im Papierkorb; nur endgültig gelöschte nicht. Geteilte Projekte anderer zählen nicht. Bei Erreichen sind Neues Projekt (leer, Vorlage), Hochladen als Projekt, Kopieren und das Annehmen einer Eigentümer-Übertragung gesperrt, mit Meldung wie „Du hast 10 von 10 Projekten. Lösche ein Projekt endgültig oder frag deinen Admin.“
- Speicher-Grenze: zählt hochgeladene Dateien, spur-Quellen und TeX-Pakete des Projekts; nicht den Versionsverlauf und nicht die Compile-Ausgabe. Bei Erreichen sind weitere Uploads gesperrt (Editor, Quellen, verknüpfte Dateien, MCP `source_add`, `tex_package_add`), Schreiben im Editor geht weiter. Meldung nennt Stand und Grenze, z. B. „Dieses Projekt nutzt 1,02 GB von 1 GB. Lösche Dateien oder Quellen oder frag deinen Admin.“
- Einstellung: im Admin-Bereich ein Standard für alle (Projekte je Nutzer, GB je Projekt; leer = unbegrenzt) und je Nutzer eine Ausnahme (beide Werte, leer = Standard, 0 bzw. „unbegrenzt“ ausdrücklich wählbar). Die Ausnahme je Nutzer gilt für die Speicher-Grenze aller Projekte, deren Eigentümer er ist.
- Übersicht im Admin-Bereich: Tabelle Nutzer mit Projektzahl/Grenze, Tabelle Projekte mit Speicher/Grenze und Eigentümer, sortierbar, mit Markierung ab 80 % und bei Überschreitung.
- Annahmen (ohne Rückfrage getroffen):
  - Standard nach dem Update: unbegrenzt (keine bestehende Installation wird plötzlich gesperrt). Wer schon über einer neuen Grenze liegt, verliert nichts; nur Neues wird gesperrt.
  - Die Grenzen gelten auch für Admins; sie können sich selbst eine Ausnahme setzen.
  - Der Speicherstand eines Projekts wird bei jedem Upload und Löschen fortgeschrieben und kann im Admin-Bereich neu berechnet werden; die Prüfung vor einem Upload nutzt die Größe des Uploads.
  - Nutzer sehen ihren Stand: in der Projektliste „x von y Projekten“, im Editor (Dateibaum oder Quellen-Panel) „x GB von y GB“, nur wenn eine Grenze gesetzt ist.
  - MCP-Fehler haben feste Codes `projekte_voll` und `speicher_voll`; Texte in beiden Sprachdateien, deutsch geduzt.
  - Kern-Patches an Overleaf-Code kommen mit Begründung in die ADR-Liste.

## Quality bar
- Web: Tastatur, sichtbarer Fokus, Kontrast mindestens 4,5:1, jedes Feld mit Label, Klickziele mindestens 24 × 24 px, kein horizontales Rollen bei 360 px, keine Konsolenfehler, keine nativen Dialoge; Zahlen deutsch formatiert (1,02 GB).
- Grenzen werden serverseitig geprüft, nicht nur in der Oberfläche; gleichzeitige Uploads können die Grenze nicht gemeinsam überschreiten (Prüfung und Fortschreiben atomar).
- Admin-Seiten nur für Admins (403 sonst).

### Tests (TDD)
- Jede Änderung beginnt mit einem roten Test (Unit, Frontend).
- E2E bekommt `p8f1` bis `p8f5` und läuft vollständig grün, auch alle älteren Features.
- Overleafs eigene Suiten bleiben grün bis auf die bekannte Upstream-Liste.
