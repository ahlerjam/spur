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
| `check_report` | P1 | Check report of the project; `zaehlung` counts citations by `status` (`geprueft`, `ohne_quelle`, `ohne_seitenangabe`, `nicht_pruefbar`), and every citation that was not checked names its `grund` (P6) |
| `bib_list` | P1 | References and their status |
| `doc_edit` | P1 | Change as a track change, with the expected old text and an idempotency key |
| `doc_create` | P1 | Create an empty document; content follows through `doc_edit` |
| `run_status`, `run_finish` | P1 | Query a run and end it with a summary |
| `wait_for_event` | P1 | Long poll: waits for the next job, sends progress every 30 s |
| `events_since`, `reply` | P1 | Fetch missed events by cursor and answer; `reply` with `kommentar_id` (P3) answers in the comment thread |
| `paper_search`, `paper_lookup`, `paper_citations` | P2 | Research |
| `source_add`, `acquisition_add` | P2 | Add a source or put it on the acquisition list |
| `job_status`, `compile`, `compile_log`, `page_image` | P2 | Compile and see the result |
| `matrix_suggest` | P2 | Suggest a cell of the literature matrix; the person confirms (transitional until `suggest` arrives in P3) |
| `suggest` | P3 | Put a suggestion (`art`, `titel`, `text`, optional `pfad`) into the suggestions panel; the text stays unchanged |

## MCP prompts

| Prompt | Plan | Purpose |
|---|---|---|
| `literaturueberblick`, `methodenteil`, `folien` | P3 | Ready-made workflows; the same text is in the job when "Workflows" is clicked in the panel. Optional argument `fokus`, a single word |
| `quellen_sammeln` | P5 | Command `/plugin:spur:spur:quellen_sammeln`. Searches literature on `thema` (required), rates the abstracts and adds up to `anzahl` papers (a number from 1 or `max`, default 20). Invalid values: error `thema` or `anzahl` |

## Error codes of `doc_edit`

| Code | Meaning |
|---|---|
| `zitat_abweichend` | The wording is not in the source |
| `quelle_fehlt` | There is no source with text for the citation |
| `konflikt` | The expected old text no longer matches; read again |
| `doc_fehlt` | The document is deleted |
| `grenze_changes` | The document is approaching 2000 open changes |
| `keine_rechte` | The project role does not allow this, or the project does not exist |
| `pfad_ungueltig` | `doc_create` and `doc_edit`: the path is not allowed (as on the web: no parts like `..`, no forbidden characters, every name under 150 characters) |

Unrecognized citation forms and DOIs that cannot be resolved are accepted, but marked red and never accepted automatically.

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

`bib_list` gives each reference a `referenz` state: `gefunden`, `nicht_gefunden` (Crossref answers 404: the DOI is unknown), `ohne_doi`, or `nicht_pruefbar` with `grund` `crossref_nicht_erreichbar` (Crossref did not respond; this says nothing about the reference). spur waits out 429 and 503 from Crossref (`Retry-After`, otherwise a growing pause) for up to four attempts. The check report uses the same states.

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
