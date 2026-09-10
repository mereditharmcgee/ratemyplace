# `migrations/` — D1 Schema Changes

Cloudflare D1 (SQLite). 33 migrations, `0001` through `0033`.

---

## Read this before running anything against production

**Migrations `0025`–`0028` were applied to production outside wrangler's migration
tracking** — `0025`–`0027` through the Cloudflare dashboard console, and `0028` via
`wrangler d1 execute --remote --file` (deliberately, because `migrations apply --remote`
would have tried to re-run the dashboard-applied ones). Wrangler does not know any of them
ran.

`0027` is a non-idempotent `DROP COLUMN` batch — 15 columns. Re-running it fails, and
running `migrations apply --remote` blindly may attempt exactly that.

**`0029` and `0030` (public building records) are the same kind of hazard.** `0029` adds
`parcel_id` and `sam_id` to `buildings` with `ALTER TABLE ... ADD COLUMN`, which SQLite has
no `IF NOT EXISTS` form for, so re-running it fails with `duplicate column name` and takes
the rest of the file down with it. `0030` rebuilds `audit_logs` to widen its `action_type`
CHECK for `records_pulled` and `record_correction_resolved`, following the 0028 pattern:
create `audit_logs_v4`, copy every row, drop, rename.

Apply both with `wrangler d1 execute --remote --file`, one file at a time, never
`migrations apply --remote`. Back up `audit_logs` before running `0030`, and verify the row
count matches afterwards; the copy is the whole risk in a table rebuild.

**APPLIED TO PRODUCTION 2026-09-07** via `wrangler d1 execute --remote --file`, `0029` then
`0030`, in that order. `audit_logs` held 55 rows (ids 1 to 55) before and after; `parcel_id`
and `sam_id` present; the three records tables and all four `idx_audit_*` indexes exist; no
`audit_logs_v4` left behind. Like `0025` through `0028`, wrangler's migration tracking does
not know these ran. Do not re-run either file.

**`0031` (Boston coverage) is the same kind of hazard.** It adds five columns with
`ALTER TABLE ... ADD COLUMN` — `buildings.source`, `buildings.street_key`,
`buildings.st_num_lo`, `buildings.st_num_hi`, and `record_pulls.trigger_reason` — and
creates two tables, `records_queue` and `app_settings`. Apply it once with
`wrangler d1 execute --remote --file`, never `migrations apply --remote`, and before running
the seed script.

**APPLIED TO PRODUCTION 2026-09-09** via `wrangler d1 execute --remote --file`, in one run
(106 rows written). Verified afterwards: all four `buildings` columns,
`record_pulls.trigger_reason`, `records_queue`, `app_settings`, and the three indexes exist;
the 93 existing buildings read `source = 'user'`; the 22 pull rows are untouched. Wrangler's
migration tracking does not know it ran. Do not re-run the file.

Its statements are ordered idempotent-first as far as they can be, but not entirely:
`idx_buildings_street` indexes `buildings(city, street_key)`, so it has to come after the
`ALTER` that adds `street_key`. Recovering a partial apply is therefore two steps, in this
order: read the live schema, see which of the five columns exist, and **re-run by hand only
the `ALTER`s that did not land**; then **re-run the file's `CREATE INDEX IF NOT EXISTS`
statements**, which are idempotent and no-ops for an index that already exists. Do not
reorder the file to collapse that into one step — the index cannot be created before its
column. Note that `app_settings.updated_at` defaults on insert but does not self-update; a
writer that flips a value must set it.

**The seed that follows.** `npm run records:seed` populates the new `buildings` columns for
Boston from the FY2026 assessor plus SAM. Its modes are `-- --dry-run` (compute and print the
summary, write nothing), `-- --write` (also write the SQL), `-- --apply --local`, and
`-- --apply --remote` (needs `CLOUDFLARE_API_TOKEN`). `--refresh` re-downloads instead of
reusing the day-old cache in `.cache/`. Operational facts worth knowing before you run it:

- It writes SQL batch files of 999 statements each under `.cache/seed/`: a multiple of three,
  so every file holds whole buildings (row, pull, record), and under 1,000 because
  2,000-statement files hang the local D1 for five minutes and then fail with a
  `Body Timeout Error`, rolling the whole file back. Do not raise it.
- `-- --apply --remote --from 12` resumes applying at batch file 12 after a failure; the
  script names the file it is on as it goes. A resume applies the batch files **already on
  disk** and regenerates nothing — the downloads are only cached for a day, and a re-download
  that gains or loses one parcel shifts every later building across a file boundary. It fails
  loudly if `.cache/seed/` holds no files or fewer than the number asked for. A bare `--from`
  with no number is an error, not a silent "start from the beginning".
- `wrangler d1 execute --json` renders a SQL `NULL` as the JSON *string* `"null"`. The script
  folds that back to `null` when it reads existing rows; anything else that shells out to
  wrangler has to do the same.
- The whole apply is idempotent — seeded rows have deterministic ids (`seed-<parcel>`) and are
  upserted — so a remote apply that fails partway is safely re-run from the start.

**RUN AGAINST PRODUCTION 2026-09-09**, after `0031`: 38,208 seeded buildings, each with an
FY2026 assessor pull row and its record. Re-running is an upsert and is safe, but there is no
reason to — check `SELECT COUNT(*) FROM buildings WHERE source = 'seed'` before assuming
otherwise.

**`0032` (records queue indexes) is the exception: it is FULLY IDEMPOTENT.** Three
`CREATE INDEX IF NOT EXISTS` statements and nothing else — no `ALTER TABLE`, no table
rebuild — so it cannot half-apply and re-running it costs nothing. It is the only file since
`0024` with no re-run hazard, and it is safe either way: `wrangler d1 execute --remote --file`
or `migrations apply`. Do not add a non-idempotent statement to it. The three indexes are
`idx_records_queue_building` on `records_queue(building_id)` (the partial unique index from
`0031` only covers pending rows, so the planner's finished-`button` lookup had nothing to
use), `idx_saved_buildings_building` on `saved_buildings(building_id)` (`0023` indexes
`user_id`, and the UNIQUE leads with it), and `idx_record_pulls_retrieved` on
`record_pulls(retrieved_at, source_id, status)` for the circuit breaker's trailing-24-hour
`GROUP BY source_id` — the one scan that gets slower every month the fill runs.

**APPLIED TO PRODUCTION 2026-09-09** by hand, alongside `0031` and the seed. Wrangler's
migration tracking does not know it ran; unlike every other file above, re-running it is
harmless.

**`0033` (records queue reason/requested index) is idempotent too, and is NOT YET APPLIED TO
PRODUCTION.** One `CREATE INDEX IF NOT EXISTS` over `records_queue(reason, requested_at)`,
which is the daily-cap count behind the public records button:
`SELECT COUNT(*), MIN(requested_at) … WHERE reason = 'button' AND requested_at >= ?`. Neither
`0031` nor `0032` covers those two columns, and `button` rows are never purged, so that count
scanned a growing table on every unauthenticated press. **Apply it by hand before the
city-wide fill is unpaused** — see the runbook's first-unpause checklist:

```bash
npx wrangler d1 execute ratemyplace-db --remote --file migrations/0033_records_queue_reason_requested.sql
```

Then confirm it landed:

```bash
npx wrangler d1 execute ratemyplace-db --remote --command \
  "SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_records_queue_reason_requested'"
```

**`app_settings` keys in use.** The table is a key/value store for operator switches; the
records pipeline owns three, defined once in `SETTING_KEYS` in `src/lib/records/settings.ts`:

| Key | Value |
|-----|-------|
| `records_fill_paused` | `'1'` or `'0'`. The city-wide fill brake. Set by the circuit breaker, cleared only by a human from `/admin/records` |
| `records_breaker_last_alert` | Unix seconds of the last breaker email, so a paused fill does not alert again |
| `records_fixture_last` | JSON: what the daily Lanark fixture saw. Rendered by the admin queue panel |

`updated_at` defaults on insert and does not self-update, so every writer sets it explicitly
(`writeSetting` does).

Before touching production schema: check the live schema directly, confirm what has
actually been applied, and apply deliberately. Do not assume wrangler's state is accurate.

```bash
# Local — safe, this is the normal loop
npx wrangler d1 migrations apply ratemyplace-db --local

# Remote — verify current schema first, and know what you are running
npx wrangler d1 migrations apply ratemyplace-db --remote
```

Remote D1 CLI access requires `CLOUDFLARE_API_TOKEN` in the environment. Without it you
get a 7403 error.

## Writing a migration

Format: `XXXX_description.sql`, zero-padded, incrementing. Check the directory for the
highest number.

Two filenames are misleading: `0021_reserved.sql` actually creates the `notifications`
table despite its name, and `0022_reserved.sql` is a genuine no-op (`SELECT 1;`). Do not
assume either is empty — read before touching.

### Rules

- **Timestamps are `unixepoch()`**, never `datetime('now')`:
  ```sql
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
  ```
- Use `CREATE TABLE IF NOT EXISTS` for new tables.
- Add `CHECK` constraints for enumerated values — the schema already does this for
  `status`, `unit_type`, and seasons. Keep it up.
- Foreign keys use `REFERENCES ... ON DELETE CASCADE` where a child row has no meaning
  without its parent.
- A migration is append-only once applied to production. Fix mistakes with a new
  migration, never by editing an applied file.

### Dropping a column safely

The 0025–0027 sequence is the pattern to copy:

1. Stop reading the column in code, ship it, verify in production.
2. Backfill the canonical column if you are consolidating two into one.
3. Only then drop, in a separate migration.

Dropping a column that deployed code still reads takes the site down.

## Schema overview

| Table | Holds |
|-------|-------|
| `users`, `sessions` | Lucia auth, `is_admin`, nullable password (OAuth accounts) |
| `buildings` | Address, geo, `place_id`, slug, landlord and manager links |
| `landlords`, `property_managers` | Separate entities — a building can have both |
| `reviews` | 27 rating columns + tenancy, unit type, rent, free text, status |
| `verification_images`, `verification_tokens` | Proof-of-address pipeline, email tokens |
| `disputes` | Landlord dispute submissions and resolutions |
| `audit_logs` | Destructive admin actions, old value → new value |
| `notifications` | In-app tenant notifications |
| `saved_buildings` | Bookmarks |
| `record_pulls`, `building_records` | Public building records from city open data. `record_pulls` is insert-only provenance, one row per source run; `building_records` holds the typed JSON payloads, unique on `(building_id, kind, source_key)` |
| `record_corrections` | Public "report a record error" claims and their resolutions. Stores the claim and an optional email, nothing else about the filer |
| `records_queue` | Pending record pulls, one pending row per building, with reason and priority; drained by the records-scheduler Worker (sub-project C) |
| `app_settings` | Operator switches, e.g. `records_fill_paused` |
| `rate_limits` | Fail-closed rate limiting, keyed and windowed |
| `contact_messages`, `bug_reports` | Inbound forms with admin queues |
| `password_reset_tokens` | Reset flow |

The `building_scores`, `landlord_scores`, and `property_manager_scores` cache tables were
dropped in `0025` — do not reintroduce a table-level score cache without a deliberate
decision, the previous one drifted from live data.

`reviews.overall_score` is a different thing and **still exists**: a stored per-review
value that aggregate queries read. See [`src/lib/AGENTS.md`](../src/lib/AGENTS.md) for why
that makes a weight change diverge rather than propagate.

## Adding a survey column

A new rating item is a five-step change spanning this directory and `src/lib/`. See
[`src/lib/AGENTS.md`](../src/lib/AGENTS.md) — the migration is only step one, and a column
added without the other four steps is dead weight.

## Known cosmetic debt

`had_pests` and `had_pest_issues` both exist for the same concept. It works via fallback
logic and is harmless. Consolidating is fine; leaving it is also fine.

## Local development

```bash
npm run db:fresh    # drop and recreate local D1
npm run db:seed     # realistic seed data
npm run db:setup    # both
```

E2E tests (`npm run e2e`) run `db:setup` first. Seed scripts live in `scripts/` — when you
add a column that reviews depend on, update the seed script too or E2E breaks.
