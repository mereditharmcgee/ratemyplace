# Owner of record list: design

**Date:** 2026-10-27 · **Status:** built on `feat/owner-of-record-list` after the owner approved it "as the brief said" (company owners plus any name with 2 or more residential parcels, an additive table with an index, a scripted backfill and a records Worker deploy). Production steps are listed under **Rollout**.

## What it is

In the records panel, the assessor's owner of record becomes a link to a list of every RateMyPlace building with the same owner of record, each showing its city record counts. Landlord search also finds owner of record names.

- Label: "Owner of record (City of Boston assessor)". It is a different thing from a landlord or manager a reviewer named, and the two are never merged.
- No score on the list. Record counts only, the same counts the panel shows, in the panel's three groups (living conditions; building safety and code; property upkeep). Each row also shows the assessor fiscal year its owner was read from.
- Group by the exact owner name, normalized for case, spacing and punctuation (`ownerKey`). Never by tax mailing address: a shared mailing address suggests who manages a property, it is not a record of who owns it.
- Link entity owners (LLC, LP, LLP, INC, CORP, TRUST, REALTY, ASSOCIATES, PROPERTIES, MANAGEMENT, COMPANY and similar, `isEntityOwner`), and a person only when two or more distinct residential parcels in our data carry the same name (`linkableOwnerKey`, `MIN_PARCELS_FOR_PERSON`). Parcels, not buildings: a duplicate page for one parcel does not count twice.
- A condominium parcel shows no single owner, so it never links and never appears in a list. The mailing-address gate (`showMailingAddress`) is unchanged; a link-only entity token does not publish a mailing address, and the list shows no mailing address at all.
- The list is a new page, `/owner-of-record?name=<owner key>&page=<n>`: noindex, classified in `pageIndexing.test.ts`, and not in `STATIC_SITEMAP_PATHS`.

## Why it needed storage

The owner name was stored in one place: the JSON `payload` of `building_records` rows with `kind = 'assessment'`, one row per fiscal year (up to six) per pulled building. No column held the assessor's owner of record, and no index could find a name.

`buildings.owner_name` (migration 0009) is not that column. It is an admin-entered field, set through the enrich and edit flow on 2 of 38,301 production buildings, and admins can edit it by hand, so it cannot carry an as-recorded value.

Measured against production on 2026-10-27, read-only:

| Query | Plan | Rows read | Time |
|---|---|---|---|
| Exact name, current fiscal year only, through the `(building_id, kind, source_key)` unique index | scan every building, seek one assessment row each | 76,524 | 10.1 s, then 4.5 s |
| For comparison: a scan of `buildings` alone | covering index scan | about 76,600 | 37 ms |

D1 runs one query at a time per database, so a 5 to 10 second query on a public URL would hold every other page for that long.

## Storage (built)

`migrations/0034_building_owners.sql`: one row per building for the newest fiscal year it has an assessor row for, in a new table, so nothing on `buildings` changes and `updated_at` (sitemap `lastmod`) does not move.

```sql
CREATE TABLE IF NOT EXISTS building_owners (
  building_id TEXT PRIMARY KEY REFERENCES buildings(id) ON DELETE CASCADE,
  fiscal_year TEXT NOT NULL,
  parcel_id TEXT,
  owner TEXT NOT NULL,
  owner_key TEXT NOT NULL,
  is_entity INTEGER NOT NULL CHECK (is_entity IN (0, 1)),
  residential INTEGER NOT NULL CHECK (residential IN (0, 1)),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_building_owners_key ON building_owners(owner_key, residential, parcel_id, is_entity);
```

Both statements are idempotent. `parcel_id` was added to the first draft so the person rule counts parcels, not buildings, and the index carries `residential`, `parcel_id` and `is_entity` after the key so the person rule and landlord search are answered from the index alone. Condominium parcels and blank owners get no row.

- **Write path.** `src/lib/records/owners.ts`. Each assessor year's pull batch carries a delete and an insert for the building's row, guarded by "no newer fiscal year is stored", so the row is always the year the panel shows and lands or rolls back with that year's rows. `pull.ts` asks `sqlite_master` once per pull and writes nothing before the migration has run. A year that drops off the assessor list takes its owner row with it. `pull.ts` also runs in `workers/records-scheduler`, so this needs `npm run records:worker:deploy` after the site deploy.
- **Backfill.** `npm run records:owners-backfill -- --remote` reads each building's newest stored assessor row (read-only, in pages of 5,000) and writes `owners-NNN.sql`, `rollback.sql` and `summary.txt` under `.cache/owners-backfill/<target>-<read time>/`. It applies nothing. `owner_key` is computed by the same `ownerRowFromAssessment` the pull uses. The upsert skips a building whose assessor rows were rewritten after the read and never overwrites a row a pull wrote after the read, so it is safe to re-run and safe beside the Worker. The rollback deletes exactly the rows the run wrote.
- **Reads.** `src/lib/records/ownerList.ts`. The list is a seek on `owner_key` joined to `buildings` by primary key, 20 a page, with record counts from `ledgerModel` over two batched reads for the page (`getRecordsViews`), so each row matches its panel. The panel link and the person rule are index-only counts. Landlord search scans the owner key index for the typed name (or seeks it exactly when the name is too long for a D1 `LIKE`). `ownerOfRecordStore.test.ts` checks each plan with `EXPLAIN QUERY PLAN`.
- **The person rule is enforced on the server, not only when drawing the link.** The list page runs the typed name through `ownerKey` and `linkableOwnerKey` with that key's distinct residential parcel count, and answers the site's ordinary 404 for a refused name, the same as for a name with no buildings, so the URL cannot confirm that a private person owns a property. Landlord search keeps only entity keys or keys at `MIN_PARCELS_FOR_PERSON`, in SQL and again in code.
- **Before the migration, and while the table is empty,** the owner stays plain text, the list answers 404 and landlord search finds no owner names. Nothing returns a 500.

## Rollout

1. Apply `migrations/0034_building_owners.sql` with `wrangler d1 execute --remote --file` (never `migrations apply --remote`).
2. Merge; the Pages deploy carries the readers and the admin pull path.
3. `npm run records:worker:deploy`, then check that cron invocations resume.
4. Off-hours: `npm run records:owners-backfill -- --remote`, then apply the files in the order `summary.txt` gives.
5. Check a few lists against the buildings' panels.

## Fiscal-year rollover

The table holds the newest year stored per building, so for a while after a new assessor year some rows lag until the refresh reaches them. Each list row shows the fiscal year it was read from.
