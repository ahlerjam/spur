# 0006: DOI check across registration agencies

## Context and Problem Statement
The check report asked only Crossref. Crossref answers 404 for DOIs that another agency registered, above all arXiv DOIs (`10.48550/arXiv.…`) at DataCite, so correct references showed up red as "DOI bei Crossref unbekannt" and were cached as unknown for a day.

## Considered Options
- Crossref, then `doi.org` for the registration agency, then DataCite for DataCite DOIs
- Resolve every DOI through `doi.org` content negotiation (`Accept: application/vnd.citationstyles.csl+json`)
- Keep Crossref only and mark 404 as "nicht prüfbar"

## Decision Outcome
Crossref stays first, because only Crossref reports retractions. On a 404 spur asks `https://doi.org/doiRA/<doi>` which agency registered the DOI. For DataCite it fetches title, authors and year from `https://api.datacite.org/dois/<doi>` and shows "Registriert bei DataCite" with the note that DataCite reports no retractions. Other agencies show "Registriert bei <Name>, Metadaten nicht geprüft", neutral. Red remains only for DOIs that `doi.org` does not know. Content negotiation would follow redirects to many hosts and return metadata of uneven quality; keeping Crossref only would hide real errors behind "nicht prüfbar".

### Consequences
- Two more fixed hosts in operation, `doi.org` and `api.datacite.org`, both without a key, with a timeout of 10 s and the DOI encoded per path segment.
- The answer of `doi.org` and DataCite is cached for a day under its own key; a failure is never cached and shows "nicht prüfbar", not red.
- `bib_list` and `check_report` carry `registrierstelle` and the new state `registriert`; existing fields stay.
- Retractions of DataCite DOIs stay unknown.
