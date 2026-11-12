Type: web

# spur P9: Oberflächen überarbeiten

## Zweck
Alle eigenen Oberflächen von spur wirken wie aus einem Guss mit Overleafs Editor, hell wie dunkel, mit klarer Hierarchie und vollständigen Zuständen. Die Großansicht einer Quelle wird neu gebaut, das Claude-Panel bekommt den Schalter „Alles von Claude automatisch annehmen“, deutsche Menüs werden vollständig, und der Ladebildschirm sitzt richtig. Was sich in der Bedienung ändert, steht danach in der Doku.

## Nutzer
Forschende, die täglich in spur schreiben (Laptop ab 1280 px, schmale Panels, gelegentlich Tablet oder Handy); Mitglieder mit Lese- oder Prüfrechten; Admins.

## Was Nutzer danach können
- In jedem Panel sofort die Hauptaktion finden; seltene Aktionen liegen in einem Menü.
- Dialoge und die Großansicht im selben Farbschema wie den Editor sehen.
- Eine Quelle groß lesen: scharf zoomen, scrollen, mit Tasten blättern, Text markieren, als Zitat speichern und einfügen, das Original herunterladen.
- Den Prüfbericht nach Datei und Befund überblicken und an der Markierung im Editor den Grund lesen.
- Mit einem Schalter festlegen, dass alles von Claude sofort angenommen wird, außer roten Zitaten; mit einem Knopf alles Offene auf einmal annehmen.
- Ältere Läufe von Claude weiter sehen.
- Den Editor und die Projektliste durchgehend auf Deutsch benutzen.

## Context
Befunde aus dem Rundgang mit Playwright (1440, 768, 360 px, dunkles Farbschema) und aus dem Code:
- Dialoge: Overleafs eigene Dialoge im Editor (z. B. „Projekt teilen“) sind dunkel, alle spur-Dialoge (Import, Aus anderem Projekt holen, Literaturmatrix, KI-Offenlegung, Quelle löschen) und die Großansicht sind weiß.
- Quellen-Panel: sechs gleich laute Knöpfe in drei Zeilen (Hochladen, Webseite aufnehmen, Aus anderem Projekt holen, Importieren, Quellen exportieren, Literaturmatrix); die Liste zeigt nur Dateinamen als blaue Links mit „8 Seiten · Text erkannt“; der Server liefert höchstens 100 Quellen, Treffer jenseits davon lassen sich nicht öffnen; „Webseite aufnehmen“ klappt ein Formular zwischen Knöpfe und Suche.
- Großansicht (`quellen/quelle-gross.tsx`, „Groß öffnen“ in der Vorschau): weiß im dunklen Editor; Zoom skaliert ein Rasterbild (unscharf) und schneidet es rechts ab, statt zu scrollen; Blättern-Knöpfe sitzen versetzt zur Zoom-Gruppe; beim Blättern verschwinden Bild und Text, das Layout springt, die Scrollposition bleibt; der Seitentext steht als zweite Kopie neben dem Bild; für Schreibende steht dort „Keine Schreibrechte“ und „Einfügen“ ist gesperrt; der Hinweis „Markiere oben Text …“ passt nicht zur Aufteilung; bei Webseiten ist die Werkzeugleiste leer und eine Spalte bleibt leer; keine Tasten zum Blättern oder Zoomen; die Vorschau bleibt nach dem Schließen auf der alten Seite; gegenüber der Vorschau fehlen OCR-Hinweis, Seitenzahl bestätigen und die Adresse eines Schnappschusses; kein Knopf zum Herunterladen des Originals (die Route gibt es).
- Prüfbericht: eine lange Liste ohne Gruppen; Abzeichen untereinander, lange Abzeichen brechen um und werden so breit wie das Panel; kein Zeitpunkt der Prüfung; Markierungen im Editor zeigen den Befund nur als Farbe.
- Claude-Panel: Der Startbefehl belegt die obere Hälfte, auch wenn darunter ein Lauf steht; die Lauf-Karte ist in den Rest gequetscht und oben abgeschnitten; das Häkchen „Automatisch annehmen, wenn ein Lauf ohne Probleme endet“ steht ganz unten in der Karte und erscheint erst, wenn es eine Karte gibt; es wirkt nur bei `run_finish` und nur ohne Hinweise. Das Panel kennt nur den letzten Lauf; ein nicht angenommener Lauf verschwindet beim nächsten. Im Zustand „nicht verbunden“ fehlt ein Weg zu den Token-Einstellungen; „Token erzeugen“ lässt sich doppelt auslösen; ein alter Fehler bleibt stehen, auch wenn die Abfrage wieder klappt.
- Recherche: „Nicht frei“ ist weiß auf hellem Grund und unlesbar; in schmalen Panels wird das Suchfeld abgeschnitten und die Reiter stapeln; die Reiter sind eigene Knöpfe ohne Tab-Semantik; je Treffer drei gleich laute Knöpfe.
- Vorschläge: vier Auswahlfelder untereinander, eigene und Projekt-Einstellung schwer zu unterscheiden; kein sichtbarer Ladezustand.
- Admin: „Grenzen“ und „Workflows“ haben verschiedene Breiten; „Workflows“ ist nur per Adresse erreichbar; der Menüeintrag heißt englisch „Limits“.
- Sprache: Im Editor stehen „File“, „Insert“, „View“ neben „Bearbeiten“ und „Hilfe“, die Leiste nennt „File tree“, „Project search“, „Review panel“; in der Projektliste steht „2 days ago von Du“, „Stichwörter organ…“ ist abgeschnitten, der Papierkorb heißt „Löschen“. Overleafs deutscher Sprachdatei fehlen rund 1600 Schlüssel.
- Ladebildschirm (`shared/components/loading-branded.tsx`, `pages/editor/loading-screen.scss`): Der Schriftzug „spur“ füllt sich beim Laden; die dunkle Füllung sitzt versetzt über dem grauen Schriftzug und ist nicht gleich hoch (Meldung des Owners).
- Code: `spur.scss` (976 Zeilen) ist nach Features gewachsen, mit doppelten und widersprüchlichen Regeln (`.spur-blaettern`, `.spur-reiter`, `.spur-leer`), festen Farben und Pixelwerten, zwei nicht existierenden Schrift-Variablen und uneinheitlichen Breakpoints. Vorhandene Overleaf-Bausteine bleiben ungenutzt (`OLFormSwitch`, `OLTooltip`, `OLTable`, `MaterialIcon`, `CopyToClipboard`, Tabs, Dropdown). Überschriften-Ebenen springen (h4, dann h3, h5). Drei verschiedene Texte für „Schließen“, zwei für „Speichern“ und „Kopieren“.
- ADR 0002 und `docs/mcp-contract.md` sagen: Claude schreibt immer als Track Change, Annehmen bleibt Menschen vorbehalten, rote Zitierformen und DOIs werden nie automatisch angenommen.
- Plan P8 ändert Prüfbericht (Zählung, Einstellungen der Prüfung, Registrierstellen) und die Admin-Seite „Grenzen“ (Paketgrenzen); dieser Plan baut darauf auf.

## Decisions
Owner-Entscheidungen (2026-11-12):
- Gestaltung: Overleaf-nah und aufgeräumt. Gleiche Bausteine, Farben und Abstände wie Overleafs neuer Editor, hell und dunkel korrekt, je Fläche eine Hauptaktion und der Rest im Menü, einheitliche Karten und Abzeichen, vollständige Leer-, Lade- und Fehlerzustände. Keine eigene Akzentfarbe, keine eigene Handschrift.
- Auto-Annahme: ein gut sichtbarer Schalter oben im Claude-Panel, „Alles von Claude automatisch annehmen“. Ist er an, wird jede Änderung von Claude sofort angenommen, auch aus Läufen mit Hinweisen wie „Zahl ohne Beleg“. Ausnahme: Änderungen mit rotem Zitatbefund bleiben offen und stehen oben in der Lauf-Karte. Dazu ein Knopf „Alles Offene jetzt annehmen“. Gilt je Projekt und Person, nur für den eigenen Claude.
- Großansicht: alles Beobachtete beheben, dazu Blättern und Scrollen, Markieren und Zitat speichern sowie Platz und Aufteilung verbessern.
- Zusätze: deutsche Menüs vervollständigen; Quellenliste mit Titel, Autoren, Jahr, Nachladen über 100 und „Original herunterladen“; Claude-Panel mit einklappbarem Startbefehl, Link zu den Token-Einstellungen, sichtbaren älteren Läufen und Schutz vor Doppelklick; Prüfbericht gruppiert, mit Filter, Zeitpunkt und Tooltip.
- Ladebildschirm: Füllung und Schriftzug decken sich.
- Alles, was sich ändert, kommt in die Doku.

Annahmen (ohne Rückfrage getroffen):
- „Rot“ heißt: Wortlaut abweichend, Zitierform nicht erkannt, DOI bei keiner Registrierstelle bekannt, Quelle zurückgezogen. Hinweise wie „Zahl ohne Beleg“, „Seite nicht prüfbar“ oder „OCR unbestätigt“ sind nicht rot.
- Der Schalter ersetzt das alte Häkchen; wer es gesetzt hatte, hat den Schalter an. Beim Einschalten wird nichts rückwirkend angenommen; dafür ist der Knopf da. Angenommen wird serverseitig direkt nach dem Schreiben, auch wenn kein Browser offen ist und ohne `run_finish`. Hat die Person kein Schreibrecht mehr, wird nichts angenommen. „Lauf rückgängig“ funktioniert für automatisch Angenommenes wie bisher. Die Lauf-Karte kennzeichnet automatisch Angenommenes.
- „Alles Offene jetzt annehmen“ zeigt einen Dialog mit der Zahl der Änderungen und Dateien, nimmt alle offenen Änderungen des eigenen Claude über alle Läufe an und lässt rote Zitate offen. Reviewer und Lesende sehen Schalter und Knopf nicht.
- Claude bekommt weiterhin kein Werkzeug zum Annehmen; die automatische Annahme ist eine Einstellung des Menschen. ADR 0002 und der Vertrag werden entsprechend ergänzt.
- Gestaltungswerte kommen nur aus Overleafs CSS-Variablen; eine `DESIGN.md` gibt es nicht, der Builder legt keine an und hält die wenigen eigenen Werte an einer Stelle in `spur.scss` fest. Zwei Referenzen: Overleafs Review-Panel und Datei-Baum im neuen Editor. Anti-Referenz: Karten-Dashboards mit Schatten und Verlauf.
- Menü je Panel über Overleafs Dropdown mit „Weitere Aktionen“ als zugänglichem Namen.
- Quellenliste: Titel fett, darunter Autoren (ab drei „Erstautor u. a.“) und Jahr, dann Seiten und Textstatus; ohne Metadaten der Dateiname. Nachladen in Schritten von 100 über „Weitere Quellen laden“.
- Großansicht: Seitenbild wird beim Zoomen in passender Auflösung neu geholt; Zoom 50 bis 300 %, „An Breite anpassen“; Tasten: Pfeil links/rechts und Bild auf/ab blättern, `+`/`-` zoomen, `0` an Breite, Esc schließt. Die Seitenleiste (Angaben zur Quelle, Notiz, Zitate) ist einklappbar und merkt sich den Zustand je Person. Der Seitentext steht nicht mehr als zweite Kopie neben dem Bild, bleibt aber markierbar (Textebene über dem Bild oder umschaltbare Textansicht) und für Screenreader vorhanden. Unter 768 px einspaltig mit der Seitenleiste als ausklappbarem Bereich.
- Prüfbericht: Gruppen je Datei mit Zahl der Stellen und der markierten, einklappbar; Filter „Alle“, „Markiert“, „Ohne Quelle“, „Nicht prüfbar“; „Zuletzt geprüft: heute, 14:32“; Tooltip an der Markierung mit denselben Texten wie die Abzeichen, auch per Tastatur erreichbar.
- Ältere Läufe: die letzten 20 je Projekt und Person, neuester zuerst, ältere eingeklappt mit Status und Zahl offener Änderungen; „Ältere laden“ in Schritten von 20.
- Startbefehl: eingeklappt, sobald Claude einmal verbunden war oder der Befehl kopiert wurde; „Startbefehl anzeigen“ klappt ihn auf.
- Deutsche Texte: Ergänzt werden die Schlüssel, die im Editor (Menüleiste, Leiste links, Review-Panel, PDF-Bereich, Einstellungen) und in der Projektliste samt Kontomenü sichtbar sind; ein Test führt die Liste dieser Flächen und meldet fehlende deutsche Schlüssel. Relative Zeiten erscheinen deutsch („vor 2 Tagen“). Der Rest der rund 1600 fehlenden Schlüssel bleibt im Backlog.
- Änderungen an Overleaf-Dateien (Ladebildschirm, Sprachdatei, Menü) sind Kern-Patches und kommen mit Begründung in die ADR-Liste.
- Breiten für die Prüfung: 360, 768, 1280 px, jeweils hell und dunkel; Panel zusätzlich bei 240 px Breite.

## Quality bar
- WCAG 2.2 AA: alles per Tastatur mit sichtbarem Fokus, Textkontrast mindestens 4,5:1 in beiden Farbschemata, jedes Feld mit Label, Fehler als Text, Klickziele mindestens 24 × 24 px, auf Touch 44 × 44 px.
- Nach Speichern, Löschen, Annehmen und nach dem Schließen eines Dialogs liegt der Fokus an einer sinnvollen Stelle, nie auf dem Seitenkörper.
- Semantisches HTML vor ARIA; Überschriften in Reihenfolge; Reiter mit Tab-Semantik und Pfeiltasten.
- Jede Fläche hat ihren Leer-, Lade- und Fehlerzustand; Ladezustände haben die Form des Inhalts, wo es Listen sind; ein behobener Fehler verschwindet.
- Kein horizontales Rollen bei 360 px; keine Konsolenfehler; keine nativen `alert`/`confirm`/`prompt`.
- Aussehen nach dem `taste`-Skill: Farben, Radien und Schatten nur aus Variablen, keine doppelten Regeln in `spur.scss`, ein Wort je Aktion („Schließen“, „Speichern“, „Kopieren“ überall gleich), Knöpfe nennen ihre Aktion, keine Gedankenstriche als Satzzeichen, keine englischen Knöpfe in der deutschen Oberfläche.
- Bewegung respektiert `prefers-reduced-motion`.
- Sicherheit: Automatische Annahme und Sammelannahme prüfen serverseitig Schreibrecht und dass die Änderung vom eigenen Bot stammt; rote Zitate werden serverseitig ausgeschlossen, nicht nur im Browser.
- Texte: deutsch geduzt mit humanizer-de, englisch und README mit humanizer geprüft; neue Texte nur über die Sprachdateien.

### Tests (TDD)
- Jede Änderung beginnt mit einem roten Test (Unit für Serverlogik, Frontend-Tests für Bausteine und Zustände).
- E2E bekommt `p9f1` bis `p9f12` und läuft nach dem Zurücksetzen der Testdaten vollständig grün, auch alle älteren Features; ältere Schritte werden an neue Beschriftungen angepasst, nicht gelöscht.
- Screenshots jeder Fläche bei 360 und 1280 px, hell und dunkel, im Abschluss des Laufs; nicht im Repo.
- Overleafs eigene Suiten bleiben grün bis auf die bekannte Upstream-Liste.
