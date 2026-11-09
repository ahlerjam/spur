# 0004: The check reads plain LaTeX

## Context and Problem Statement
Hallucinated citations should be caught deterministically. Custom macros or citation IDs would tie projects to spur and would miss hand-written citations.

## Considered Options
- Check on plain LaTeX with a Lezer grammar
- Custom macro with a citation ID
- Check only on insertion

## Decision Outcome
Plain LaTeX. The checker detects the citation package from the preamble and runs once, centrally, on the server. The wording is compared against the source for the citation; matching goes first through the DOI, then through the key.

### Consequences
- The main protection is the project-wide check report, independent of the writer. The write lock only applies to Claude's path, not to uploads or Git.
- Statuses stay separate: wording, page, reference, retraction.
- Forms that are not recognized report "not checkable" ("nicht prüfbar"), and for Claude they are red without automatic acceptance.
- The check covers literal wording and existence, not the claim of a paraphrase.
