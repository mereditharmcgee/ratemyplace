# Owner of record list: design (blocked on storage)

**Date:** 2026-10-27 · **Status:** not built. Needs an additive table, a one-time backfill and a records Worker deploy, each awaiting the owner's sign-off.
**Built so far:** the naming and linking rules, `src/lib/records/ownerOfRecord.ts`, with tests in `src/lib/__tests__/ownerOfRecord.test.ts`. Nothing reads them yet.

## What it is

In the records panel, the assessor's owner of record becomes a link to a list of every RateMyPlace building with the same owner of record, each showing its city record counts. Landlord search also finds owner of record names.

- Label: "Owner of record (City of Boston assessor)". It is a different thing from a landlord or manager a reviewer named, and the two are never merged.
- No score on the list. Record counts only, the same counts the panel shows.
- Group by the exact owner name, normalized for case, spacing and punctuation (`ownerKey`). Never by tax mailing address: a shared mailing address suggests who manages a property, it is not a record of who owns it.
- Link entity owners (LLC, LP, LLP, INC, CORP, TRUST, REALTY, ASSOCIATES, PROPERTIES, MANAGEMENT, COMPANY and similar, `isEntityOwner`), and a person only when two or more residential parcels in our data carry the same name (`linkableOwnerKey`, `MIN_PARCELS_FOR_PERSON`).
- A condominium parcel shows no single owner, so it never links and never appears in a list. The mailing-address gate (`showMailingAddress`) is unchanged; a link-only entity token does not publish a mailing address.
- The list is noindex. `/search?owner=...` gets that for free, since `isSearchVariant` noindexes `/search` with any parameter; a new page would be classified noindex in `pageIndexing.test.ts` and kept out of `STATIC_SITEMAP_PATHS`.

## Why it is not built

The owner name is stored in one place: the JSON `payload` of `building_records` rows with `kind = 'assessment'`, one row per fiscal year (up to six) per pulled building. There is no owner column and no index that can find a name.

Measured against production on 2026-10-27, read-only:

| Query | Plan | Rows read | Time |
|---|---|---|---|
| Exact name, current fiscal year only, through the `(building_id, kind, source_key)` unique index | scan every building, seek one assessment row each | 76,524 | 10.1 s, then 4.5 s |
| For comparison: a scan of `buildings` alone | covering index scan | about 76,600 | 37 ms |

- The rows-read count is fine; the time is not. Each lookup reads one payload row per building, scattered across a 2.4 GB database (`building_records` has passed 2.1 million rowids).
- D1 runs one query at a time per database. A 5 to 10 second query holds every other page on the site for that long, and on a public URL anyone can repeat it.
- The production plan depends on stale `sqlite_stat1` rows that count `buildings` as 18 rows. On a local copy of the schema with no statistics the planner scans `building_records` itself, about 2 million rows. A future `ANALYZE` could move production to that plan.
- Linking a person needs a parcel count before the link is drawn, which would be the same scan on every building page view. Landlord search would need a `LIKE` over the same payloads. Neither is acceptable.

## Proposed storage (not built; needs sign-off)

One row per building for the newest fiscal year, in a new table, so nothing on `buildings` changes and `updated_at` (sitemap `lastmod`) does not move.

```sql
CREATE TABLE IF NOT EXISTS building_owners (
  building_id TEXT PRIMARY KEY REFERENCES buildings(id) ON DELETE CASCADE,
  fiscal_year TEXT NOT NULL,
  owner TEXT NOT NULL,          -- as recorded
  owner_key TEXT NOT NULL,      -- ownerKey(owner)
  is_entity INTEGER NOT NULL,   -- isEntityOwner(owner)
  residential INTEGER NOT NULL, -- isResidentialAssessment(row)
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_building_owners_key ON building_owners(owner_key);
```

Both statements are idempotent, so unlike an `ALTER TABLE ... ADD COLUMN` the file can be re-run. Condominium parcels get no row.

- **Write path.** `pull.ts` deletes and inserts the building's row in the same batch as its assessor rows. `pull.ts` also runs in `workers/records-scheduler`, so this needs `npm run records:worker:deploy` after the site deploy.
- **Backfill.** `owner_key` must equal `ownerKey()` exactly, which SQL cannot express, so a script reads the stored payloads (one 5 to 10 second read, run off-hours) and emits SQL through `lit()`, applied by hand with `wrangler d1 execute --remote --file`, the seed's pattern. This is a production write and needs the owner's approval.
- **Reads.** The list is an index seek on `owner_key` joined to `buildings`, with record counts from the covering index `idx_building_records_building_kind`, paginated. The person rule on a building page is one index-seek `COUNT`. Landlord search adds a `LIKE` over `building_owners.owner`: about 38,000 short rows stored together, the same order of cost as today's address scan.

Verified with `EXPLAIN QUERY PLAN` on a local copy of the schema: the list, the count and the record counts are all index searches; today's payload match is a full scan.

## Open questions for the owner

1. The person rule. A person with two or more residential parcels gets a list, and one of those addresses may be their home. The panel already hides a person's tax mailing address for that reason. Keep the rule, or link entities only?
2. Which counts each list row shows. They should match the panel, which is changing to three record groups.
3. Fiscal-year rollover. The table holds the newest year pulled per building, so for a while after a new assessor year some rows lag. Show the fiscal year on each row, or wait until the refresh has caught up?
4. Whether to approve the migration, the backfill and the Worker deploy as one change after the call.
