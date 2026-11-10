# spur

spur is a self-hosted writing environment for academic papers, built on [overleaf-cep](https://github.com/yu-i-i/overleaf-cep). You manage sources in the editor, insert citations with a button, and use a check report to see whether wording, page and reference match and whether a paper has been retracted. Your own Claude Code writes along and cannot invent citations.

## Installation

### Prerequisites

You need Docker with Compose and `make`. MongoDB 8 does not start on Linux kernels 6.19 to 7.0.13 ([SERVER-121912](https://jira.mongodb.org/browse/SERVER-121912)). Servers need a kernel up to 6.18 or from 7.0.14.

### Clone and start

```sh
git clone https://github.com/ahlerjam/spur.git
cd spur
make setup
```

`make setup` asks for the address, optional email settings and a contact address for Crossref and Unpaywall, writes the answers to `.env` and starts spur. It needs a terminal and never prints the SMTP password. If `.env` already has values, it asks before changing them. Plain `make start` asks nothing and keeps the defaults.

On the first start, `make start` creates a `.env` file with a random `OVERLEAF_INVITE_TOKEN_SECRET`. Each `make start` first pulls the current published image and then starts it; without network access it starts the image you already have. The container does not start without this secret. spur then runs on <http://localhost:8080>.

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

### Update

```sh
git pull
make update
```

`make update` pulls the current images and restarts spur with `docker compose up -d --wait`. Before it restarts, it reminds you of the backup: take one first if you want a way back.

### Email

spur sends invitations and password resets by email. Set these variables in `.env`:

```sh
OVERLEAF_EMAIL_FROM_ADDRESS=spur@example.org
OVERLEAF_EMAIL_SMTP_HOST=smtp.example.org
OVERLEAF_EMAIL_SMTP_PORT=587
OVERLEAF_EMAIL_SMTP_USER=spur@example.org
OVERLEAF_EMAIL_SMTP_PASS=your-password
```

`OVERLEAF_EMAIL_SMTP_SECURE=true` uses TLS from the start of the connection (usually port 465). Run `make start` again after changing `.env`.

Without these variables spur sends no email, and it says so: the test email on `/launchpad` reports that no email is set up, and "Forgot password" tells people to ask an admin. Admins pass invitation links on themselves. After "Create account" in the user list (Admin → Manage Users) or on Admin → Register Users, spur shows the link with a copy button. For an existing account, the link icon in the user list creates a new one. A link works for one week.

### TeX packages

The image contains TeX Live with a fixed list of packages. If a document needs another package or Beamer theme, Claude can add it to the project with `tex_package_add`: spur downloads the package from the TeX Live archive of the mirror the image uses and puts its runtime files under `tex-pakete/` in the project. Nothing changes on the server. A package may have at most 20 MB, a project at most 50 MB in `tex-pakete/`, and each person can add 20 packages per hour. `SPUR_TEX_PAKETE=aus` in `.env` turns the tool off.

### Research services

Literature search, citations and adding papers by DOI use Crossref, Unpaywall, OpenAlex, Semantic Scholar and arXiv. All of them work without an account.

| Variable | Purpose |
|---|---|
| `CROSSREF_MAILTO` | Your contact address. Crossref gives requests with an address more capacity. |
| `UNPAYWALL_EMAIL` | Contact address for Unpaywall, which finds free full texts. If it is missing, spur uses `CROSSREF_MAILTO`. If both are missing, adding papers by DOI does not work. |
| `OPENALEX_API_KEY` | Optional. Raises the OpenAlex limits. |
| `SEMANTIC_SCHOLAR_API_KEY` | Optional. Without a key, Semantic Scholar shares one quota among all users and may refuse requests for a while. |

If a service does not answer, spur says which one and why, and shows the results of the others.

### Behind a corporate proxy

Some company networks open TLS connections and sign them with their own certificate (Zscaler, for example). spur then cannot reach Crossref or the other services, and `curl` inside the container fails with error 60. Export the root certificate of your company in PEM format, save it as `corporate-ca.crt` next to `docker-compose.yml` and create `docker-compose.override.yml`:

```yaml
services:
  sharelatex:
    volumes:
      - ./corporate-ca.crt:/usr/local/share/ca-certificates/corporate-ca.crt:ro
    environment:
      NODE_EXTRA_CA_CERTS: /usr/local/share/ca-certificates/corporate-ca.crt
```

Docker Compose reads this file together with `docker-compose.yml` on its own, so `make start` and `make update` pick it up. The repository ignores this file, so `git pull` leaves it alone.

## Make targets

| Command | Effect |
|---|---|
| `make setup` | Asks for address, email and contact address, writes `.env`, then starts spur |
| `make start` | Pulls the current image and starts spur |
| `make update` | Pulls the current images and restarts spur |
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

### Releases

The `Publish` workflow builds the operator image for amd64 and arm64 and pushes it to GHCR. It starts when a tag matching `v*` is pushed, or by hand from the Actions tab. To release:

```sh
git tag v1.2.3 && git push origin v1.2.3
```

CI skips what a change cannot affect: `upstream` runs only for changes under `services/`, `libraries/` or `tools/tests/` and for lockfiles, and `test` skips the stack and E2E when only Markdown files or `docs/` changed. Both jobs still report success, so the required checks stay satisfied. The rules live in `tools/ci/aenderungen.mjs`; other events such as a manual run always run everything.

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
