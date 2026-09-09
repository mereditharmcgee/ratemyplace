# Boston coverage (v1.7.0 sub-project C) — design

**Date:** 2026-09-08 · **Status:** approved in conversation, awaiting owner review of this file
**Depends on:** sub-project A (records foundation, shipped 2026-09-07) and the records panel redesign (PR #24, shipped 2026-09-08)
**Parent spec:** `2026-09-06-building-records-design.md`, which names this sub-project and defers the scheduled Worker to it

## What this is

A page for every whole-building rental parcel in Boston, seeded from the assessor, so a renter who arrives with a specific address finds the city's records there before anyone has written a review. It adds the timer sub-project A deliberately left out: a companion Worker that drains a pull queue at a polite rate, fills the whole city in over about a month, and refreshes the buildings people care about monthly.

The reader-first deferral in `ops/growth/STRATEGY.md` is lifted for Boston by this release, on the condition it named: coverage.

## Decisions

| # | Decision | Rejected | Why |
|---|---|---|---|
| 1 | Seed every whole-building rental parcel: land use R2, R3, R4, RC, and housing-only A. About 38,400 pages | 4+ units only (~8,300); adding condo buildings CM (~11,100 more) | Most Boston renters live in two- and three-families; CM pages would carry no owner or building value because the assessor puts those on units |
| 2 | Assessor facts on every page from the bulk download; deeper sources on demand and by a slow city-wide fill | Deep-pull all 38,400 up front; facts only until a review exists | About 770,000 requests done as a burst reads as scraping and risks the panel on reviewed buildings; facts only leaves the page empty for the reader it exists for |
| 3 | A public "Get this building's city records" button that enqueues one pull, Turnstile-gated, rate-limited, capped site-wide, never re-pulls | Lazy pull on page view (rejected permanently in the parent spec) | The reader chooses, the cost is bounded, and a press is a signal of interest |
| 4 | Sitemap lists all Boston building pages from day one | Only pages with a pull or a review; no sitemap until the fill completes | Owner's call: fastest path to ranking for address searches. Each seeded page is already unique (owner, year, value, land use), and `lastmod` moves when a pull lands |
| 5 | Search returns every matching building, reviewed first with score, seeded after with "No reviews yet · city records" | Reviews-only search plus a separate address box; everything mixed | One box for one job; scored results stay on top |
| 6 | Reviewer dedupe by normalized street key and house-number range before creating a building | Replace Google autocomplete with our own address search for Boston | Smallest change; also fixes the duplicate risk for the Boston buildings already in production |
| 7 | A companion Worker in this repo on a Cron Trigger, sharing D1 and bundling `src/lib/records` | Migrate the site from Pages to Workers; GitHub Actions calling a secret endpoint | One pull implementation; the site's deployment does not change |
| 8 | One queue with three priorities (button and follower, refresh, fill) and a daily planner | Separate queues; per-building refresh intervals | One rate limiter toward the city; one rule the methodology page can state |
| 9 | Circuit breaker pauses the fill on fixture failure or a source error rate over 50 percent, emails once, resumes only by hand | Automatic retry and resume | A retired dataset id must stop the flood, not burn 38,000 pulls into error rows |
| 10 | The map stays reviewed-only | Plot seeded buildings | 38,400 markers makes the map useless, and it is the one surface where the score is the point |

## Numbers that drove the design

Live assessor FY2026 counts on 2026-09-08. Description filters for A are listed in Section 1.

| Land use | Parcels | In seed |
|---|---|---|
| R2 two-family | 16,701 | yes |
| R3 three-family (incl. multiple buildings on one lot) | 13,343 | yes |
| R4 apartments 4–6 units | 2,485 | yes |
| RC residential over commercial, commercial multi-use | 2,956 | yes |
| A apartments 7+, luxury, subsidized, rooming house | ~2,900 | yes |
| A dorms, day care, parking, rectory, lodging suites, elderly home | ~150 | no |
| CM condo main | 11,139 | no |
| CD condo unit | 74,254 | no |
| R1 single-family | 30,439 | no |

Per building a deep pull is about 20 requests to data.boston.gov (311 alone spans 17 yearly datasets) and about 30 stored rows. City-wide that is about 770,000 requests and 1.2 million rows, roughly 600 MB in D1. At one building a minute the fill takes about four weeks.

## Section 1: Seed pipeline

`scripts/records-seed-boston.ts`, run by the owner from a machine with `CLOUDFLARE_API_TOKEN`, the way migrations are applied. Idempotent; re-run each fiscal year.

**Sources.** Two bulk downloads paged once through `datastore_search`, not per-building SQL: the FY2026 assessor resource already used by the panel, and the city's SAM (Street Address Management) resource, which carries a coordinate and a SAM id per address point and a parcel id column. The SAM resource id is a code constant beside the assessor's, checked by `npm run records:check`.

**Filter.** `LU IN ('R2','R3','R4','RC')`, plus `LU = 'A'` where `LU_DESC` is one of: `APT 7-30 UNITS`, `APT 31-99 UNITS`, `APT 100+ UNITS`, `LUXURY APARTMENT`, `SUBSD HOUSING S- 8`, `SUBSD HOUSING S-202`, `SUBSD HOUSING S-231D`, `ROOMING HOUSE`. The allowlist is a code constant with the excluded descriptions listed in a comment. Rows with the same `PID` (multi-building lots, `BLDG_SEQ` > 1) collapse to one building: first row's address and year, `RES_UNITS` summed.

**Building row.**

| Column | Value |
|---|---|
| `address` | formatted the way existing pages read: `ST_NUM`[`-ST_NUM2`] plus street name with the suffix spelled out ("23-27 Lanark Road"), using the suffix table in `src/lib/records/identity.ts` |
| `city` | `Boston` |
| `neighborhood` | assessor `CITY` title-cased (Allston, Dorchester, Roxbury, …); `BOSTON` becomes null |
| `state`, `zip_code` | `MA`, assessor `ZIP_CODE` zero-padded |
| `latitude`, `longitude`, `sam_id` | from the SAM row for the parcel; the lowest SAM id when a parcel has several address points; null when none |
| `parcel_id` | canonical form from `identity.ts` |
| `unit_count`, `year_built`, `building_type` | `RES_UNITS`, `YR_BUILT`, and a type derived from land use (`two_family`, `three_family`, `apartment`, `mixed_use`) |
| `street_key`, `st_num_lo`, `st_num_hi` | Section 5 |
| `source` | `seed` |
| `slug` | existing convention `<address-slug>-boston`, numeric suffix on collision |

> **Amended 2026-09-09, as built (C1):**
>
> - **Neighborhood and ZIP come from SAM first.** Both read the `MAILING_NEIGHBORHOOD` and
>   `ZIP_CODE` of the parcel's primary SAM address point, falling back to the assessor's
>   `CITY` and `ZIP_CODE` only when the parcel has no SAM point. SAM is the address
>   authority; the assessor's `CITY` is a postal district.
> - **ZIPs go through `zip5`** (`src/lib/records/seed/sam.ts`), the one normalizer for both
>   feeds: it restores a leading zero lost to a numeric column and trims a ZIP+4, and
>   returns null rather than a plausible-looking wrong answer for anything that is not four
>   or five digits.
> - **Units for R2 and R3 rows the assessor leaves blank are implied**, 2 and 3
>   respectively. Caveat: on a multi-building lot the implied count is per assessor row, so
>   a two-building R3 parcel with both `RES_UNITS` blank reads as 6, not 3. Any row that
>   does carry `RES_UNITS` is used as given, and the parcel's rows are summed.
> - **A parcel whose `ST_NUM` is 0** (the assessor's placeholder for an unnumbered lot) is
>   skipped, not seeded as "0 Something Street".
> - **A comma tail in `ST_NAME` renders in parentheses**: `LANARK RD, REAR` becomes
>   `23-27 Lanark Road (Rear)`. The suffix table keys off the street alone, so the tail
>   never confuses the street key.
> - **Real count: 38,221 buildings**, not the ~38,400 estimated from the land-use table
>   above. The difference is the skipped rows — no parcel id, no usable address, `ST_NUM` 0.

**Existing buildings first.** Before inserting, the script loads every production building with `city = 'Boston'` and matches each onto a parcel by street key and number range. A match sets `parcel_id`, `sam_id`, `street_key`, and the range on the existing row and skips creating a twin. Rows it cannot match are printed for the owner to resolve by hand; nothing is guessed.

> **Amended 2026-09-09, as built (C1):** matching runs parcel id first — an existing row that
> already carries a `parcel_id` matches on it outright, because that is the assessor's own
> identifier rather than an inference. Only rows without one fall through to street key plus
> number-range containment, and a tie between two parcels on the same street and number is
> broken by the existing row's ZIP, because street keys repeat across neighborhoods. A tie the
> ZIP cannot break, a range that overlaps a parcel boundary without containing it, a range
> that swallows a whole parcel, and a row whose `parcel_id` disagrees with the address match
> are all reported, not resolved. Every parcel referenced by any of those ambiguous or
> conflicting matches is held back from creation, so a parcel waiting on the owner's
> resolution is never seeded as a twin of the row that may turn out to be it.

**Records.** For every building the script writes one `record_pulls` row for the assessor resource (`triggered_by = 'seed'`) and one `building_records` row of kind `assessment` for FY2026, so the facts strip renders on day one. The other four sources stay "Not retrieved yet".

**Output.** A generated SQL file in batches of 500 statements, applied with `wrangler d1 execute --remote --file`, and a summary of matched, created, updated, skipped, and unmatched. `--dry-run` prints the summary and writes nothing.

> **Amended 2026-09-09, as built (C1):** the batch files hold **999 statements**, not 500 —
> a multiple of three, so every file holds whole buildings (row, pull, record), and under the
> 1,000 the local D1 handles (2,000-statement files hang miniflare for five minutes and then
> fail with a `Body Timeout Error`, rolling the whole file back). The script has four modes,
> not two: `--dry-run` (the default — compute and print the summary, write nothing),
> `--write` (also write the batch files under `.cache/seed/`), `--apply --local`, and
> `--apply --remote`. `--refresh` re-downloads instead of reusing the day-old cache in
> `.cache/`. `--from N` resumes an apply at batch file N and applies the files **already on
> disk**, regenerating nothing: the cache expires after a day, so a re-download that gains or
> loses one parcel would shift every later building across a file boundary and silently skip
> some. A bare `--from` with no number is an error. Two things the script has to work around:
> `wrangler d1 execute --json` renders a SQL `NULL` as the JSON *string* `"null"`, which the
> script folds back to `null` when it reads existing rows, and both bulk downloads pass
> `sort: '_id'` so CKAN pages in a deterministic order rather than whatever the datastore
> happens to return.

## Section 2: Schema (migration `0031_boston_coverage.sql`)

Additive only. Applied by hand like 0029; `ALTER TABLE ... ADD COLUMN` has no `IF NOT EXISTS`, so it is run once and recorded in `migrations/AGENTS.md`.

**`buildings` gains**

| Column | Purpose |
|---|---|
| `source TEXT NOT NULL DEFAULT 'user' CHECK (source IN ('user','seed'))` | which pipeline created the row |
| `street_key TEXT` | normalized street name plus suffix, e.g. `LANARK RD` |
| `st_num_lo INTEGER`, `st_num_hi INTEGER` | house-number range (equal for a single number) |

Indexes: `idx_buildings_parcel (parcel_id)`, `idx_buildings_street (city, street_key)`.

**`records_queue`, new**

| Column | Meaning |
|---|---|
| `id INTEGER PRIMARY KEY` | |
| `building_id TEXT NOT NULL REFERENCES buildings(id) ON DELETE CASCADE` | unique among pending rows (partial unique index on `building_id WHERE done_at IS NULL`) |
| `reason TEXT NOT NULL CHECK (reason IN ('button','follower','refresh','fill'))` | |
| `priority INTEGER NOT NULL` | 0 button and follower, 1 refresh, 2 fill |
| `requested_at INTEGER NOT NULL DEFAULT (unixepoch())` | |
| `locked_at INTEGER` | set when a Worker run claims the row; a lock older than 600 seconds is abandoned |
| `attempts INTEGER NOT NULL DEFAULT 0`, `last_error TEXT` | three attempts, then parked |
| `done_at INTEGER` | set on success. Finished `button` rows are kept indefinitely: they are the record that a reader asked, which the refresh planner reads as interest. Finished `refresh` and `fill` rows are purged after 90 days by the daily planner |

Index: `idx_records_queue_pending (priority, requested_at) WHERE done_at IS NULL`.

**`app_settings`, new.** `key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at INTEGER`. First key: `records_fill_paused` (`'1'`/`'0'`).

> **Amended 2026-09-09, as built (C1):** `record_pulls.triggered_by` is a foreign key to
> `users` (0029), so it cannot carry `'seed'` or `'queue:<reason>'`. Migration 0031 adds a
> nullable `record_pulls.trigger_reason TEXT` for that; `triggered_by` stays the admin
> user id or NULL. Seed pulls write `trigger_reason = 'seed'`; the Worker (C2) writes
> `'queue:<reason>'`.
>
> Three further details settled while building 0031:
>
> - `records_queue.id` is `INTEGER PRIMARY KEY AUTOINCREMENT`, not a bare `INTEGER PRIMARY
>   KEY`, so a queue id is never reused after a delete — queue ids appear in the admin UI
>   and in logs, and a reused one would silently re-point an old reference.
> - `app_settings.updated_at` is `INTEGER NOT NULL DEFAULT (unixepoch())`. SQLite has no
>   `ON UPDATE`, so it stamps on insert and does not maintain itself; a writer that flips a
>   value must set it explicitly.
> - Statement order in the file is deliberate: the idempotent `CREATE TABLE IF NOT EXISTS`
>   and `CREATE INDEX IF NOT EXISTS` statements come first and the five non-idempotent
>   `ALTER TABLE ... ADD COLUMN` statements last, so a partial apply is recovered by
>   re-running only the `ALTER`s that did not land.

`building_records` and `record_pulls` are unchanged. Every queued pull writes the same provenance rows as the admin button, with `triggered_by = 'queue:<reason>'`, so the panel, the correction flow, and the "as of" labels need no branch for seeded buildings. "Last pulled" and "interesting" are queries over existing tables, not columns.

Not added on purpose: a per-building view counter (no analytics, by policy) and per-building refresh intervals.

## Section 3: The companion Worker

**Location.** `workers/records-scheduler/` with its own `wrangler.jsonc` (D1 binding to the same database id, `RESEND_API_KEY` secret, `SITE_URL` var) and an entry file that imports `pullBuildingRecords` from `src/lib/records/pull.ts` and the queue module from `src/lib/records/queue.ts`. Deployed with `wrangler deploy` from that folder. The Pages site does not change.

**Cron every minute: drain.** Claim up to `PRIORITY_PER_RUN = 3` rows with priority 0 or 1 and up to `FILL_PER_RUN = 1` row with priority 2, ordered by priority then `requested_at`, by setting `locked_at` in one conditional update per row. For each, run `pullBuildingRecords(db, building, { triggeredBy: 'queue:<reason>' })` with the existing per-source timeouts. On return, set `done_at`. If the pull throws, increment `attempts`, record `last_error`, clear `locked_at`; at three attempts the row stays pending-but-parked (`attempts >= 3` excluded from claiming) and is listed in admin. Per-source failures are handled inside the pull as today (error row, prior rows kept) and count toward the error rate below.

**Cron daily at 06:00 UTC: plan.**
1. Enqueue `refresh` for every building that has an approved review, a `saved_buildings` row, or a finished `button` queue row, whose latest `record_pulls.retrieved_at` for any deeper source is older than 30 days and which has no pending row.
2. Top the fill up to 2,000 pending `fill` rows from `source = 'seed'` buildings with no deeper pull row ever, ordered by neighborhood, street key, and number, so a neighborhood completes together.
3. Run the fixture check (the same checks as `npm run records:check`) and compute the per-source error rate over the last 24 hours of `record_pulls`.

**Circuit breaker.** If the fixture fails or any source's 24-hour error rate exceeds 50 percent with at least 20 attempts, set `records_fill_paused = '1'`, skip fill rows in drain while it is set (priority 0 and 1 still run), and send one email to the admin address via the existing `email.ts` helper with the failing source and the rate. The flag is cleared only from admin.

**Local run.** `npm run records:worker -- --once` executes one drain against the local D1 for development; the unit tests cover the queue module without the Worker runtime.

**Plan check.** Cron Triggers exist on the free Workers plan, but its CPU limit is tight for parsing 20 responses per building. The owner confirms in the Cloudflare dashboard (Workers & Pages → Plans) before chunk C2 starts; if the account is on the free plan, the $5 Workers Paid plan is required.

> **Amended 2026-09-09, as built (C2):** the Worker is a wiring file over
> `src/lib/records/scheduler.ts`, which is where every decision above actually lives, as pure
> functions over an injected `SchedulerDeps` bag (db, clock, pull, fixture, alert, log). That
> is what makes `drain` and `plan` testable against the `node:sqlite` D1 double. The Worker
> imports `drain`, `plan` and `liveDeps` and does nothing else.
>
> **Workers Paid is confirmed** (5 min CPU, 1,000 subrequests per invocation — not 10,000,
> which an earlier draft of this block and the C2 plan both got wrong), so the plan caveat
> above is closed. A full drain tick is four pulls at about 27 requests each, roughly 110
> subrequests, so the real limit is comfortable but not the order of magnitude assumed.
>
> **Per-pull numbers, measured against the built sources.** A seeded building's pull is about
> **27 requests** to data.boston.gov — 17 of them 311 (sixteen yearly files plus the
> new-system resource), one per assessor year, one each for permits, violations, code
> enforcement and RentSmart, and **none** for parcel resolution, because a seeded row already
> carries its parcel — and it writes **11 `record_pulls` rows**, one per source. At full rate
> that is about 110 requests a minute and about 15,800 pull rows a day from the fill. This
> supersedes the "about 20 requests and about 30 stored rows" estimate in Section 1.
>
> Details that differ from the text above:
>
> - **`attempts` counts CLAIMS, not caught failures.** `claimBatch` increments it in the same
>   conditional `UPDATE` that takes the lease; `completeRow` resets it to 0; `failRow` records
>   `last_error` and **keeps** the lock rather than clearing it. Holding the lease *is* the
>   backoff, and it is free: a building that fails every time spends its three attempts over
>   an hour and a half instead of inside one drain. Counting claims is what stops a row whose
>   pull kills the runner outright — an OOM, a CPU-limit kill, anything that never reaches a
>   catch — from being claimed forever by the one process that cannot report the failure.
> - **`LOCK_TTL_SECONDS = 1800`, not 600.** A single pull is about 27 requests, so its worst
>   case at the 10 s per-source timeout is 270 s and 600 s was too close to the work it
>   covers. Half an hour is the delay before a genuinely dead run's row is retried; nothing is
>   gained by cutting it fine.
> - **`drain` claims one row at a time, immediately before pulling it**, re-reading the clock
>   per claim, rather than claiming the tick's three-plus-one up front. Claiming a batch would
>   date every lease from the start of the run and spend an attempt on rows that never got
>   pulled.
> - **`drain` has a wall-clock budget, `DRAIN_BUDGET_MS = 45_000`**, checked before every claim
>   (never after — a claim spends an attempt) and reported as `budgetHit` in `DrainResult`.
>   The cron fires every minute whether or not the previous tick finished, so without it a
>   slow upstream does not throttle the system, it compounds: a three-minute tick is overlapped
>   by two more, each claiming its own rows and opening its own connections to the city.
> - **`enqueue` will not replace a pending row whose lease is live.** A higher-priority request
>   normally deletes and re-inserts the pending row, but a leased row is being pulled right now
>   and that pull is already doing the requester's work; deleting it would orphan a run in
>   flight, whose `completeRow` would then mark nothing. It answers `already_queued` instead,
>   using claimBatch's liveness test, boundary included.
> - **The pull is `pullBuildingRecords(db, building, { triggeredBy: null, triggerReason: 'queue:<reason>' })`.**
>   `triggered_by` is a `users(id)` foreign key and stays NULL; the reason goes in
>   `record_pulls.trigger_reason`, whose values are `admin`, `correction`, `seed`,
>   `queue:button`, `queue:follower`, `queue:refresh`, `queue:fill`.
> - **`plan` runs purge first**, then refresh, then the fill top-up, then the fixture, then the
>   error rates, then the breaker — so a trip is judged on the day's pulls and stops the fill
>   before the next drain. The fill top-up inserts in batches of `FILL_INSERT_BATCH = 100` via
>   `db.batch`, each statement an `ON CONFLICT ... DO NOTHING` against 0031's partial unique
>   index, and counts the inserts that actually landed rather than the rows it planned.
> - **The fixture runs all eleven Boston sources concurrently**, applying results in source
>   order afterwards so two runs compare label for label; a source that throws is caught inside
>   its own task. Run in sequence, a data.boston.gov outage would cost eleven consecutive 10 s
>   timeouts before the breaker could say so. The Worker gives the fixture's one direct SAM
>   request a 15 s budget; every other request keeps `ckanSql`'s own 10 s timeout.
> - **The fixture result is stored** as JSON in `app_settings.records_fixture_last` every day,
>   pass or fail, and the admin panel renders it. The breaker also stamps
>   `records_breaker_last_alert`.
> - **The breaker counts the six assessor years** in the per-source error rates, even though
>   the fill's notion of "covered" excludes them: parcel resolution runs through the assessor,
>   so an assessor outage fails every other source for the same building, and a breaker blind
>   to it would watch five sources fail without naming the one thing that broke them.
> - **Two secrets, not one.** `RESEND_API_KEY` and `RECORDS_ALERT_EMAIL` — the alert address is
>   a secret rather than a `vars` entry so a personal address is not committed to git. An unset
>   address logs `records_breaker_email_skipped` at error level; the pause still holds.
> - **No `waitUntil`.** `scheduled()` awaits `drain`/`plan` directly, logs one structured line,
>   and rethrows on failure: a red row in the Cron Events tab is the only alarm an unattended
>   cron gets. `observability` is enabled so those lines are queryable after the fact.
> - **Local run** is `npm run records:worker` (`wrangler dev --test-scheduled`) plus a curl to
>   `/__scheduled?cron=...`, not `-- --once`; deploy is `npm run records:worker:deploy` from the
>   repo root with `--config`, not `wrangler deploy` from the Worker folder. **Stop the site dev
>   server first** — both open the same local D1 file and two writers give you `SQLITE_BUSY`.
> - **Admin API, three routes** under `src/pages/api/admin/records/queue/`:
>   `GET /api/admin/records/queue` returns `{ data: { stats, parked, lastFixture } }`,
>   `POST .../pause` takes `{ paused: boolean }`, `POST .../retry` takes `{ id: number }`. Both
>   POSTs answer 415 on a non-JSON content type, per the CSRF rules in root `AGENTS.md`. **None
>   of the three writes an audit row** — pausing and retrying are non-destructive operational
>   switches, not admin actions on someone's data, and the flag's own `updated_at` records when
>   it last moved. The shared `_json.ts` helper sits in that directory because Astro excludes
>   `_`-prefixed files from routing.
> - **Retry answers 409 when the lease is still live.** A row crosses three attempts at the
>   moment of its last *claim*, so it appears parked while its pull may still be running;
>   clearing the lease then would start a second concurrent pull of the same building. 404
>   covers "no such row" and "already finished".
> - **Operating it** is [`docs/runbooks/records-scheduler.md`](../../runbooks/records-scheduler.md).
> - **Not in C2:** the follower enqueue, the public button endpoint, and unpausing. All three
>   are C3, after the site release.

## Section 4: Public page and button

**Seeded page with no reviews.** Same building page. The score block becomes a card: "No reviews yet. Lived here? Rate this place." with the existing write-a-review button. The rating sidebar reads "Rating breakdown appears after the first review." The records panel renders where it does today; the facts strip is the first substantial thing on the page.

**Button.** When no deeper source has ever been pulled, a "Get this building's city records" button renders above the ledger; the four rows read "Not retrieved yet". Pressing it renders Turnstile on demand (the correction form's pattern) and posts to `POST /api/records/request` with `{ buildingId, turnstileToken }`.

Endpoint guards, in order: JSON content type; `checkRateLimit(db, ip, 'records_request', 3, 3600)` fail-closed; site-wide cap of 300 `button` rows created in the last 24 hours; Turnstile verification; building exists, `city = 'Boston'`, `parcel_id` not null; no deeper `record_pulls` row exists. Then insert one `button` row (or return the pending row if one exists). Response 202 `{ status: 'queued' | 'already_queued' }`. Errors, in guard order: 400 (content type), 429 (per-IP limit), 429 (daily cap, with a distinct message), 403 (Turnstile), 404 (building), 409 (already pulled), all in the existing error envelope.

**Page states,** read server-side from the queue and provenance tables:

| State | Shown |
|---|---|
| never pulled, nothing queued | button |
| pending `button` or `follower` row | "Records requested. They usually appear within a few minutes; reload to check." No button |
| pending `fill` row only | "Queued for the city-wide pass." Button still offered; a press deletes the pending `fill` row and then inserts the `button` row, in one batch, so the pending-row uniqueness index is never violated |
| any deeper pull exists | normal ledger; no button ever again |

**Followers.** Inserting a `saved_buildings` row enqueues a `follower` row when the building has no deeper pull and no pending row.

**Copy** for the card, button, and status lines lives in `display.ts` and joins `PANEL_COPY`, so the banned-words scan covers it.

## Section 5: Search and reviewer flow

**Search.** Remove `HAVING COUNT(r.id) > 0` from the search page and `/api/search/results`; the parity test keeps them aligned. Order: buildings with approved reviews first in today's order, then the rest by address. Seeded results show "No reviews yet · city records" in the score position. Before matching, the query is normalized by a new `normalizeSearchQuery` in `src/lib/`: punctuation stripped and common suffix abbreviations expanded from the identity suffix table, so "1027 comm ave" matches "1027 Commonwealth Avenue". A leading-wildcard `LIKE` over 38,000 rows is milliseconds in SQLite; no new index for search.

**Reviewer dedupe.** In `POST /api/buildings`, before creating a row for an unknown Google place: derive `street_key`, `st_num_lo`, `st_num_hi` from the chosen address with the identity normalizer (a new exported `addressKey(address)`), then

```sql
SELECT id, slug FROM buildings
WHERE city = 'Boston' AND street_key = ? AND st_num_lo <= ? AND st_num_hi >= ?
ORDER BY (source = 'user') DESC, created_at LIMIT 1
```

On a match: set `google_place_id`, and `latitude`/`longitude` if null, and return the existing slug. On no match: create a `user` row as today, now also populating the three key columns. Addresses outside Boston keep today's behavior exactly.

**Range addresses.** A parcel addressed "23-27 Lanark Road" is one page; a reviewer choosing "25 Lanark Rd" lands on it. The page title keeps the assessor's range.

> **Amended 2026-09-09, as built (C1):** `normalizeSearchQuery` returns `string[][]`, not
> `string[]`: one array of alternative spellings per term. Expanding an abbreviation to a
> single long spelling would have lost the buildings stored with the short one, so the search
> ORs the spellings inside a term and ANDs across terms — "comm ave" matches an address
> stored either way, and still requires both terms.
>
> Two things the C3 dedupe has to do that this section did not call out. Manual-entry
> addresses (and Google Places results) carry a trailing city/state token — "23-27 Lanark Rd,
> Boston, MA" — which must be stripped before `addressKey` runs, or the street key comes out
> wrong. And the dedupe query needs the same ZIP tiebreaker `seed/match.ts` uses: street keys
> repeat across neighborhoods, so `(city, street_key)` plus range containment can return two
> genuinely different buildings.

## Section 6: Sitemap, metadata, docs

**Sitemap.** `/sitemap.xml` is an index pointing at `/sitemaps/static.xml` and `/sitemaps/buildings-<n>.xml` in chunks of 10,000, generated from D1 and served with `Cache-Control: public, max-age=3600`. Included: allowlisted static pages; every building with `city = 'Boston'` and `parcel_id` not null; any other building or landlord page with at least one approved review. Excluded: auth, profile, admin, review forms. `lastmod` is the latest of the building's `updated_at`, its most recent `record_pulls.retrieved_at`, and its most recent approved review. `/robots.txt` allows crawling and names the index. Structured data remains a v1.6 item.

**Metadata for seeded pages.** Title "23-27 Lanark Road, Boston | RateMyPlace"; description "City of Boston records for 23-27 Lanark Road: assessment, permits, violations, code enforcement, and 311 requests. No tenant reviews yet." Review-based metadata takes over once a review exists. No noindex.

**Docs and policy text in the same release:**
- `ops/growth/STRATEGY.md`: dated decision-log entry lifting the reader-first deferral for Boston.
- `.planning/milestones/v1.6.0-ROADMAP.md`: retire the "neighborhood content farms" deferral with a pointer here.
- `/methodology`, under "Public records are not scored": the refresh rule. Buildings with a review, a follower, or a reader request refresh monthly; every other Boston building is pulled once in the city-wide pass and refreshed yearly; every value shows its own "as of" date.
- `/privacy`: pressing the records button stores the building and the time, not who pressed it; the IP rate limit is the existing one.
- `MASTER.md`; root `AGENTS.md` traps (second deployable, fill pause flag, never re-pull on demand); `migrations/AGENTS.md` (0031 by hand); `src/lib/AGENTS.md` (queue module).

**Rollout order.** Migration 0031 → Worker deployed with `records_fill_paused = '1'` → seed script (dry run, then real) → site release (search, button, sitemap, page states, dedupe, docs) → clear the pause flag → watch the first day's error rate and queue depth in admin.

## Section 7: Testing, failure modes, split

**Unit tests** on the existing in-memory D1 double:
- Seed: land-use and description filter; multi-building collapse; address, slug, key, and range derivation; matching existing rows; idempotent re-run.
- Queue: claim order; lock expiry; parking after three attempts; planner selectors (refresh set, fill top-up order); breaker thresholds in both directions.
- Endpoint: each guard in order, 202 bodies, idempotent re-request, `fill` row replaced by `button`.
- Search: reviewed-first ordering; query normalization; page and endpoint parity.
- Dedupe: exact, range containment, no match, place id and coordinates written on match, non-Boston untouched.
- Sitemap: chunking, `lastmod` selection, exclusions.
- Panel: the four page states; `PANEL_COPY` scan covers the new copy.

**Live checks:** seed `--dry-run`; Worker `--once` locally; `npm run records:check` extended with the SAM resource.

> **Amended 2026-09-09, as built (C2):** the queue line above landed as six test files, all
> named `records*` so `npx vitest run records` finds them:
>
> - `recordsQueue.test.ts` — enqueue and priority replacement, claim order, lease expiry,
>   claims counting attempts, parking at three, `failRow` keeping the lock.
> - `recordsQueuePlanner.test.ts` — the refresh interest set, fill top-up order and target,
>   purge retention, error-rate windows, queue stats, and that migration `0032`'s three
>   indexes exist. An `EXPLAIN QUERY PLAN` assertion over the statements the module actually
>   prepares pins which of them SQLite uses: the breaker's window is a covering seek on
>   `idx_record_pulls_retrieved`, and the interest set's saved-buildings union is a covering
>   scan of `idx_saved_buildings_building`. **`idx_records_queue_building` is not used by
>   either planner** — both pending-row lookups prefer 0031's narrower partial index, and the
>   finished-button leg of the interest set filters on `reason` and `done_at`, neither of
>   which a building_id index carries, so it scans. 0032's own comment claims otherwise and is
>   wrong; making that leg indexed is a migration, not a comment, and is not done here.
> - `recordsScheduler.test.ts` — `drain` and `plan` against injected deps: the one-at-a-time
>   claim, the paused fill, breaker thresholds in both directions, the single alert, the
>   stored fixture result.
> - `recordsQueueAdminRoutes.test.ts` — each guard in order on all three routes, the 415 and
>   400 bodies, the pause round trip, the retry 409 on a live lease, and the two 404s (unknown
>   id, finished row).
> - `recordsQueuePanel.test.tsx` — the panel's states, the pause toggle, the disabled Retry
>   button on a live lease.
> - `recordsFixture.test.ts` — `runLanarkFixture` as a library: every check recorded, a source
>   that throws becoming a `sourceErrors` entry rather than an exception.
>
> `recordsPull.test.ts` gained the `trigger_reason` cases, and the test-db helper gained stub
> `reviews` and `saved_buildings` tables plus `0032`. The live check is `npm run records:worker`
> against the local D1 with the two `__scheduled` curls, not `-- --once`.

**Failure modes:** city API down → error rows, prior rows kept, fill paused, one email. Worker broken → queue grows, site unaffected, admin shows depth. Seed interrupted → re-run. Duplicate page slips through → the dedupe tests and the seed's unmatched list are the nets; an admin merge tool is out of scope.

**Split.** Three chunks, each its own plan and PR, in order:
- **C1:** migration 0031, `addressKey` and search normalizer helpers, seed script with dry run, existing-row matching, `records:check` extension.
- **C2:** queue module, Worker, planner, breaker, admin queue panel, deployed paused, Workers plan confirmed.
- **C3:** page states and button endpoint, follower enqueue, search changes, reviewer dedupe, sitemap and robots, metadata, docs and strategy, unpause.

## Out of scope

Condo buildings (CM), single-family, cities other than Boston, an admin merge tool for duplicate buildings, structured data, plotting seeded buildings on the map, sub-projects B and D.
