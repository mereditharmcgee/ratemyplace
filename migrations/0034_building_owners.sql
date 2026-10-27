-- migrations/0034_building_owners.sql
-- The assessor's owner of record, one row per building, so the records panel can link an
-- owner to the other buildings recorded under the same name and landlord search can find it.
-- Design: docs/superpowers/specs/2026-10-27-owner-of-record-list-design.md.
--
-- PRODUCTION NOTE: this file is FULLY IDEMPOTENT, like 0032 and 0033. One CREATE TABLE IF
-- NOT EXISTS and one CREATE INDEX IF NOT EXISTS: no ALTER TABLE ADD COLUMN, no table rebuild,
-- nothing on `buildings`. Re-running it costs nothing and it cannot half-apply. Apply it with
-- `wrangler d1 execute --remote --file`, never `migrations apply --remote` (see
-- migrations/AGENTS.md: wrangler does not know 0025 to 0033 ran). Do not add a
-- non-idempotent statement to it.
--
-- Nothing here touches `buildings`, so `buildings.updated_at` (the sitemap's lastmod) does
-- not move. The table starts empty; rows come from the records pull (`src/lib/records/owners.ts`,
-- run by the site and by the records Worker) and from the one-time
-- `npm run records:owners-backfill`. The site reads it defensively: before this file runs, or
-- while the table is empty, the owner of record stays plain text and nothing errors.
--
-- One row per building for the newest fiscal year it has an assessor row for, the same row
-- the panel shows. A condominium parcel shows no single owner and a blank owner has nothing to
-- link, so neither gets a row. Every value is the code's (`ownerRowFromAssessment` in
-- `src/lib/records/ownerOfRecord.ts`): owner_key must equal `ownerKey(owner)` exactly, which
-- SQL cannot compute, so no statement here derives one.
CREATE TABLE IF NOT EXISTS building_owners (
  building_id TEXT PRIMARY KEY REFERENCES buildings(id) ON DELETE CASCADE,
  -- The assessor fiscal year the owner was read from, e.g. 'FY2026' (building_records.source_key).
  fiscal_year TEXT NOT NULL,
  -- Canonical 10-digit parcel id from the same assessor row. The person rule counts distinct
  -- parcels, so a building with a duplicate page is not counted twice.
  parcel_id TEXT,
  -- The owner name as the assessor recorded it.
  owner TEXT NOT NULL,
  -- ownerKey(owner): upper case, periods and commas dropped, whitespace collapsed.
  owner_key TEXT NOT NULL,
  -- isEntityOwner(owner), 1 or 0.
  is_entity INTEGER NOT NULL CHECK (is_entity IN (0, 1)),
  -- isResidentialAssessment(row), 1 or 0. Only residential parcels count toward the person rule.
  residential INTEGER NOT NULL CHECK (residential IN (0, 1)),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

-- Leads with the normalized owner key: the list is a seek on owner_key, and the person rule's
-- count (residential rows, distinct parcels) and landlord search's name match are answered
-- from the index alone, without reading the table.
CREATE INDEX IF NOT EXISTS idx_building_owners_key ON building_owners(owner_key, residential, parcel_id, is_entity);
