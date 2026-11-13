# 0002: Claude always writes as a track change

## Context and Problem Statement
`setDocument` shows live users a modal, has no version check and overwrites parallel input. Claude must be able to write without disturbing collaborators, and runs must be reversible.

## Considered Options
- One write path: ops with version, always as a track change
- Two paths: direct writing and track changes
- Separate agent branches in an internal Git repo

## Decision Outcome
One write path through a new document-updater endpoint with ops and version, next to the existing apply path. Every person has their own bot user, who is not a project member. "Accept automatically" is the bulk acceptance at the end of a run, without red statuses. Accepting is reserved for humans; Claude has no tool for it.

### Consequences
- Open runs are undone with reject, accepted runs with a new track change. The history label is only the last resort.
- The run card reads live from the ranges. The boundaries of runs by the same bot that follow each other directly stay blurry.
- There are no real branches. Whoever wants to work separately clones the project.

## Addendum 2026-11-13: automatic acceptance
"Accept automatically" is now a setting of the human, per project and per person ("Alles von Claude automatisch annehmen"). It replaces the bulk acceptance at the end of a run. The server accepts each change of that person's Claude right after writing it with `doc_edit` or `doc_create`, without a browser and without `run_finish`. It excludes changes with a red citation finding (wording differs, citation form not recognised, DOI unknown at every registration agency, source retracted); these stay open. Switching it on accepts nothing retroactively, and nothing is accepted once the person has lost write access. Accepting stays reserved for humans: Claude still has no tool for it, and the setting is the person's decision, not Claude's.
