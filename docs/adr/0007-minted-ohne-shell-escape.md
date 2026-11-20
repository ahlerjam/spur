# 0007: minted without full shell escape

## Context and Problem Statement
Code listings with `minted` did not work: the package was not in the image. minted passes the code to an external program for highlighting, and older versions needed `pdflatex -shell-escape` for that. In the standard installation the compile service runs latexmk without a sandbox, so full shell escape would let every user document run any command on the server (`\immediate\write18{…}`).

## Considered Options
- Install `minted` and keep TeX Live's restricted shell escape (`shell_escape=p`)
- Turn on `-shell-escape` in `services/clsi/app/js/LatexRunner.js`
- Leave `minted` out and point to `listings`

## Decision Outcome
`minted` goes into the curated package list in `server-ce/Dockerfile-base` and nothing about shell escape changes. The minted documentation (minted.dtx v3.8.0 of 2026/03/03, section "Basic usage", subsection "The latexminted Python executable and shell escape") says: "For up-to-date installations of TeX Live 2024+, the -shell-escape option is no longer required. The latexminted Python executable has been added to TeX Live's list of trusted executables." The TeX Live package `minted` brings `latexminted` with its Python libraries, Pygments included; it needs Python 3.8 or newer, which the image has from apt. `-shell-escape` stays off because it would mean running arbitrary commands from user documents. `listings` stays in the image as an alternative that needs no external program.

### Consequences
- The Dockerfile runs `latexminted --version` and checks the Python version after the TeX Live installation; a broken helper stops the build.
- The workflow `Dev image` compiles `services/web/modules/spur/scripts/smoke/minted-beispiel.tex` and fails on "You must invoke LaTeX with the -shell-escape flag". It also compiles a document with `\immediate\write18{touch /tmp/spur-shell-test}` and fails if the file exists.
- `tools/tests/tex-pakete.test.mjs` fails if `LatexRunner.js` ever passes `-shell-escape`, `--shell-escape` or `-enable-write18`.
- Restricted shell escape does not make compiling a sandbox. latexmk reads a `latexmkrc` in the project, and that file is Perl that runs on the server; this decision does not change that.
- Limit: only the programs on TeX Live's `shell_escape_commands` list run. Packages that need other programs (for example `\write18` calls to gnuplot or inkscape from `svg`) do not work. If minted fails in the workflow anyway, that is a finding for the owner, not a reason to turn on the flag.
