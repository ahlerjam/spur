# Backlog

Deferred, not discarded. Check here before new plans.

## Claude integration
- Connector for claude.ai, desktop and mobile; needs OAuth and public reachability
- Button starts a cloud session through a scheduled task with an API trigger
- Server-side agent with its own API key
- Other LLMs through MCP
- MCP tasks (or a channel) for waiting instead of the 100-second short poll of `wait_for_event` (P8), once Claude Code keeps such calls in the foreground

## Proactivity
- Five more switches: paper suggestions, pre-marking citations, style, PDF look, paraphrases
- Auto level for proactive functions
- Cap per project

## Versioning
- Real agent branches with a Git window
- Targeted direct writing without a track change

## Research and data
- Peer review response: reviewer points, response letter, comparison with the submitted version
- Supervisor access, outline with assigned sources
- Submission check before filing
- Codebook with intercoder agreement
- Pseudonymization and a privacy switch per source
- Audio and video transcription
- Literature alerts, systematic review
- Script execution on the server

## Tests
- Overleaf's Cypress tests (`server-ce/test`) in the dev stack and in CI
- Acceptance tests of the web service (`services/web/test/acceptance`)
- P1 frontend test "check report panel hides green rows with 'Nur Probleme'" is flaky in the full run; switch it to `findBy…`
- Check semantic search with the real model (`multilingual-e5-small`) automatically; today it is only checked by hand

## Operations
- Find the real cause of the "interner Fehler" from `doc_create` on the Hetzner server with the new error ID (P8 fixed every cause found in the code, without the server log)
- Check `https://doi.org/doiRA/…` and `https://api.datacite.org/dois/…` against the real hosts (answer format, slash in the path); the tests use fakes
- Retractions for DataCite DOIs; DataCite does not report them today
- A DataCite DOI that `doi.org` knows but `api.datacite.org` answers with 404 shows "nicht prüfbar" on every report; decide on a cached state such as "registered, metadata missing"
- `tex_package_add`: try the second mirror on a 404 as well, in case the image's mirror lacks a package that mirror.ctan.org has
- Semantic search over Postgres with pgvector, if brute force is no longer enough
- Short-lived tokens with OAuth
- Rate limits for web page capture and comments; OCR limit per project and page cap
- Use SSRF protection (`netz.mjs`) for `linked-url-proxy` as well and respect `Settings.blockedNetworks`

## Claude panel
- Red citations that a person split by typing into them (new change IDs, same `rotZeiten` time) are not recognised by the run card: "Alle annehmen" asks nothing and "Nur die anderen" can accept the red piece. Fix on the server: `annehmen` takes a flag for red changes and skips them by `rotZeiten` otherwise (P10 security review)

## Interface
- Also highlight markings in the page text of the source preview

## Before the respective plan, into the image
- P2: `@huggingface/transformers` for semantic search
- P4: `tesseract-ocr` with language data

## Open questions
- Link resolver for TIB and LUH
- Overleaf's brand and logo rules for forks; have a lawyer review them
- Consumer Terms section 11 for EEA users in university research

## Translations
- Overleaf's German language file still lacks 1419 keys that the English one has (`services/web/locales/de.json` against `en.json`); P9 added about 200 for the menu bar, rail, review panel, PDF area, editor settings, project list and account menu

## Ideas for P10 (owner, 2026-11-12)
- Claim check: also check paraphrased statements against the source. For every sentence with a citation, find the passage in the source and show "supported (p. 347)", "passage not found" or "source says something else", with a jump to the passage. Always show the passage found, never a verdict without evidence, because a language model judges this and can be wrong. Extends the "paraphrases" switch under Proactivity.
- Claude without a terminal: the connector for claude.ai, desktop and mobile instead of the start command in the terminal. Biggest hurdle for people who do not use Claude Code. Needs OAuth and a publicly reachable server; a plan of its own because it concerns operations and security. Same item as "Connector" under Claude integration.
- Click a citation in the PDF: a click on a citation in the compiled PDF opens the source on the right page with the passage highlighted. Makes the check visible to readers and supervisors. Related: "Also highlight markings in the page text of the source preview" under Interface.
