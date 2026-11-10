# spur

spur is a self-hosted writing environment for academic papers, built on [overleaf-cep](https://github.com/yu-i-i/overleaf-cep). You manage sources in the editor, insert citations with a button, and use a check report to see whether wording, page and reference match and whether a paper has been retracted. Your own Claude Code writes along and cannot invent citations.

## Installation

### Prerequisites

You need Docker with Compose and `make`. MongoDB 8 does not start on Linux kernels 6.19 to 7.0.13 ([SERVER-121912](https://jira.mongodb.org/browse/SERVER-121912)). Servers need a kernel up to 6.18 or from 7.0.14.

### Clone and start

```sh
git clone https://github.com/ahlerjam/spur.git
cd spur
make start
```

On the first start, `make start` creates a `.env` file with a random `OVERLEAF_INVITE_TOKEN_SECRET` and starts the published image. The container does not start without this secret. spur then runs on <http://localhost:8080>.

### First admin account

Create the first administrator account at `/launchpad`, for example <http://localhost:8080/launchpad>.

### Settings

`SPUR_URL`, `SPUR_PORT` and `SPUR_IMAGE` change the address, the port and the image. The language applies to the whole installation: the default is German, and `OVERLEAF_SITE_LANGUAGE=en` in `.env` switches to English.

### Public operation

If you run spur publicly, the compile sandbox is required:

```sh
SPUR_DATA_DIR=/srv/spur docker compose -f docker-compose.yml -f docker-compose.sandbox.yml up -d
```

#### HTTPS

A server on the internet needs a reverse proxy with TLS in front of spur. Then `.env` contains:

```sh
SPUR_URL=https://spur.example.org
OVERLEAF_SECURE_COOKIE=true
```

Example for [Caddy](https://caddyserver.com), which fetches certificates itself:

```
spur.example.org {
	reverse_proxy localhost:8080 {
		flush_interval -1
	}
}
```

`flush_interval -1` passes responses through immediately. The MCP endpoint `/spur/mcp` needs this: it waits a long time for jobs and sends progress every 30 seconds. If the proxy does not run on the same machine, add its address to `OVERLEAF_TRUSTED_PROXY_IPS` (for example `loopback,10.0.0.5`).

### Backup

The repository ships no backup command. A backup covers the volume `spur_data` and the MongoDB data in the volume `spur_mongo`. With the sandbox override, the host directory `SPUR_DATA_DIR` takes the place of `spur_data`. `spur-dev dump` and `spur-dev restore` are for development only.

## Make targets

| Command | Effect |
|---|---|
| `make start` | Starts spur |
| `make stop` | Stops spur |
| `make seed` | Creates demo data |
| `make test` | Runs the unit tests |
| `make e2e` | Runs Playwright against the running stack |

## Development and tests

Development uses `spur-dev` from `tools/spur-dev/`: `tools/spur-dev/spur-dev install` installs the command, and `spur-dev up` starts the stack from the dev image with the source code mounted.

| Command | Effect |
|---|---|
| `spur-dev test` | spur unit tests with a coverage report for `modules/spur/app/src` (at least 80 % of lines) |
| `spur-dev upstream web` | Overleaf's web unit suite |
| `spur-dev upstream frontend` | Overleaf's frontend suite, including the tests under `modules/spur/test/frontend` |
| `spur-dev upstream du` | Unit and acceptance tests of the document-updater |
| `spur-dev upstream alle` | All three suites in turn |
| `spur-dev upstream vergleich` | The same suites on `main` (Overleaf), `ext-ce` (overleaf-cep) and the current state; rewrites the list of known failures |
| `spur-dev run modules/spur/test/e2e/vorbereiten.mjs` | Resets the E2E data; `make e2e` also does this itself before the first feature |

The `upstream` commands run in a separate container with `NODE_ENV=test` and their own test database, and end with the line `bestanden, fehlgeschlagen, bekannt, neu`. They fail with exit 1 only on new failures, and with exit 2 if a given file is missing, excluded or contains no tests, or if no test runs at all. Failures that already occur in Overleaf or overleaf-cep are listed with origin and reason in `tools/tests/upstream-bekannt.json`. Test files that need Overleaf Server Pro modules are listed in `tools/tests/upstream-ausschluss.json`. An entry with origin `spur` is not allowed: whatever spur breaks gets fixed. Check single files with `spur-dev upstream web test/unit/src/…`. Every pull request runs the jobs `test` (stack, unit tests, E2E) and `upstream`.

## Claude and your data

Under Settings, "Connect Claude" ("Claude verbinden" in the German interface), spur creates a token and shows three steps that set up the `spur` plugin from this repository in Claude Code.

1. Add spur to Claude Code. You only need this once per computer.

   ```sh
   claude plugin marketplace add ahlerjam/spur
   ```

2. Connect spur to your account. This command contains your personal token from the account settings. Keep it to yourself.

   ```sh
   claude plugin install spur@spur --config server_url=<your spur address>/spur/mcp --config token=<token>
   ```

3. Start Claude Code. Run this to start Claude Code in your terminal. Claude then waits for tasks from spur on its own and can write there without asking at every step. You need this command each time you start Claude Code; it is also in the Claude panel of your project.

   ```sh
   claude --allowedTools "mcp__plugin_spur_spur__quote_mark mcp__plugin_spur_spur__doc_edit mcp__plugin_spur_spur__doc_create mcp__plugin_spur_spur__reply mcp__plugin_spur_spur__run_finish mcp__plugin_spur_spur__wait_for_event" -- "Use wait_for_event to wait for tasks from spur."
   ```

You start the four ready-made workflows in the Claude panel under "Workflows", or in Claude Code with these commands. For prompts of a plugin, Claude Code adds the prefix `/plugin:spur:spur:` and shows them in the menu with "(MCP)":

| Command | Workflow |
| --- | --- |
| `/plugin:spur:spur:literaturueberblick` | Literature overview |
| `/plugin:spur:spur:methodenteil` | Methods section |
| `/plugin:spur:spur:folien` | Slides from a paper |
| `/plugin:spur:spur:quellen_sammeln` | Collect sources (arguments: `thema`, `anzahl`) |

An admin adjusts the texts under `/spur/admin/workflows`.

Content that Claude reads goes to Anthropic. This includes documents and sources, interviews too. You are responsible for it.

Transcripts are sent to the AI provider when Claude reads them. Ideally, pseudonymise interviews before uploading them. spur shows this notice when you upload any VTT file; there are no further rules for interviews.

## Origin

spur builds on [overleaf-cep](https://github.com/yu-i-i/overleaf-cep), the Extended Community Edition of [Overleaf](https://www.overleaf.com). Track changes and comments, sandbox compiles, LDAP, SAML and OpenID sign-in, Git and Zotero integration and the admin tools come from there, among other things. A weekly job fetches changes from overleaf-cep as a pull request.

> [!CAUTION]
> Without sandbox compiles, all users have full access to the container (file system, network, environment variables) while compiling. Run spur without the sandbox only if you trust all users.

Overleaf® is a registered trademark. spur is not a product of Overleaf, and Overleaf neither operates nor endorses it.

## Authors

[The Overleaf Team](https://www.overleaf.com/about)\
[yu-i-i](https://github.com/yu-i-i), [davrot](https://github.com/davrot): CE extensions; references to adapted code are listed in [`CREDITS`](CREDITS.md). See also the authors of individual commits.\
spur: [ahlerjam](https://github.com/ahlerjam).

## License

The code in this repository is released under the GNU AFFERO GENERAL PUBLIC LICENSE, version 3. A copy can be found in the [`LICENSE`](LICENSE) file.

Copyright (c) Overleaf, 2014-2026.\
Copyright (c) @yu-i-i, @davrot, 2024-2026, for CE extensions.

Portions of the code are derived from other open-source projects; see [`CREDITS`](CREDITS.md).
