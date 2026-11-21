# 0008: The review chain lives in the Claude Code plugin

## Context and Problem Statement
In a real paper Claude misread sources (a wrong page, "all" where the source says 95 %) and the owner had to ask for a check before one happened. The server check (ADR 0004) covers literal wording, pages and references, not whether a paraphrase says what the source says. Where should the evaluation of sources, the check of paraphrases, the final check and the humanizer pass live, and what makes sure they run?

## Considered Options
- In the Claude Code plugin: agents with their own context (`spur:auswertung`, `spur:gegenpruefung`, `spur:endpruefung`), skills for how they work, and hooks that hold `run_finish` after text changes
- On the server: a claim check that judges paraphrases and blocks `run_finish` until it passes
- Only as instructions in the workflow texts and the main skill

## Decision Outcome
In the plugin. Judging a paraphrase needs a language model reading the source, which the client already is; a fresh agent gets only the project ID and the range, so it does not inherit the writer's reading. The server keeps judging only what it can check deterministically and does not issue verdicts on paraphrases (ADR 0004 stays). Instructions alone were not enough: the chain was skipped in practice, so a `PreToolUse` hook refuses `run_finish` after a change to a `.tex` file until claim check, final check, humanizer and a `check_report` after the last text change have run.

### Consequences
- The chain only holds in Claude Code with the plugin. The browser shows nothing of it; other clients get the same order as a recommendation at the end of the four workflow texts.
- The hook counts no rounds: per stage the last run counts, and corrections after a check only need a new `check_report`. The skill caps re-checks at one per stage.
- `spur-pruefkette aus "<reason>"` lifts the lock for one session, only when the person asks for it; the reason goes into the summary.
- A broken hook never blocks: on a damaged state file or a missing data folder it lets `run_finish` through and writes one line to stderr.
- Whether Claude Code fires plugin hooks for the plugin's own MCP tools under the name `mcp__plugin_spur_spur__…` is documented but was not observed in a real session; it is step 3 of the manual check in the README.
- `humanizer`, `humanizer-de` and `playwright` become dependencies of the plugin, so installing it needs the marketplaces `cflow` and `claude-plugins-official`.
