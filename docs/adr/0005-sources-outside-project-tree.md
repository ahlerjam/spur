# 0005: Sources live outside the project tree

## Context and Problem Statement
Sources in the project folder trigger full compile syncs, burden history and Git, and extracted text exceeds the compile limit of 7 MB.

## Considered Options
- Separate storage in the data volume plus MongoDB
- Folder `quellen/` in the project
- Companion project

## Decision Outcome
Files live in `/var/lib/overleaf/data/spur/`, metadata and text per page in MongoDB. Permissions come from the project role, and cleanup runs through `projectExpired`.

### Consequences
- Backup is volume plus Mongo.
- Sources are not part of Git or ZIP exports; "export sources" ("Quellen exportieren") and "fetch from another project" ("aus anderem Projekt holen") replace that.
- When a project is cloned, spur points out the missing sources.
- The upload limits of nginx and web still apply.

## Addendum (P15, 2026-11-16): figures from sources
Sources stay outside the project tree. A figure from a source becomes a project file only as an excerpt (`source_figure_add`, PNG at 300 dpi) and only when the source carries an open licence that allows adaptations: CC BY, CC BY-SA, CC BY-NC, CC BY-NC-SA, CC0 or public domain. Licences with "ND" do not count, because an excerpt is an adaptation. The licence comes from Unpaywall when the source is added and is stored on the source; sources added before that have none. Without an open licence the tool answers `lizenz_fehlt`, and Claude redraws the figure ("adapted from") or names the reservation of rights. The answer carries a ready caption line with the `\textcite` key, the PDF page and the licence. The PNG is an ordinary project file, belongs to the run and leaves with "undo run".
