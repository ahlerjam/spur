# spur MCP contract

Status: draft before run 0. Changes to names and error codes count as a breaking change and need a new version.

## Transport and authentication
- Streamable HTTP at `/spur/mcp`, bearer token with scope `spur_mcp`.
- `Origin` is checked; an invalid one returns 403. Host allowlist, rate limit, no session cookies.
- Every call checks the project role: `read` reads, `review` and `write` write track changes.
- The plugin `plugins/spur` sets `userConfig` for server URL and token.

## Rules
- Source text is untrusted. Default responses contain verdict and position; text only on request and shortened.
- Comments by other people are reported by ID only.
- There are no tools for accepting, deleting, renaming or moving.
- A run begins at the first write. Responses do not exceed 10,000 tokens; long tasks return a job handle.

## Tools

| Tool | Plan | Purpose |
|---|---|---|
| `project_list`, `doc_list`, `doc_read` | P1 | Read projects and documents |
| `sources_list`, `source_search`, `source_read` | P1 | Search sources and read sections |
| `source_read` | P15 | Reads a source page (`pdf_seite`) from `ab_zeichen` (integer from 0, default 0; the same positions `source_search` returns), at most 4,000 characters per call (`max_zeichen` lowers that). Returns `text`, `ab_zeichen`, `bis_zeichen`, `zeichen_gesamt` (length of the page) and `gekuerzt` (`true` if the page continues after `bis_zeichen`; read on with `bis_zeichen` as the next `ab_zeichen`). `ab_zeichen` past the end returns an empty `text` with `zeichen_gesamt`, no error. A negative `ab_zeichen` returns `eingabe_ungueltig` with `feld: "ab_zeichen"` |
| `source_page_image` | P15 | A page of a PDF source (`project_id`, `quelle_id`, `pdf_seite`) as a PNG image (MCP image content, like `page_image`), the longest edge at most 1,600 px, for figures and tables. Read access. Errors: `quelle_ohne_seiten` (409; web snapshots and transcripts have no pages, read them with `source_read`), `seite_nicht_gefunden` (404; the page is outside the document, `seiten` is the page count of the source and the message names it), `quelle_fehlt`, `keine_rechte` |
| `quote_mark` | P1 | Mark a passage in a source |
| `check_report` | P1 | Check report of the project; `zaehlung` counts citations by `status` (`geprueft`, `ohne_quelle`, `ohne_seitenangabe`, `beleg_ohne_wortlaut`, `nicht_pruefbar`), and every citation that was not checked names its `grund` (P6). `zaehlung.markiert` counts every citation with `problem: true`, including those without a source or not checkable, so it matches the "Markiert" filter and the headline of the panel (P10). `beleg_ohne_wortlaut` is a citation that names a source without quoting its wording (a bare `\cite`); it no longer counts as `geprueft`. `uebersprungen` counts citations in hidden parts that the report leaves out (P8, see "Hidden parts and quote macros"). Each key of a citation is a row of its own; `seitenbasis` says whether the page was checked against the printed page (`gedruckt`) or the PDF page (`pdf`) (P14, see "Citations, keys and pages in the check report") |
| `bib_list` | P1 | References and their status; `abweichungen` lists fields that are missing or differ from Crossref (P13, see "Reference data") |
| `doc_edit` | P1 | Change as a track change, with the expected old text and an idempotency key |
| `doc_edit` | P15 | `alle_vorkommen: true` replaces every occurrence of `alt` (non-overlapping, at most 500) as track changes of the same run in one update; the answer carries `ersetzt` (the count). The citation and number checks run on the new text of every occurrence; if one fails, nothing is written. `zahlen_ohne_beleg` names each number once. Without the parameter `doc_edit` behaves as before, and its `konflikt` for an old text that occurs more than once names `alle_vorkommen`. Errors: `konflikt` (old text not found, as before), `zu_viele_vorkommen` (422, more than 500 occurrences; `anzahl` is the count), `eingabe_ungueltig` (`feld: "alt"`, empty `alt`), `grenze_changes` (the replacements would take the document past 1990 open changes) |
| `doc_create` | P1 | Create a document at `pfad` with `inhalt`; missing folders are created, the content arrives as a track change of Claude. Same checks as `doc_edit`. Errors see "Error codes of `doc_edit` and `doc_create`" |
| `run_status`, `run_finish` | P1 | Query a run and end it with a summary |
| `run_status`, `run_finish` | P15 | Both also return `aenderungen` `{gesamt, automatisch_angenommen, offen, rot}` and `hinweis`. `gesamt` counts the changes of the run (one per `doc_edit`, each replacement of `alle_vorkommen` separately); `automatisch_angenommen` are already in the text because the switch "Alles von Claude automatisch annehmen" accepted them; `offen` are visible as track changes and wait for the person; `rot` were never accepted automatically because of a check finding (this count stays after the person accepts them). `hinweis` says the state in one or more sentences with number words up to twelve, for example "Zwei Änderungen stehen bereits im Text (automatisch angenommen). Eine Änderung wartet als Track Change auf deine Entscheidung. Davon ist eine rot markiert: … „Lauf rückgängig“ nimmt alle drei zurück, auch die angenommenen." Without a change (or without a run) `gesamt` is 0 and `hinweis` contains no numbers. spur recognises the track changes of a `doc_edit` by the seed of their IDs; runs from before P15 count each open seed as one change. The run card in the browser shows the same numbers ("2 automatisch angenommen, 1 offen") |
| `wait_for_event` | P1 | Waits up to 100 s for the next job (`max_sekunden` 1 to 3600, default 100; P8) and sends progress every 30 s. See "Waiting for jobs" |
| `events_since`, `reply` | P1 | `events_since` returns events after `cursor`, without a cursor the newest 100; events read here count as delivered. `reply` answers in the panel; with `kommentar_id` (P3) in the comment thread |
| `paper_search`, `paper_citations` | P2 | Research. `paper_search` takes `cursor` (from `naechster_cursor`) or `seite` for further pages (P12) |
| `source_add`, `acquisition_add` | P2 | Add a source or put it on the acquisition list. `source_add` takes either `doi` or, for a source without a DOI, `pdf_url` with `metadaten` (P12, see "Getting sources") |
| `search_log` | P12 | Read-only search log of the project with the totals for a PRISMA flow diagram (`project_id`, `cursor`; 50 requests per page). See "Search log and PRISMA totals" |
| `paper_exclude` | P12 | Exclude a hit of the search log with a reason (`project_id`, `doi` or `titel`, `grund` up to 200 characters). A second call for the same hit replaces the reason. Needs write access |
| `job_status`, `compile`, `compile_log`, `page_image` | P2 | Compile and see the result. `job_status` of a compile and `compile_log` carry `fehlende_pakete` (P16): one entry per file LaTeX did not find ("File `X' not found", including `.cls`, `.bst`, `.def`, a missing biblatex style as `<style>.bbx`/`.cbx` and fonts as `.tfm`; other errors do not count), with `datei`, `paket` (the TeX Live package from the file list of the mirror's `tlpkg/texlive.tlpdb.xz`, cached per installation for 24 hours; `null` if no package contains the file) and `im_image` (`false`). If the mirror cannot be reached, `paket` is `null` and `grund` is `spiegel_nicht_erreichbar` (`compile_log` asks again); if TeX packages are turned off (`SPUR_TEX_PAKETE=aus` or Admin → Grenzen), `grund` is `abgeschaltet` and spur asks no mirror. `[]` without a missing file. The editor shows the same list above the log (`GET /spur/project/<id>/tex-pakete/fehlend?datei=…`, read access, up to 20 files, more give `eingabe_ungueltig`; names with a path or other characters come back with `paket: null`) |
| `matrix_suggest` | P2 | Suggest a cell of the literature matrix; the person confirms (transitional until `suggest` arrives in P3) |
| `suggest` | P3 | Put a suggestion (`art`, `titel`, `text`, optional `pfad`) into the suggestions panel; the text stays unchanged |
| `source_upload_link` | P7 | One-time link to upload PDFs from the user's computer into the project, without MCP: `POST <link>` with the multipart field `datei` (optional `doi`, `titel`). Valid 15 minutes for up to 50 files; the answer per file is `status` `angelegt`, `vorhanden` (with `quelle_id`) or `abgelehnt` (with `grund`). Expired or used-up links answer 410, no or a wrong token 401. The sources belong to the run |
| `file_upload_link` | P15 | One-time link for the user's own images as project files, without MCP (write access): `POST <link>` with the multipart fields `datei` and `projektdatei` (path in the project, for example `abbildungen/diagramm.pdf`), or `spur-hochladen <link> diagramm.pdf --projektdatei abbildungen/diagramm.pdf`, which prints `diagramm.pdf: Datei abbildungen/diagramm.pdf`. Valid 15 minutes for up to 20 files (`max_dateien: 20`). Allowed are PNG, JPEG and PDF up to 10 MB each; the type is read from the start of the file and must match the extension of `projektdatei` (`.png`, `.jpg`, `.jpeg`, `.pdf`). Answer `{datei, status: "angelegt", pfad}`. Errors as problem details: `dateityp_nicht_erlaubt` (422), `zu_gross` (413), `konflikt` (409, the path exists), `eingabe_ungueltig` (422, `feld: "projektdatei"`: missing, `..`, a leading `/`, other characters than letters, digits, space and `-_.()`, over 200 characters, another extension or a path under `tex-pakete/`, where `tex_package_add` keeps packages), `projekt_zu_viele_dateien`, `speicher_voll`, and on a link from `source_upload_link` `falscher_link` (422). The files belong to the run: the run card lists them, "undo run" removes them, and a folder the run created goes too if it is empty then. `source_upload_link` stays for sources |
| `source_figure_add` | P15 | Adds an excerpt of a source page as a PNG at 300 dpi to the project (write access): `quelle_id`, `pdf_seite`, `ausschnitt` `{x, y, breite, hoehe}` as shares 0 to 1 of the page (`y` from the top) and `pfad` ending in `.png`. Only for sources with an open licence (`cc-by`, `cc-by-sa`, `cc-by-nc`, `cc-by-nc-sa`, `cc0`, `public-domain`, as Unpaywall reported it when the source was added); answer `{pfad, lizenz, quellenangabe}`, where `quellenangabe` is a caption line such as `Aus \textcite{offen2023}, S. 3, Lizenz CC BY.` (key, PDF page, licence). Errors: `lizenz_fehlt` (409; no or no open licence, including ND licences and sources added before P15; the message says to redraw the figure "in Anlehnung an" or to obtain permission; no file is created), `eingabe_ungueltig` (422; `feld: "ausschnitt"` for a width or height of 0, values outside 0 to 1 or an area past the page edge, `feld: "pfad"` for a path without `.png` or with invalid characters), `konflikt` (409, the path exists), `quelle_ohne_seiten`, `seite_nicht_gefunden`, `projekt_zu_viele_dateien`, `speicher_voll`. The file belongs to the run like those from `file_upload_link` (ADR 0005, addendum) |
| `tex_package_add` | P7 | Add a TeX Live package (`paket`, the TeX Live name, or `datei`, a file such as `booktabs.sty` that spur resolves to its package, P16; exactly one of both) that is not in the image to the project under `tex-pakete/<paket>/`, from the TeX Live archive of the mirror the image uses. Returns `dateien`, `fehlende_abhaengigkeiten` and `im_image`, or `hinweis` `schon im Image` / `schon im Projekt` without changes. The files belong to the run. Safe to repeat: a package counts as installed only after its last file is uploaded; a failed upload removes everything it created, and a folder `tex-pakete/<paket>/` without a completed install is removed before the next try. On 5xx or network errors spur tries each mirror three times, first the image's mirror, then `https://mirror.ctan.org/systems/texlive/tlnet`. On 404 spur asks the next mirror right away (P15); a package is unknown (`paket_unbekannt`) only when every mirror answers 404, and a 404 from one mirror plus an outage of the other gives `spiegel_nicht_erreichbar`. Caps (P8, admin page "Grenzen"; defaults in brackets): size per package unpacked (100 MB), all packages of a project (300 MB), successful installs per hour and person (60). Errors: `eingabe_ungueltig` (also neither or both of `paket` and `datei`), `paket_unbekannt` (also: no package contains `datei`, the message names the file), `archiv_unsicher`, `paket_zu_gross`, `projekt_voll` (limit for `tex-pakete/`), `speicher_voll` (storage limit of the project, with stand and limit), `projekt_zu_viele_dateien` (more than 2000 entries afterwards), `zu_viele_anfragen` (names the hourly limit; calls that report `schon im Image`, `schon im Projekt` or an error do not count), `abgeschaltet`, `spiegel_nicht_erreichbar` ("Die Paketquelle antwortet mit Fehler <status>" or not reachable), `paket_abgebrochen` (the upload failed; nothing was left behind, try again) |
| `tex_file_read` | P15 | Reads a file of the TeX installation the compile uses, to understand how a class or package behaves (read access): `project_id`, `name` (a file name only, with one of the extensions `.cls`, `.sty`, `.bst`, `.bbx`, `.cbx`, `.lbx`, `.def`, `.cfg`, `.clo`, `.tex`, `.ldf`), optional `ab_zeile` (from 1). spur looks in `tex-pakete/` of the project first, then in the installation like `kpsewhich` (asked from an empty folder; a result outside the TeX tree counts as not found). Returns `name`, `pfad` (in the project, or in the installation), `herkunft` (`projekt` or `installation`), `zeilen`, `ab_zeile`, `text` (up to 40,000 characters from `ab_zeile`) and `gekuerzt`. Errors: `eingabe_ungueltig` (422, `feld: "name"`: a path such as `../x` or `/etc/passwd`, another extension; nothing is looked up), `tex_datei_nicht_gefunden` (404; the message points to `tex_package_add`) |

## MCP prompts

| Prompt | Plan | Purpose |
|---|---|---|
| `literaturueberblick`, `methodenteil`, `folien` | P3 | Ready-made workflows; the same text is in the job when "Workflows" is clicked in the panel. Optional argument `fokus`, a single word |
| `quellen_sammeln` | P5 | Command `/plugin:spur:spur:quellen_sammeln`. Searches literature on `thema` (required), rates the abstracts and adds up to `anzahl` papers (a number from 1 or `max`, default 20). Invalid values: error `thema` or `anzahl` |

## Waiting for jobs

Claude Code moves every MCP call that runs longer than 120 s into the background, so one `wait_for_event` call lasts at most 100 s by default.

1. Call `wait_for_event`.
2. `{ereignis: null, cursor, hinweis}`: no job arrived. Call `wait_for_event` again right away.
3. `{ereignis: null, abgeloest: true, cursor, hinweis}`: a newer call of the same client is waiting now. Do nothing.
4. `{ereignis, cursor}`: do the job, then call `wait_for_event` again.

Each bot has at most one waiting call; a new one ends the older one with `abgeloest`. A job reaches exactly one call. `cursor` is the ID of the newest event and is meant for `events_since`.

## Errors of every tool

| Code | Meaning |
|---|---|
| `interner_fehler` | An unexpected error. The text ends with "Fehler-ID <8 characters>"; the server log has exactly one line with this `fehlerId`, the tool, project, path and bot, never content or tokens |
| `dienst_nicht_erreichbar` | An internal spur service (document-updater, history) did not answer or answered with 5xx; try again in a moment. Nothing was created |

## Error codes of `doc_edit` and `doc_create`

| Code | Meaning |
|---|---|
| `zitat_abweichend` | The wording is not in the source |
| `quelle_fehlt` | There is no source with text for the citation |
| `konflikt` | The expected old text no longer matches; read again. If it occurs more than once, the message names `alle_vorkommen` (P15) |
| `zu_viele_vorkommen` | `doc_edit` with `alle_vorkommen` (P15): more than 500 occurrences; `anzahl` is the count |
| `doc_fehlt` | The document is deleted |
| `grenze_changes` | The document is approaching 2000 open changes |
| `keine_rechte` | The project role does not allow this, or the project does not exist |
| `pfad_ungueltig` | `doc_create` and `doc_edit`: the path is not allowed (as on the web: no parts like `..`, no forbidden characters, every name under 150 characters) |
| `pfad_ist_datei` | `doc_create`: a part of the path is a file, not a folder ("`abb` ist eine Datei, kein Ordner. Wähl einen anderen Pfad."); nothing is created |
| `projekt_zu_viele_dateien` | `doc_create`: the project already has 2000 entries, Overleaf's limit |

`konflikt` from `doc_create` names the path: a file exists there already. An empty document that a failed `doc_create` of the same bot left behind does not block the next try. A file `ergebnisse.tex` that is not a text document is ignored when numbers are checked. `zahlen_ohne_beleg` does not list dates, times of day (also "9 Uhr" and "9.30 Uhr"), page and year numbers, version numbers, and the number right after a known software name ("Python 3.12", "R 4.3.1", "SPSS 29", "Node 20", "LaTeX2e"); `3.14`, `12,5`, `1.250` and `240` stay listed (P10). `doc_edit` checks the position of the new text in the document: inside a graphics environment (`tikzpicture`, `pgfpicture`, the pgfplots axes, `scope`, `tikzcd`, `circuitikz`, `forest`, `pgfonlayer`), including labels of nodes, and in the preamble (before `\begin{document}`) nothing is listed; inside a math environment the formula rule applies to the whole text. Anywhere, the arguments of `\tikzset`, `\tikzstyle`, `\pgfplotsset`, `\usetikzlibrary`, `\geometry`, `\hypersetup`, `\captionsetup`, `\setstretch`, `\linespread`, `\rule`, `\newlength` and `\addtolength`, the size arguments of `\resizebox` and `\scalebox` (their content is still checked), the column specification of `tabular`, `tabularx` and `array`, a number directly before a length unit (`0.5cm`, `0.3\textwidth`) and coordinate pairs `(x,y)` in lines starting with `\draw`, `\node`, `\path`, `\fill`, `\filldraw`, `\coordinate`, `\clip` or `\addplot` are not listed. Numbers in running text and table cells stay listed (P14).

Unrecognized citation forms and DOIs that cannot be resolved are accepted, but marked red. Red changes are never accepted automatically. Changes are accepted automatically only when the person has turned on the switch "Alles von Claude automatisch annehmen" for the project; spur then accepts them on the server right after writing, without `run_finish`, and leaves red citations open. Claude has no tool to accept or reject changes. The server decides which changes are red, by change ID and by position and time: a `doc_edit` that rewrites text inside an earlier insertion of the same run into a red citation (`doc_edit` reports it in `rot`) marks that whole insertion red, and so do the pieces when a person splits it by typing. The accept route of the browser takes `rote_mit` (default `false`); red changes are accepted only with `rote_mit: true`.

## Error codes of the research tools

| Code | Meaning |
|---|---|
| `doi_ungueltig` | The value is not a DOI |
| `doi_nicht_gefunden` | The DOI registry does not know the DOI ("DOI nicht gefunden") |
| `quelle_vorhanden` | A source for the DOI already exists ("Bereits vorhanden") |
| `beschaffung_vorhanden` | The DOI is already on the acquisition list |
| `nicht_frei` | `source_add`: Unpaywall knows no free location (paywall). spur puts the DOI on the acquisition list itself, reason "nicht frei verfügbar" (P12) |
| `bot_schutz` | `source_add` (P12): the paper is free, but no location delivered a PDF and at least one answered with an HTML page or status 401, 403, 429 or 503. It loads in a browser; `adresse` is the best address for that, `versucht` lists every address. spur puts the DOI on the acquisition list itself, reason "frei, Download blockiert" |
| `pdf_fehlt` | The full text could not be loaded for another reason (404, a PDF of a different work, an address that is not allowed); with `versucht` (P12) |
| `eingabe_ungueltig` | `source_add` (P12): not exactly one of `doi` and `pdf_url`, or `metadaten.titel` is missing or a field of `metadaten` is invalid; `feld` names the field; `source_read` (P15): `ab_zeichen` below 0 |
| `treffer_nicht_gefunden` | `paper_exclude`: the DOI or title did not appear in any search of the project |
| `dienst_fehlt` | Crossref does not respond right now, even after waiting out a 429 or 503; try again later |
| `spalte_fehlt` | `matrix_suggest`: the column does not exist in the matrix |
| `kommentar_fehlt` | `reply` with `kommentar_id`: the comment thread does not exist in the project |
| `vorschlaege_voll` | `suggest`: the panel already holds 100 open suggestions |

`bib_list` gives each reference a `referenz` state and, when known, its `registrierstelle` (P8):

- `gefunden`: Crossref knows the DOI (`registrierstelle: "crossref"`), or doi.org names DataCite and DataCite returns title, authors and year (`registrierstelle: "datacite"`, with `titel` and `jahr`; DataCite reports no retractions).
- `registriert`: doi.org names another registration agency (`registrierstelle`, `registrierstelleName`); the metadata is not checked and it is no problem.
- `nicht_gefunden`: doi.org does not know the DOI ("DOI nicht registriert").
- `ohne_doi`.
- `nicht_pruefbar` with `grund` `crossref_nicht_erreichbar` or `registrierstelle_nicht_erreichbar` (doi.org or DataCite did not respond); this says nothing about the reference and is never red.

spur asks doi.org (`https://doi.org/doiRA/<doi>`) only when Crossref answers 404, and DataCite (`https://api.datacite.org/dois/<doi>`) only for DataCite DOIs; both with a timeout of 10 s and the DOI encoded per path segment. Answers are cached for a day, failures never. spur waits out 429 and 503 from Crossref (`Retry-After`, otherwise a growing pause) for up to four attempts. The check report uses the same states.

## Hidden parts and quote macros

The check report and the write lock in `doc_edit` treat a macro as a quote when its definition in a `.tex` file of the project maps to `\enquote`, `\textquote`, `\blockquote` or quotation marks (`\newcommand`, `\renewcommand`, `\providecommand`, `\def`, `\NewDocumentCommand`). Citations are skipped and counted in `uebersprungen` inside an empty macro definition, `\iffalse … \fi`, and Beamer's `\note{…}` without `\setbeameroption{show notes}`. Each project has two lists in the check report settings, "Zitatmakros" and "Ausgeblendete Makros" (names without backslash, letters and `@`, at most 30 each). They take precedence over detection; anyone who may write in the project may change them.

Every hit of `paper_search` carries `abstract` (from the first service that supplies one; otherwise empty).

`paper_search` and `paper_citations` do not fail because of a single service: `fehler` names failed services with the reason, and the remaining hits still arrive. `dienste` lists every service asked with `antwort` `geantwortet`, `gedrosselt` or `nicht_erreichbar`. If no service answered, `hinweis` says so, so an empty list never looks like "no results". OpenAlex and Semantic Scholar work without an API key; a key only raises their limits.

On 429, 503 and network errors spur asks a search service up to three times (pause as `Retry-After` says, at most 10 s, otherwise 1 and 2 s; 20 s in total per request) before it reports `gedrosselt` or `nicht_erreichbar`. Each entry of `dienste` carries `versuche`: the highest number of attempts for a single request to that service, 0 when the answer came from the cache (P12).

## Getting sources (P12)

`source_add` with `doi` tries every free location Unpaywall lists (`oa_locations` with `url_for_pdf`), repositories before publisher pages, then Europe PMC. Each address is repeated on network errors, 429 and 503 (three attempts, pauses as above, 60 s in total per call). Errors `bot_schutz` and `pdf_fehlt` carry `versucht`, one entry per address with `url`, `host`, `art` (`repository`, `publisher`, `europepmc`, or `pdf_url`) and `ergebnis`: `html`, the HTTP status as text (`403`, `404`), `kein_pdf`, `falsches_pdf`, `zu_gross`, `gesperrt` (address not allowed), `netzfehler` or `zeit_abgelaufen` (the 60 s of the call were used up before this address was tried).

Title check: after each download spur compares the title from the metadata with the text of the first three pages and the title field of the PDF (lower case, without punctuation and accents). It matches when at least half of the title words with four or more letters occur, and at least three (all of them when there are fewer). A PDF of a different work is rejected as `falsches_pdf` and the next location is tried. The source and `sources_list` carry `titelabgleich`: `passt`, `abweichend` or `nicht_pruefbar` (no text layer on the first three pages, or no title word with four letters). Uploads through `source_upload_link` and `pdf_url` are never rejected for the title; with `abweichend` the answer and `sources_list` carry `hinweis` "Titel im PDF passt nicht zu den Metadaten". Sources added before P12 have no `titelabgleich`.

Sources without a DOI: `source_add` with `pdf_url` (a public https address that returns the PDF directly, at most 50 MB; no handles or URNs) and `metadaten`: `titel` (required), `autoren` (list of `family`, `given`), `jahr`, `art` (`thesis`, `report`, `working_paper`, `book`, `misc`), `institution`, `abschluss` (free text such as "Masterarbeit") and `url`. The `.bib` gets an entry for the kind (`@thesis` with `type` and `institution`, `@report`, `@book`, `@misc`) with `url` and `urldate`. The same `pdf_url` or the same file again answers `quelle_vorhanden`. An address that is not public https answers `pdf_fehlt` without being fetched. The upload link takes the same fields as form fields (`titel`, `autoren` as "Family, Given; …", `jahr`, `art`, `institution`, `url`); without `doi` they produce the same entry, and the answer names `key`.

## Reference data (P13)

New `.bib` entries from `source_add` with `doi` and from `source_upload_link` follow biblatex-apa (APA 7):

- Entry type by the Crossref `type`: `journal-article` → `@article` (`journal`), `book-chapter` → `@incollection` (`booktitle`, `publisher`), `book` and `monograph` → `@book` (`publisher`), `proceedings-article` → `@inproceedings` (`booktitle`, `publisher`), any other type → `@misc`. Fields without a value are left out, never empty.
- `volume` and `number` come from Crossref `volume` and `issue`. An article number (`article-number`) goes into `eid` and `pages` is left out.
- `year` is the year of the printed issue: `published-print`, then `journal-issue.published-print`, then `issued` (the earlier of print and online). The key of a new source uses the same year (`oldemeyer2025`, not `oldemeyer2024`).
- Preprints (an arXiv DOI `10.48550/arXiv.…` or Crossref `posted-content`) become `@online` with `author`, `title`, `date` (year), `eprint` (`arXiv`, otherwise the archive from `group-title` or `institution`, such as `PsyArXiv`) and `doi`, without `journal`.
- HTML entities and tags in title, journal, authors and publisher are resolved before LaTeX escaping (`&amp;` → `\&`); `<i>` and `<em>` become `\textit{…}`, other tags are dropped with their text kept. `sources_list` carries `titel` as plain text. Existing entries are never changed by spur.

Author check: after reading a PDF with a text layer spur compares the family names from the metadata with the first page (ignoring case and accents, whole words). The source, `source_add`, `sources_list` and the upload answer carry `autoren`:

- `aus_pdf`: all names are on the first page in a different order; the `.bib` entry uses the order of the PDF.
- `bestaetigt`: all names are there in the same order.
- `abweichend`: at least one name is missing; the order of the metadata stays and `autoren_hinweis` asks to check the authors (text `spur_hinweis_autoren_abweichend`). The sources panel shows the same text.

Scans without text, sources without authors and sources added before P13 have no `autoren`.

Every upload through `source_upload_link` gets a `.bib` entry. With `doi` and Crossref metadata it is the full entry above, with a key from the first family name and the year. Without `doi` a DOI in the text of the PDF counts as before. Without any metadata (no `doi` and no known DOI in the PDF, a DOI that Crossref does not know, or Crossref not reachable) it is `@misc` with the title from the form field `titel` (which has no effect when the DOI supplies metadata), else the title field of the PDF, else the file name without extension; the key comes from the file name and the DOI is not written into the entry. Such a source and its answer carry `metadaten: "unvollstaendig"`, the answer also `metadaten_hinweis` with the reason (no DOI, DOI not found at Crossref, or Crossref not reachable); `spur-hochladen` prints each of `hinweis`, `autoren_hinweis` and `metadaten_hinweis` as an extra line after `Quelle <id>`. A file with the same name or the same DOI as a source of the project answers `vorhanden` and adds nothing.

`bib_list` gives each reference `abweichungen`, a list of `{feld, eintrag, erwartet}`: `feld` is `volume`, `number`, `pages`, `year` or `eintragstyp`, `eintrag` the value in the `.bib` (`null` when missing) and `erwartet` the value according to Crossref (for `eintragstyp` the type that fits the kind of work, such as `online` for a preprint). A field counts only when Crossref names a value; missing `pages` do not count, different ones do; `year` is read from `year`, else from `date`; `@misc` is expected for no type and every entry type fits it. An empty list means the entry matches. Deviations are hints and never make a reference a problem. When nothing can be compared, `abweichungen` is `null` with `abweichungen_grund`: `ohne_doi`, `crossref_nicht_erreichbar`, `registrierstelle_nicht_erreichbar` or `nicht_bei_crossref` (the DOI is registered elsewhere or not at all). arXiv DOIs are checked for the entry type only, without Crossref. In `check_report` a citation of a reference with deviations carries the same `abweichungen`; the check report panel shows the neutral badge "Literaturdaten unvollständig", which unfolds the fields with both values.

## Citations, keys and pages in the check report (P14)

A quotation without a citation after it belongs to the last `\textcite`, `\Textcite`, `\citet`, `\citeauthor` or `\nptextcite` before it in the same sentence (no `.`, `!` or `?` followed by white space and no blank line in between, at most 300 characters apart). Its page comes from the optional argument of that command, or else from a `\parencite[S.~x]{key}` with the same key or a plain `(S.~x)` after the quotation. The report then has one row for both, and the leading command no longer counts as `beleg_ohne_wortlaut`. A citation after the quotation goes first; with another key the leading command stays a row of its own.

Recognised citation commands: `cite`, `autocite`, `parencite`, `textcite`, `footcite`, `citep`, `citet`, `smartcite`, `supercite`, `citeauthor`, `nptextcite`, `citealp`, `citealt` and each of them capitalised, `fullcite`, `footfullcite`, `citeyear`, `citeyearpar`, `citetitle`, and the multi-citation forms `cites`, `parencites`, `textcites`, `autocites`, `footcites` (also capitalised), where each pair of optional arguments and keys, written without space in between, counts as a citation of its own. Starred forms count as well, `\nocite` does not. Any other command with "cite" in its name stays `nicht_pruefbar` with `grund: "zitierform_unbekannt"`.

Every key of a citation gets a row of its own with `key` and its own reference check, and `zaehlung` counts each row. With a quotation and several keys, the row of the first source that contains the wording carries `wortlaut`; the other keys are rows without wording. If no source contains it, the first key with a source carries the finding. Rows of the same citation share `von` and `bis` and differ in `id`.

`seitenbasis` says what a page was checked against: `gedruckt` (the printed page number of a source with `versatz`) or `pdf` (the page of the PDF, for sources without recognised printed page numbers such as preprints). With `pdf`, `seite: "stimmt"` means the cited number is the PDF page with the wording, and `gefundenAuf` names the PDF page; the panel shows "PDF-Seite". Rows of a source whose offset was read from the page text carry `versatzQuelle: "seitentext"`, and the panel shows "Seitenzahl aus dem Seitentext erkannt". `seite: "nicht_pruefbar"` remains only when the wording was not found, the page reference has no number, or the source is a transcript.

The offset of a PDF comes from its PageLabels when Crossref confirms the page range (`versatzQuelle: "pagelabels"`). Otherwise spur reads the first 30 pages: an Arabic number alone in the first or last non-empty line counts as the printed page. The offset (printed page minus PDF page) is taken only when at least five pages give the same value and they are at least 80 % of the pages with a number; a page range known to Crossref must fit as well (`versatzQuelle: "seitentext"`). Otherwise `versatz` stays empty. Sources added before P14 keep their offset; the fallback applies to sources added or read again.

## Search log and PRISMA totals (P12)

Every `paper_search` request is logged, including further pages. `search_log` returns `eintraege` in chronological order and `prisma`:

| Field | Meaning |
|---|---|
| `eintraege[].zeit`, `anfrage`, `seite`, `filter` | When, search text, page (from 0) and filters (always `null`; `paper_search` has none) |
| `eintraege[].dienste[]` | Per service `dienst`, `status` (`geantwortet`, `gedrosselt`, `nicht_erreichbar`), `treffer` (hits delivered) and `versuche` |
| `eintraege[].treffer`, `dubletten` | Hits delivered by all services for this request, and how many of them were already known |
| `prisma.identifiziert`, `identifiziert_nach_dienst` | All hits delivered, in total and per service |
| `prisma.dubletten` | Hits with a DOI already seen (normalized); without a DOI the same title (lower case, without punctuation) and year |
| `prisma.gesichtet` | Distinct hits. `identifiziert − dubletten = gesichtet` |
| `prisma.aufgenommen` | Hits whose DOI is a source of the project (`source_add` or an upload with the DOI) |
| `prisma.ausgeschlossen` | `gesamt` and `nach_grund` (reason → count), set with `paper_exclude` |
| `prisma.nicht_beschaffbar` | Hits with an open entry on the acquisition list, by reason `nicht_frei`, `bot_schutz` or `pdf_fehlt` (only reasons that occur) |
| `prisma.offen` | Hits without a decision. `gesichtet = aufgenommen + ausgeschlossen.gesamt + nicht_beschaffbar + offen` |

A source counts as `aufgenommen` even if the hit was excluded before; an excluded hit counts as `ausgeschlossen` even if it is on the acquisition list. Log entries from before P12 are stored per service and do not know their hits one by one: they keep `seite: 0`, count their hit number as `identifiziert`, `gesichtet` and `offen`, and have `dubletten: null`. The web view of the log and its CSV export show the same columns and totals.

## Events for `events_since`
`task_created`, `chat_message`, `comment_mention`, `suggest_trigger`. Every event applies to exactly one bot.

| Event | `daten` |
|---|---|
| `task_created` | `text`, `nachricht_id`; from a workflow also `workflow`, from an accepted suggestion `vorschlag_id` |
| `comment_mention` | `kommentar_id`, `nachricht_id`, `text` (only the own message), `doc_id`, `pfad`, `stelle` (`position`, `laenge`, `zeile`, `markiert`), `andere_nachrichten` (IDs only) |
| `suggest_trigger` | `art` (`compile_fehler` with `fehler`, `belegloses_argument` with `doc_id`) |

A chat text from the panel arrives as `task_created`. `suggest_trigger` only arises with the "Vorschlag" switch on and below the daily limit (default 50 per person).
