---
name: spur-pdf-holen
description: Fetches free PDFs that the spur server could not download (bot protection) on this computer, in a headless browser if needed, and uploads them to spur. Use on "bot_schutz", "frei, Download blockiert", "PDF holen", "fetch the PDF", "download blocked", or when a source is free but not in the project.
---

# Fetching free PDFs on this computer

For papers that are free but turn the spur server away. `source_add` then answers `bot_schutz`, with `adresse` (the best address for a browser) and `versucht` (every address it tried), and puts the DOI on the acquisition list with the reason "frei, Download blockiert". `search_log` counts these under `prisma.nicht_beschaffbar`.

## Steps

1. Collect the DOIs with `bot_schutz` from the answers of `source_add` in this run, with `adresse` and `versucht`. Earlier entries are on the acquisition list in the browser, reason "frei, Download blockiert"; ask the person for those DOIs.
2. Run `spur-pdf-holen <DOI> <folder>`. It tries arXiv for arXiv DOIs, then every free location Unpaywall lists (repositories before publisher pages), then Europe PMC, and prints only the path of the PDF.
   - Exit 0: done, go to step 5.
   - Exit 1 with "keine freie Version gefunden": there is no free copy. Stop here for this DOI; it stays on the acquisition list.
   - Exit 3 with "keine PDF-Datei": the addresses returned a web page instead of the PDF, usually bot protection. Go on with step 3.
3. Open the free address in the browser with the tools of the Playwright plugin (`browser_navigate`, then `browser_snapshot` to see the page). Use only an address that Unpaywall or Europe PMC lists as free: `adresse` or a `url` from `versucht`, or one that `spur-pdf-holen` printed. If the page shows a PDF viewer or a download link, click it (`browser_click`).
4. Save the PDF into the same folder and check that the file starts with `%PDF-` (`head -c 5 <file>`). A file that starts with anything else is a web page: delete it and do not upload it.
5. Call `source_upload_link`. It returns a one-time link, valid for 15 minutes, for up to 50 files.
6. Run `spur-hochladen <link> <file> --doi <DOI>`. With `--doi`, spur matches the upload to the entry on the acquisition list and takes the metadata from the DOI.
7. Cite the source as usual (`source_search`, `source_read`, `check_report`).

## Limits

- Only addresses that Unpaywall or Europe PMC name as free.
- No paywalls, no credentials of others, no shadow libraries, no disguise techniques against bot detection, no solving of captchas.
- If a check, a captcha or a login appears, stop and ask the person to open the page themselves and save the PDF; then continue with step 4.
- At most one request every 5 seconds per publisher.

If no free copy loads, say so in the summary and leave the entry on the acquisition list.

## Headless browser and downloads

The Playwright plugin starts the Playwright MCP server (`npx @playwright/mcp@latest`). According to the server's README (microsoft/playwright-mcp, "Configuration"), it runs headed by default; the option `--headless` or the environment variable `PLAYWRIGHT_MCP_HEADLESS` switches to headless. The plugin passes no option, so set the variable before you start Claude Code:

```sh
export PLAYWRIGHT_MCP_HEADLESS=true
export PLAYWRIGHT_MCP_OUTPUT_DIR="$HOME/spur-pdfs"
```

The same README ("Tab, Requests / downloads") says downloads are saved automatically into the output directory (`--output-dir`, variable `PLAYWRIGHT_MCP_OUTPUT_DIR`) and appear as `download-start` and `download-finish` events in the tool answers. Take the path from `download-finish`, move the file into your folder and check it as in step 4.
