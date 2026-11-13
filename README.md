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

### Grenzen

Under Admin → Grenzen (limits) you set a default for everyone: projects per user and storage per project in GB. An empty field means unlimited, which is also the default after an update, so no installation is suddenly blocked. For each user you can set an exception (a number, 0, or unlimited); the storage exception applies to all projects the user owns. These caps apply to admins too.

The same page has a "TeX-Pakete" part with three fields: size per package in MB (default 100), all packages of a project in MB (default 300) and installations per hour and person (default 60). An empty field restores the default; only whole numbers from 1 are accepted.

Projects count when the user owns them, including archived ones and those in the trash. Storage counts uploaded files, sources and TeX packages, but not the history or the compile output. Anyone already above a limit keeps everything; only new projects and uploads are blocked, and writing in the editor keeps working. The page also lists projects per user and storage per project, marks those at 80 % or more, and can recalculate the storage of a project. Both tables have a search field (user name or address; project name or owner) and show 50 rows per page. Storage is shown in KB, MB or GB; like the limit it counts uploaded files, sources and TeX packages, not text documents such as `.tex` and `.bib`, so a project of text files only shows 0 KB.

### TeX packages

The image contains TeX Live with a fixed list of packages. If a document needs another package or Beamer theme, Claude can add it to the project with `tex_package_add`: spur downloads the package from the TeX Live archive of the mirror the image uses and puts its runtime files under `tex-pakete/` in the project. Nothing changes on the server. By default a package may have 100 MB unpacked, all packages of a project together 300 MB, and each person can add 60 packages per hour; only successful installations count. Admins change these values under Admin → Grenzen. The storage limit of the project and Overleaf's 2000 files per project still apply. On a server error or a network problem spur tries three times, then the second mirror `https://mirror.ctan.org/systems/texlive/tlnet`. If an installation breaks off, spur removes what it had created, and the next call starts clean. `SPUR_TEX_PAKETE=aus` in `.env` turns the tool off.

### Research services

Literature search, citations and adding papers by DOI use Crossref, Unpaywall, OpenAlex, Semantic Scholar and arXiv. All of them work without an account.

| Variable | Purpose |
|---|---|
| `CROSSREF_MAILTO` | Your contact address. Crossref gives requests with an address more capacity. |
| `UNPAYWALL_EMAIL` | Contact address for Unpaywall, which finds free full texts. If it is missing, spur uses `CROSSREF_MAILTO`. If both are missing, adding papers by DOI does not work. |
| `OPENALEX_API_KEY` | Optional. Raises the OpenAlex limits. |
| `SEMANTIC_SCHOLAR_API_KEY` | Optional. Without a key, Semantic Scholar shares one quota among all users and may refuse requests for a while. |

If a service does not answer, spur says which one and why, and shows the results of the others.

The check report also contacts `doi.org` and `api.datacite.org`, without a key. When Crossref does not know a DOI, `doi.org` says where it is registered, and DataCite supplies title, authors and year for arXiv and other DataCite DOIs. If your firewall only lets through listed addresses, add both.

### Error IDs

When a Claude tool fails unexpectedly, the answer ends with "Fehler-ID" and eight characters, for example `a1b2c3d4`. The web log has exactly one line with this ID, the tool, the project, the path and the bot; it never holds document content or tokens. Find it with:

```sh
docker exec spur grep a1b2c3d4 /var/log/overleaf/web.log
```

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

Some proxies also block single requests and answer with their own HTML page. spur then says so ("Ein Proxy oder Filter in deinem Netz blockiert diese Anfrage") in the PDF area and in its panels. Recompiling will not change that; ask your IT department or try another network.

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
   claude --allowedTools "mcp__plugin_spur_spur__quote_mark mcp__plugin_spur_spur__doc_edit mcp__plugin_spur_spur__doc_create mcp__plugin_spur_spur__reply mcp__plugin_spur_spur__run_finish mcp__plugin_spur_spur__wait_for_event" -- "Use wait_for_event to wait for tasks from spur. On ereignis: null call it again right away, on abgeloest do nothing; finish a task, then call wait_for_event again."
   ```

Claude waits in steps of 100 seconds. Claude Code moves every tool call that runs longer than two minutes into the background, so `wait_for_event` returns after 100 seconds without a task, and Claude calls it again at once. You do not have to restart anything. The panel shows "Claude verbunden" the whole time. If you prefer one long call, set the environment variable `CLAUDE_CODE_MCP_AUTO_BACKGROUND_MS` for Claude Code to a higher value, for example `CLAUDE_CODE_MCP_AUTO_BACKGROUND_MS=1800000` for 30 minutes; spur's short steps work either way.

You start the four ready-made workflows in the Claude panel under "Workflows", or in Claude Code with these commands. For prompts of a plugin, Claude Code adds the prefix `/plugin:spur:spur:` and shows them in the menu with "(MCP)":

| Command | Workflow |
| --- | --- |
| `/plugin:spur:spur:literaturueberblick` | Literature overview |
| `/plugin:spur:spur:methodenteil` | Methods section |
| `/plugin:spur:spur:folien` | Slides from a paper |
| `/plugin:spur:spur:quellen_sammeln` | Collect sources (arguments: `thema`, `anzahl`) |

An admin adjusts the texts under `/spur/admin/workflows`.

#### Accepting changes

Claude always writes as a track change. At the top of the Claude panel is the switch "Alles von Claude automatisch annehmen" ("Accept everything from Claude automatically" in the English interface) with the note "Rote Zitate bleiben offen." When it is on, spur accepts every change that Claude writes with `doc_edit` or `doc_create` on the server right after writing. This works without an open browser and without `run_finish`, and also for runs with hints such as "Zahl ohne Beleg".

- Red citations stay open. A change counts as red when the quoted wording differs from the source, the citation form is not recognised, the DOI is unknown at every registration agency, or the source has been retracted. These changes are listed at the top of the run card under "Bitte prüfen".
- The switch is set per project and per person and only affects your own Claude. Switching it on accepts nothing retroactively. If you no longer have write access to the project, nothing is accepted.
- It replaces the old checkbox for accepting at the end of a run. The old setting carries over.
- The run card marks accepted changes with "Automatisch angenommen".
- "Alles Offene jetzt annehmen (N)" accepts all open changes of your own Claude across runs, except red citations. A dialog asks first and names the amount, for example "12 changes in 2 files". When only red citations are open, the button reads "Nur rote Zitate offen (N)", is greyed out and says that red citations are checked one by one; "Nichts offen" means that nothing at all is open.
- "Alle annehmen" in the run card asks when red citations are among the changes: the dialog "1 rotes Zitat mit annehmen?" offers "Nur die anderen" (the default, the red citation stays open under "Bitte prüfen") and "Alle annehmen". Esc closes the dialog without accepting anything. Without red citations there is no question. If only red citations are open there is nothing "other" to accept: the dialog offers "Abbrechen" (focused) and "Alle annehmen". The server decides what is red, by change ID and by time, so a citation that Claude rewrites inside its own insertion, or that a person splits by typing into it, stays red. The accept route takes `rote_mit` (default `false`): without it red changes are never accepted, not even by ID. The counts in the button, the dialog and the run card come from the same server data.
- `doc_edit` and `doc_create` hint at "Zahl ohne Beleg" for numbers that do not come from `ergebnisse.tex`. Times with "Uhr" ("9 Uhr", "9.30 Uhr") and versions right after a software name ("Python 3.12", "R 4.3.1", "SPSS 29", "LaTeX2e") do not count as numbers.
- "Lauf rückgängig" also reverts the automatically accepted changes of that run.

Reviewers and members with read-only access see neither the switch nor the button; the server answers 403. Claude itself has no tool to accept anything: acceptance is a setting of the person, never a decision of Claude.

The panel shows the last 20 runs. The newest is expanded, older ones are collapsed with their status and the number of open changes; "Ältere laden" loads 20 more. While Claude is not connected, the panel links to "Token verwalten". Once Claude has connected, the start command is collapsed.

Content that Claude reads goes to Anthropic. This includes documents and sources, interviews too. You are responsible for it.

Transcripts are sent to the AI provider when Claude reads them. Ideally, pseudonymise interviews before uploading them. spur shows this notice when you upload any VTT file; there are no further rules for interviews.

## Sources

The source panel has one main button, "Quelle hinzufügen". Further actions are in the menu "Weitere Aktionen": capture a web page, fetch from another project, import, export sources and the literature matrix. The list shows title, authors (from three authors the first one with "u. a."), year, pages and the text status. "Weitere Quellen laden" loads 100 more.

"Groß öffnen" opens the full view of a source:

- The frame is dark in the dark theme; the page itself stays white.
- Zoom runs from 50 to 300 %. The page image is rendered again at the matching resolution, so it stays sharp. "An Breite anpassen" fits the page to the width.
- Keys: arrow left and right or Page Up and Page Down turn pages, `+` and `-` zoom, `0` fits the width, Esc closes.
- Text can be selected directly on the page image (a transparent text layer lies over it). A selection can be saved as a quote and inserted at the cursor in the editor.
- A sidebar shows source details, the note and the saved quotes. It can be collapsed; spur remembers the state per person.
- "Original herunterladen" downloads the original file. It is in the full view and in the small preview.
- Closing the full view returns the preview to the same page.
- Up to a width of 768 px, inclusive, the view has a single column.

## The check report

The check report in the editor lists every citation with its verdict: is the wording in the source, does the page match, is the reference registered, has the paper been retracted. The header starts with the number of citations and the number flagged, then breaks the flagged ones down, for example "76 Stellen, 16 markiert: 13 mit Befund, 2 ohne Quelle, 1 nicht prüfbar". "Markiert" always means the citations that the filter "Markiert" shows, in the header, in the filter and in the files' rows. A citation that names a source without quoting it counts as "Beleg ohne Wortlaut".

The report groups the citations per file, with the number of citations and of flagged ones; each group can be collapsed. The filters "Alle", "Markiert", "Ohne Quelle" and "Nicht prüfbar" show their counts. "Zuletzt geprüft: heute, HH:MM" says when the check ran. While a new check runs, the old report stays visible.

In the editor, the red and yellow marks show a tooltip with the finding, with the same text as the badges in the report. It appears when you hover over the mark and when you move the cursor into it with the keyboard.

- Quote macros: spur recognises your own macros for quotations when their definition in a `.tex` file of the project maps to `\enquote`, `\textquote`, `\blockquote` or quotation marks, and checks their wording like `\enquote`. Claude cannot write invented wording into them either. Macros from a `.sty` file you add under "Einstellungen der Prüfung" → "Zitatmakros".
- Hidden notes: citations that do not appear in the PDF do not count. That covers macros defined as empty (such as `\newcommand{\note}[1]{}`), `\iffalse … \fi` and Beamer's `\note{…}` without `\setbeameroption{show notes}`. The report says how many it skipped. Further macros go under "Ausgeblendete Makros".
- Registration agencies: DOIs from Crossref are checked there, including retractions. DataCite DOIs (arXiv, for example) show "Registriert bei DataCite"; DataCite does not report retractions. DOIs of other agencies show "Registriert bei <Name>, Metadaten nicht geprüft" and are no problem. Red means `doi.org` does not know the DOI. If `doi.org` or DataCite cannot be reached, the row says "nicht prüfbar" and is not red.

Anyone who may write in the project can change both lists; anyone else can read them.

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
