# 0001: spur as a module in the web service

## Context and Problem Statement
spur extends overleaf-cep with sources, checking and an MCP interface. Operation should stay as simple as with Overleaf, and updates from the fork should cost little.

## Considered Options
- Module `services/web/modules/spur` with few core patches
- Separate service `services/spur`
- Sidecar container

## Decision Outcome
A module in the web service. A separate service would need about a dozen new internal endpoints for tree, files, compile and label, plus a workspace, runit and an nginx rule. Core patches stay limited to `settings.defaults.js`, the language files, the history display, new document-updater endpoints and the hook `projectDuplicated` in `ProjectDuplicator.mjs`. The hook is one line and lets a copied project show the notice "Quellen wurden nicht mitkopiert" (sources were not copied). In addition, the review panel reloads unknown authors (`changes-users-context.tsx`, `review-panel-change-user.tsx`): the Claude bot is not a project member, so its first change would otherwise appear as "Deleted user" until the page is reloaded.

### Consequences
- No new database and no new service.
- Compute-heavy work runs as a child process or job, not in the request.
- Every fork update PR must also review the core patches.
