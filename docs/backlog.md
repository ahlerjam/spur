# Backlog

Deferred, not discarded. Check here before new plans.

## Claude integration
- Connector for claude.ai, desktop and mobile; needs OAuth and public reachability
- Button starts a cloud session through a scheduled task with an API trigger
- Server-side agent with its own API key
- Other LLMs through MCP

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
- Semantic search over Postgres with pgvector, if brute force is no longer enough
- Short-lived tokens with OAuth
- Rate limits for web page capture and comments; OCR limit per project and page cap
- Use SSRF protection (`netz.mjs`) for `linked-url-proxy` as well and respect `Settings.blockedNetworks`

## Interface
- The "Nicht frei" badge in research has too little contrast
- Narrow research panel: search field cut off, tabs stacked
- Mixed menu languages in the editor (File, Insert, View next to Bearbeiten, Hilfe)
- Also highlight markings in the page text of the source preview

## Before the respective plan, into the image
- P2: `@huggingface/transformers` for semantic search
- P4: `tesseract-ocr` with language data

## Open questions
- Link resolver for TIB and LUH
- Overleaf's brand and logo rules for forks; have a lawyer review them
- Consumer Terms section 11 for EEA users in university research

## Translations
- Overleaf's German language file lacks 1616 keys that the English one has (`services/web/locales/de.json` has 2445 keys, `en.json` has 4060; one key exists only in `de.json`)
