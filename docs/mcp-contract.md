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
| `quote_mark` | P1 | Mark a passage in a source |
| `check_report` | P1 | Check report of the project; `zaehlung` counts citations by `status` (`geprueft`, `ohne_quelle`, `ohne_seitenangabe`, `beleg_ohne_wortlaut`, `nicht_pruefbar`), and every citation that was not checked names its `grund` (P6). `zaehlung.markiert` counts every citation with `problem: true`, including those without a source or not checkable, so it matches the "Markiert" filter and the headline of the panel (P10). `beleg_ohne_wortlaut` is a citation that names a source without quoting its wording (a bare `\cite`); it no longer counts as `geprueft`. `uebersprungen` counts citations in hidden parts that the report leaves out (P8, see "Hidden parts and quote macros") |
| `bib_list` | P1 | References and their status |
| `doc_edit` | P1 | Change as a track change, with the expected old text and an idempotency key |
| `doc_create` | P1 | Create a document at `pfad` with `inhalt`; missing folders are created, the content arrives as a track change of Claude. Same checks as `doc_edit`. Errors see "Error codes of `doc_edit` and `doc_create`" |
| `run_status`, `run_finish` | P1 | Query a run and end it with a summary |
| `wait_for_event` | P1 | Waits up to 100 s for the next job (`max_sekunden` 1 to 3600, default 100; P8) and sends progress every 30 s. See "Waiting for jobs" |
| `events_since`, `reply` | P1 | `events_since` returns events after `cursor`, without a cursor the newest 100; events read here count as delivered. `reply` answers in the panel; with `kommentar_id` (P3) in the comment thread |
| `paper_search`, `paper_citations` | P2 | Research |
| `source_add`, `acquisition_add` | P2 | Add a source or put it on the acquisition list |
| `job_status`, `compile`, `compile_log`, `page_image` | P2 | Compile and see the result |
| `matrix_suggest` | P2 | Suggest a cell of the literature matrix; the person confirms (transitional until `suggest` arrives in P3) |
| `suggest` | P3 | Put a suggestion (`art`, `titel`, `text`, optional `pfad`) into the suggestions panel; the text stays unchanged |
| `source_upload_link` | P7 | One-time link to upload PDFs from the user's computer into the project, without MCP: `POST <link>` with the multipart field `datei` (optional `doi`, `titel`). Valid 15 minutes for up to 50 files; the answer per file is `status` `angelegt`, `vorhanden` (with `quelle_id`) or `abgelehnt` (with `grund`). Expired or used-up links answer 410, no or a wrong token 401. The sources belong to the run |
| `tex_package_add` | P7 | Add a TeX Live package (`paket`, the TeX Live name) that is not in the image to the project under `tex-pakete/<paket>/`, from the TeX Live archive of the mirror the image uses. Returns `dateien`, `fehlende_abhaengigkeiten` and `im_image`, or `hinweis` `schon im Image` / `schon im Projekt` without changes. The files belong to the run. Safe to repeat: a package counts as installed only after its last file is uploaded; a failed upload removes everything it created, and a folder `tex-pakete/<paket>/` without a completed install is removed before the next try. On 5xx or network errors spur tries each mirror three times, first the image's mirror, then `https://mirror.ctan.org/systems/texlive/tlnet`. Caps (P8, admin page "Grenzen"; defaults in brackets): size per package unpacked (100 MB), all packages of a project (300 MB), successful installs per hour and person (60). Errors: `eingabe_ungueltig`, `paket_unbekannt`, `archiv_unsicher`, `paket_zu_gross`, `projekt_voll` (limit for `tex-pakete/`), `speicher_voll` (storage limit of the project, with stand and limit), `projekt_zu_viele_dateien` (more than 2000 entries afterwards), `zu_viele_anfragen` (names the hourly limit; calls that report `schon im Image`, `schon im Projekt` or an error do not count), `abgeschaltet`, `spiegel_nicht_erreichbar` ("Die Paketquelle antwortet mit Fehler <status>" or not reachable), `paket_abgebrochen` (the upload failed; nothing was left behind, try again) |

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
| `konflikt` | The expected old text no longer matches; read again |
| `doc_fehlt` | The document is deleted |
| `grenze_changes` | The document is approaching 2000 open changes |
| `keine_rechte` | The project role does not allow this, or the project does not exist |
| `pfad_ungueltig` | `doc_create` and `doc_edit`: the path is not allowed (as on the web: no parts like `..`, no forbidden characters, every name under 150 characters) |
| `pfad_ist_datei` | `doc_create`: a part of the path is a file, not a folder ("`abb` ist eine Datei, kein Ordner. Wähl einen anderen Pfad."); nothing is created |
| `projekt_zu_viele_dateien` | `doc_create`: the project already has 2000 entries, Overleaf's limit |

`konflikt` from `doc_create` names the path: a file exists there already. An empty document that a failed `doc_create` of the same bot left behind does not block the next try. A file `ergebnisse.tex` that is not a text document is ignored when numbers are checked. `zahlen_ohne_beleg` does not list dates, times of day (also "9 Uhr" and "9.30 Uhr"), page and year numbers, version numbers, and the number right after a known software name ("Python 3.12", "R 4.3.1", "SPSS 29", "Node 20", "LaTeX2e"); `3.14`, `12,5`, `1.250` and `240` stay listed (P10).

Unrecognized citation forms and DOIs that cannot be resolved are accepted, but marked red. Red changes are never accepted automatically. Changes are accepted automatically only when the person has turned on the switch "Alles von Claude automatisch annehmen" for the project; spur then accepts them on the server right after writing, without `run_finish`, and leaves red citations open. Claude has no tool to accept or reject changes. The server decides which changes are red, by change ID and by position and time: a `doc_edit` that rewrites text inside an earlier insertion of the same run into a red citation (`doc_edit` reports it in `rot`) marks that whole insertion red, and so do the pieces when a person splits it by typing. The accept route of the browser takes `rote_mit` (default `false`); red changes are accepted only with `rote_mit: true`.

## Error codes of the research tools

| Code | Meaning |
|---|---|
| `doi_ungueltig` | The value is not a DOI |
| `doi_nicht_gefunden` | The DOI registry does not know the DOI ("DOI nicht gefunden") |
| `quelle_vorhanden` | A source for the DOI already exists ("Bereits vorhanden") |
| `beschaffung_vorhanden` | The DOI is already on the acquisition list |
| `nicht_frei` | `source_add`: no free full text; use `acquisition_add` instead |
| `pdf_fehlt` | The free full text could not be loaded |
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

## Events for `events_since`
`task_created`, `chat_message`, `comment_mention`, `suggest_trigger`. Every event applies to exactly one bot.

| Event | `daten` |
|---|---|
| `task_created` | `text`, `nachricht_id`; from a workflow also `workflow`, from an accepted suggestion `vorschlag_id` |
| `comment_mention` | `kommentar_id`, `nachricht_id`, `text` (only the own message), `doc_id`, `pfad`, `stelle` (`position`, `laenge`, `zeile`, `markiert`), `andere_nachrichten` (IDs only) |
| `suggest_trigger` | `art` (`compile_fehler` with `fehler`, `belegloses_argument` with `doc_id`) |

A chat text from the panel arrives as `task_created`. `suggest_trigger` only arises with the "Vorschlag" switch on and below the daily limit (default 50 per person).
