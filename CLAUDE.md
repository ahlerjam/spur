# spur

Agentic writing environment for academic papers, built on Overleaf.

## Commands

- Start the stack: `spur-dev up`, stop it: `spur-dev down`, reset it: `spur-dev reset`
- After changes to the frontend: `spur-dev reload` (Webpack without network, then restart)
- After changes to the backend: `spur-dev restart`
- Unit tests: `spur-dev test` (with coverage report, threshold 80 % of lines)
- Overleaf's suites: `spur-dev upstream web|frontend|du|alle`, single files as further arguments (path relative to the service). The output ends with "bestanden, fehlgeschlagen, bekannt, neu"; exit 1 only on new failures, exit 2 if a given file is missing, excluded or contains no tests, or if no test runs at all
- Three-way comparison `main`, `ext-ce`, current state: `spur-dev upstream vergleich` rewrites `tools/tests/upstream-bekannt.json` (about 40 minutes). Exclusions with reasons are in `tools/tests/upstream-ausschluss.json`
- Tests of the evaluation: `node --test tools/tests/upstream-auswertung.test.mjs`
- Test account: `spur-dev user mail@example.org` returns the activation link. The account is an admin; permission checks need accounts without admin rights.
- E2E: all features in one run. The suite resets its data beforehand itself (dev route `POST /spur/dev/e2e/vorbereiten`, only with `SPUR_DEV`); `spur-dev run modules/spur/test/e2e/vorbereiten.mjs` does the same from outside. `spur-dev up` creates `services/web/modules/spur/dev-schalter.json` with the Crossref fake if it is missing
- Script in the container: `spur-dev run modules/spur/test/skript.mjs` (path relative to `services/web`)
- Mongo: `spur-dev mongo 'db.users.countDocuments()'`, backup: `spur-dev dump`, `spur-dev restore`
- Migrations: `spur-dev migrate migrate -t server-ce`, roll back: `spur-dev migrate rollback -t server-ce <name>`
- Logs: `spur-dev logs web 100`, other services such as `clsi` or `document-updater`

The source of `spur-dev` is in `tools/spur-dev/`. A human installs it with `tools/spur-dev/spur-dev install` as a fixed copy outside the repo; changes to the source only take effect after running `install` again. `spur-dev` mounts the current worktree into the image `ghcr.io/ahlerjam/spur-dev`. It is the only command that runs outside the sandbox, and only as a standalone call: with `;`, `&&`, a pipe or a redirect it stays in the sandbox and does not reach Docker. Plain `docker` is blocked.

New npm packages need a new run of the workflow `Dev image`. In a builder run they are a reason to stop.

## Tests (TDD)

Test first: new or changed server logic starts with a red unit test under `services/web/modules/spur/test/unit`, and every fixed bug with a test that reproduces it. New interfaces get frontend tests and steps in the E2E suite. Overleaf's own suites stay green except for the list of known upstream failures (`tools/tests/upstream-bekannt.json`); an entry with origin `spur` is not allowed.

Test artifacts, screenshots and helper scripts do not belong in the repo.
