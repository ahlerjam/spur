# 0001: spur as a module in the web service

## Context and Problem Statement
spur extends overleaf-cep with sources, checking and an MCP interface. Operation should stay as simple as with Overleaf, and updates from the fork should cost little.

## Considered Options
- Module `services/web/modules/spur` with few core patches
- Separate service `services/spur`
- Sidecar container

## Decision Outcome
A module in the web service. A separate service would need about a dozen new internal endpoints for tree, files, compile and label, plus a workspace, runit and an nginx rule. Core patches stay limited to `settings.defaults.js`, the language files, the history display, new document-updater endpoints and the hook `projectDuplicated` in `ProjectDuplicator.mjs`. The hook is one line and lets a copied project show the notice "Quellen wurden nicht mitkopiert" (sources were not copied). In addition, the review panel reloads unknown authors (`changes-users-context.tsx`, `review-panel-change-user.tsx`): the Claude bot is not a project member, so its first change would otherwise appear as "Deleted user" until the page is reloaded.

Running without email needs patches in Overleaf's account code, because spur cannot hook into it from the module:
- `Email/EmailConfiguration.mjs` (new) says whether a sender and a transport are set. `EmailSender.mjs` reads `Settings.email` on each send, so the dev stack can switch to a fake SMTP server.
- admin-tools (`ActivationLink.mjs`, `UserListController.mjs`, the new-user dialog and the action "Create new invitation link") returns the activation link to the admin. Before, the link only went out by email, and without email nobody could get it.
- user-activate (`/admin/register`) shows each link with a copy button. `settings.defaults.js` loads the module, and the admin menu (`admin-menu.tsx`, `navbar-marketing.pug`) links to it.
- `LaunchpadController.mjs` (test email) and `PasswordResetController.mjs` (forgot password) say that no email is set up, where they used to report a sent email.

Limits for projects and storage need hooks where Overleaf creates projects and accepts files:
- `ProjectCreationHandler.mjs` fires `beforeProjectCreated` in `_createBlankProject`, which new, template, ZIP and copy all pass. `OwnershipTransferHandler.mjs` fires `beforeProjectOwnerChanged` for the new owner.
- `ProjectUploadController.mjs` fires `reserveProjectStorage` before an upload and maps a limit error for the ZIP upload; `LinkedFilesController.mjs` fires `checkProjectStorage`.
- `ErrorController.mjs` answers errors with `spurGrenze` with 403 and the message, instead of the generic restricted page.
- In the frontend, the clone dialog, the ZIP upload dialog and the file tree upload show that message (`clone-project-modal-content.tsx`, `upload-project-modal.tsx`, `error-message.tsx`). The project list shows "x of y projects" (`project-list-ds-nav.tsx`), and the admin menu links to the limits page.

### Consequences
- No new database and no new service.
- Compute-heavy work runs as a child process or job, not in the request.
- Every fork update PR must also review the core patches.
