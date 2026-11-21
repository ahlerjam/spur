---
name: spur-endpruefung
description: Checklist for the final check of a spur paper before the humanizer pass and run_finish. Use for "Endprüfung", "final check", "abgabefertig", "ready to submit", and in the agent spur:endpruefung.
---

# Final check

Runs after the corrections from the claim check (`spur:gegenpruefung`). Check each point, and report what you found. You do not fix anything yourself.

## Checks in the project

1. Check report: call `check_report` (all pages with `cursor`). No marked citation (`problem: true`) may stay without a reason in the text or in the draft summary. List each one with its `grund`.
2. Compile: call `compile`, wait with `job_status` until it is `fertig` or `fehlgeschlagen`, and read `compile_log`. The compile must end without errors and with an empty `fehlende_pakete`. Report every error with file, line and message; report warnings about undefined references or citations as well.
3. Figures and tables: find every page with a figure or table (from the PDF and the `figure`, `table` environments in the source) and look at it with `page_image`. Measure each figure and table against the rules of `spur-abbildungen` and name each rule that fails.
4. References: call `bib_list`. Every entry used in the text must have `abweichungen` empty (`[]`). Report each deviation with field, value in the entry and expected value. `null` with `abweichungen_grund` means it could not be checked; say so.
5. Run: call `run_status`. Report the number of open (`offen`) and red (`rot`) changes from `aenderungen`. Red changes need a decision of the person; name them in the summary.
6. Summary: every statement in the draft summary for the owner must be backed by a result of this run (a tool answer, a verdict of the claim check, a page you looked at). Flag each statement without evidence.

## Checks in the LaTeX source

Read every `.tex` file in the range with `doc_read`. Each finding names file and line.

7. Double-escaped citation commands: `\textbackslash{}cite`, `\textbackslash{}parencite`, `\textbackslash{}textcite`, `\textbackslash{}footcite` (and the starred and plural forms). They print the command as text instead of a citation.
8. Package order: `cleveref` loaded before `hyperref`. `cleveref` must come after `hyperref`.
9. Bibliography packages: `biblatex` and `natbib` loaded at the same time.
10. Unused labels: a `\label` inside a `figure` or `table` environment that no `\ref`, `\autoref`, `\cref` or `\Cref` anywhere in the project points to. Labels of sections and equations do not count here; leave them out, or the list becomes noise.
11. Order: figures and tables whose order in the source differs from the order of their first mention in the text (first `\ref`, `\autoref`, `\cref` or `\Cref`).

## Output format

A list of findings, each with finding, place and suggestion. If there is nothing: "keine Befunde".

```
1. Finding: Figure 2 uses three fill colours (blue, orange, green). Place: page 6, abbildungen.tex:12. Suggestion: grey shades with hatching, see spur-abbildungen.
2. Finding: \textbackslash{}parencite{smith2024} prints as text. Place: main.tex:88. Suggestion: \parencite{smith2024}.
3. Finding: bib_list: smith2024 pages "113" in the entry, Crossref "113-129". Place: literatur.bib. Suggestion: pages = {113--129}.
4. Finding: run_status: 2 red changes open. Place: run card. Suggestion: name both in the summary for the owner.
```

End with the count: findings in total, and how many per check.
