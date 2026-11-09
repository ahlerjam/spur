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
