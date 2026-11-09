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
