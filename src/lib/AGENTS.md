# `src/lib/` — Business Logic

Everything in here is shared logic consumed by pages, API routes, and components.
Components must not contain business logic; it belongs here.

Rules: one concern per file, always export the interfaces consumers need, no `any` types.

---

## Scoring is load-bearing — read this before touching it

Scoring changes are **retroactive, and they land unevenly** — which is worse than uniform.

Migration 0025 dropped the `*_scores` cache tables, but `reviews.overall_score` is still a
stored per-review column, written at submission and on edit. Two paths read differently:

- **Domain sub-scores and review cards** recompute from the individual answers, so they
  adopt new weights immediately.
- **Aggregate overall scores** consume the stored `overall_score` (see the comment at
  `scoring.ts` — "the single source of truth"), so the SQL and JS paths agree with each other.

So changing a weight makes cards and aggregates **diverge**, and makes old reviews disagree
with new ones, until you backfill `overall_score`. Backfilling then genuinely rewrites
public historical scores. Either way it needs explicit sign-off — never as a side effect.

Never adjust scoring as a side effect of another change. It needs explicit sign-off.

### `scoring.ts`

- `UNIT_FIELDS` (10), `BUILDING_FIELDS` (9), `LANDLORD_FIELDS` (8) — the 27 scored items.
- `ITEM_WEIGHTS` — health/safety multipliers, each justified with a citation in the file.
  1.5× pests and mold · 1.3× structural and climate · 1.2× plumbing and security ·
  1.0× everything else.
- `RECENCY_BANDS` — age decay for aggregates. 1.0 for 0–2y, 0.95 at 3y, 0.90 at 4y,
  floor 0.85 beyond.
- Aggregation is a weighted arithmetic mean. Unrated reviews return `null`, **not 0.0** —
  returning 0 poisons aggregates, which was a real bug fixed in the August 2026 sweep.

### `RECENCY_BANDS` has two consumers and must not fork

`scoring-sql.ts` generates the SQL `CASE` expression from the same `RECENCY_BANDS` array
that the JS path uses, so list views and detail views cannot drift. There is a parity test
(`__tests__/scoring-sql-parity.test.ts`) that fails if they do.

If you change recency behavior, change the array — never hand-edit the generated SQL or
add a second copy of the bands.

### `scoring-colors.ts` is the only home for score bands

Four bands: Good 4.0–5.0, Mixed 3.0–3.9, Concerning 2.0–2.9, Poor 1.0–1.9.

Use the helpers — never hardcode a threshold or a color:

- `getScoreColor(score)` → `{ bg, text, label }` for filled badges and pills
- `getScoreTextColor(score)` → Tailwind class for a colored score number
- `getScoreBgTint(score)` → soft-tinted background for score detail tiles
- `getScoreHex(score)` / `SCORE_HEX` → hex for non-Tailwind contexts (Maps markers, OG images)

### `surveyItems.ts` is the canonical survey definition

32 items: 27 scored + 5 ancillary (`would_recommend`, `tenure_months`, `move_out_year`,
`accepts_housing_vouchers`, `safely_lit_at_night`). The ancillary five are **not scored**.

The docs describe the instrument; this file *is* the instrument. Where they disagree, this
file wins.

### Adding a survey item — all five steps or none

1. Add the column in a new migration (`migrations/XXXX_name.sql`)
2. Add the item to `surveyItems.ts` with help text (including what a 3 looks like)
3. Add the field to the right domain array in `scoring.ts`
4. Set its weight in `ITEM_WEIGHTS`
5. Update `components/reviews/ReviewForm.tsx` and `components/reviews/ReviewCard.astro`

Then update `src/pages/methodology.astro` — the published methodology must match the code.

---

## Other critical modules

### `runtime.ts` — the only way to reach the Cloudflare runtime

```typescript
import { getEnv, fireAndForget } from './runtime';

const apiKey = getEnv(context).RESEND_API_KEY;
```

`getEnv(context: APIContext)` throws a clear error outside Wrangler. **Never write
`(context.locals as any).runtime`** — v1.5.0 removed 89 such casts across the codebase.

`fireAndForget(context, promise)` registers work with `ctx.waitUntil` so the Worker isolate
stays alive after the response is sent, and swallows rejections into structured logs. An
unhandled rejection inside `waitUntil` crashes the isolate in production, so the internal
`.catch` is not optional. It returns `void` specifically so callers cannot `await` it.

Use it for every outbound email.

### `privacy.ts` — fuzzing is a safety control

`formatRecency()` and the season/year formatters exist so exact tenancy dates never reach
a public surface. Do not add a display path that bypasses them, and do not "improve"
precision here — the imprecision is the point.

### `validation.ts` — use the shared primitives

`isValidEmail`, `isSafeHttpUrl`, `validateReviewText`, `enforceMaxLength`,
`escapeLikePattern`, `sanitizeText`, plus per-form validators (`validateReviewForm`,
`validateDisputeForm`, `validateBugReport`, `validateContactForm`, `validateSearch`).

`isSafeHttpUrl` exists because a `javascript:` URL in a bug report could take over an admin
session — that was a real finding. Any user-supplied URL that will be rendered as a link
must pass through it.

Known drift to fix if you are nearby: `disputes.ts` exports a duplicate
`validateDisputeForm` consumed only by its own test (production imports the one here).

### `audit.ts` — every destructive admin action

```typescript
import { createAuditLog } from '../../lib/audit';

await createAuditLog(db, {
  adminUserId: context.locals.user.id,
  actionType: 'review_approved',
  entityType: 'review',
  entityId: reviewId,
  oldValue: { status: 'pending' },
  newValue: { status: 'approved' },
});
```

Best-effort by design — a logging failure must never break the action it is logging.
Admin grant/revoke went untracked until August 2026; do not let a new destructive action
ship without a log entry.

### `records/` — public building records

The read-only public-records panel: what the city says about a building, never what we
think of it. Sources live in `records/sources/boston/`, one module per dataset.

- **The CKAN SQL exception.** Boston's `datastore_search_sql` endpoint has no parameter
  binding, so this directory is the repo's one documented exception to "parameterized
  queries always". Every source file opens with the invariant that keeps it safe: every
  interpolated value goes through `sqlLiteral` / `addressLikeClauses` or a digits-only
  guard, and every identifier is a code constant. Do not add a query that interpolates
  anything else. (`textOrNull` normalizes response cells; it plays no part in query
  construction and is not an escaping step.)
- **`npm run records:check`** hits the live datasets and reports which resource ids and
  columns still exist. Boston retires 311 resource ids without notice, and a retired id
  fails that whole source on every pull until someone updates `LEGACY_311_RESOURCES` —
  it does not heal on its own. Run it before trusting a source failure.
- **`fixture.ts` runs inside a Worker**, not just under that script: the scheduler's daily
  circuit breaker calls `runLanarkFixture`, which pulls in `seed/sam.ts` for the SAM check.
  Both files — and anything either imports — must stay runtime-agnostic: no `node:` imports,
  no `fs`/`path`/`process`, nothing that only exists under tsx. The rest of `seed/` is
  script-only and has no such constraint. The fixture runs all eleven Boston sources
  concurrently and applies the results in source order afterwards, so two runs compare label
  for label; it never throws, because the breaker needs a result, not an exception.
- **`queue.ts` is the pull queue, and `attempts` counts CLAIMS, not failures.** One pending
  row per building (0031's partial unique index). `claimBatch` takes a lease by conditional
  `UPDATE`, incrementing `attempts` as it goes; `completeRow` resets it to 0; `failRow`
  records `last_error` and deliberately **keeps** the lock, because holding the lease *is*
  the backoff — the row is unclaimable until `LOCK_TTL_SECONDS` (1800) expires. A row parks
  for a human at three claims. Counting claims rather than failures is what stops a building
  whose pull kills the runner outright — an OOM, a CPU-limit kill — from being claimed
  forever by the one process that cannot report it. The admin retry endpoint refuses a row
  whose lease is still live with a 409 rather than starting a second concurrent pull, and
  `enqueue` refuses to replace one for the same reason: a leased row is being pulled right
  now, and that pull writes exactly the records the higher-priority request is asking for, so
  the answer is `already_queued`. Replacing it would delete the row out from under the run
  holding it. The **three site callers of `enqueue`** are the reader button, the follower
  enqueue on save, and review approval; the last two both pass `reason: 'follower'`, because a
  fourth `QueueReason` would need a migration for `records_queue`'s CHECK constraint and would
  sit at the same priority anyway.
- **`scheduler.ts` is pure functions over injected dependencies.** `SchedulerDeps` carries
  the db, clock, pull, fixture, alert, and log, so `drain` and `plan` are unit-tested against
  the `node:sqlite` D1 double and `workers/records-scheduler/` stays a wiring file. `drain`
  claims **one row at a time immediately before pulling it**, so a lease covers a request
  genuinely in flight, and it stops claiming once `DRAIN_BUDGET_MS` (45 s) of wall clock is
  gone, reporting `budgetHit` — the cron fires every minute whether or not the previous tick
  finished, so without the ceiling a slow city stacks overlapping drains instead of
  throttling them. The budget reads `deps.clockMs` (milliseconds, injectable, defaults to
  `Date.now`); `deps.now` stays seconds and stays the clock for stored timestamps. The
  circuit breaker lives at the end of `plan`, not in the Worker: it
  trips on any fixture failure or on a source with at least 20 attempts and over 50% errors
  in 24 hours (the assessor years are counted on purpose — parcel resolution runs through
  the assessor, so its outage fails every other source), pauses the fill, and emails once.
  It never unpauses.
- **`settings.ts` owns three `app_settings` keys** — `records_fill_paused`,
  `records_breaker_last_alert`, `records_fixture_last` — and is a leaf module that imports
  only `./types`, so an admin route can read a flag without dragging the whole pull stack
  into the request path. Import `SETTING_KEYS`; do not retype a key string.
- **`errors.ts` is the one place a failure becomes a stored string.** `record_pulls.error_message`
  and `records_queue.last_error` are provenance, not a log, and they must read the same;
  `truncateError` caps both at 500 characters and will not leave half a surrogate pair behind.
- **`trigger_reason` on `record_pulls`** says what caused a pull: `admin`, `correction`,
  `seed`, or `queue:button` / `queue:follower` / `queue:refresh` / `queue:fill`. It is a
  plain column, not a user reference — `triggered_by` is a `users(id)` foreign key and stays
  NULL for everything the Worker does.
- **`identity.ts`** turns a `buildings` row into every address form worth querying
  (short and long, range and split, directional stripped) plus both parcel forms. The
  feeds disagree about how an address is stored; normalization lives here, not in the
  sources.
- **`seed/` is the bulk pipeline, not a request path.** `scripts/records-seed-boston.ts`
  downloads the assessor and SAM resources once (`fetchAllRows` in `ckan.ts`), and the pure
  modules under `records/seed/` filter, collapse, format, match, and emit SQL. Every string
  in the emitted SQL goes through `lit()`; the file is applied with
  `wrangler d1 execute --file`, which binds nothing. Seeded rows have `source = 'seed'` and
  deterministic ids (`seed-<parcel>`), so re-running is an upsert.
- **`addressKey` / `streetKey` in `identity.ts`** are the lookup keys for seed matching and
  reviewer dedupe: base street name plus the assessor spelling of the suffix, and a
  house-number range. A change to the suffix table changes both, on purpose. Both return
  null for a degenerate street — a bare suffix like `Ave`, or an empty one — rather than a
  key that silently collides. That rule is `isDegenerateStreet`, defined once in
  `identity.ts` and called from four places (`buildIdentity`, `streetKey`, `addressKey`, and
  `seed/format.ts`); change the rule there, not at a call site.
- **Matching is parcel id first, then address.** `seed/match.ts` trusts an existing row's own
  `parcel_id` outright, and only falls back to street key plus number-range containment. It
  breaks a two-parcel tie with the ZIP, because street keys repeat across neighborhoods
  (`Washington St` runs through most of them). A tie the ZIP cannot break, a partial range
  overlap, or a disagreeing parcel id is reported for a human, never guessed — and every
  parcel named by one of those is held back from creation so a reviewed parcel is not seeded
  as a twin in the meantime.
- **`zip5` in `seed/sam.ts` is the one ZIP normalizer.** Both SAM and the assessor hand back
  ZIPs that lost a leading zero to a numeric column, and SAM sometimes adds a +4. Import it;
  do not write a second `padStart(5, '0')` anywhere.
- **`searchQuery.ts` returns alternatives per term, not one string per term.**
  `normalizeSearchQuery` gives back `string[][]`: the search ORs the spellings inside a term
  and ANDs across terms, so "comm ave" matches both `Avenue` and `Ave` in stored addresses
  without matching a building that has neither. Consumed by `searchSql.ts`.
- **`coverage.ts` is the page-state table, read-only.** `recordsRequestState` answers
  `ineligible` / `pulled` / `fill_queued` / `parked` / `requested` / `never_pulled` in that
  precedence, in **one** statement (indexed `building_id` seeks as correlated subqueries),
  because the public endpoint calls it once per request; `hasDeeperPull` and
  `pendingQueueReason` stay exported for callers that need one answer without the other.
  **Three callers enqueue off this state:** the reader button (`request.ts`), which enqueues
  from every state but `ineligible` and `pulled`, and the follower enqueue on save and on
  review approval (`PATCH /api/admin/reviews/[id]`, a `follower` row), both only from
  `never_pulled`.
  Eligibility is `jurisdictionForCity` from the leaf `records/jurisdiction.ts`, not a string
  compare on 'Boston'. A **parked `fill` row
  still reads `fill_queued`**, so the button stays offered: a press replaces it with a fresh
  priority-0 row that gets its own attempts. `DEEPER_SOURCE_IDS` lives here and
  `scheduler.ts` re-exports it — do not move it back.
- **`parked` exists because a row at `MAX_ATTEMPTS` is still `done_at IS NULL`.** Without it
  the panel reads such a row as `requested` and tells the reader to reload a page that will
  not change until a human looks, so it is resolved **before** the `requested` branch — but
  **after** `fill_queued`, because a press really does replace an exhausted `fill` row. It is a
  page state, not a refusal: `POST /api/records/request` lets it fall through to `enqueue`
  exactly as `requested` does, which answers `already_queued` against a parked button or
  follower row.
- **`request.ts` holds the button's limits, not the route.** Three presses an hour per IP
  (`REQUEST_PER_IP`) and 300 button rows a day site-wide (`REQUEST_DAILY_CAP`) over a
  **rolling** 24 hours, counted from `records_queue` because button rows are never purged.
  `Retry-After` on the cap branch is computed from the oldest counted row, so the number it
  gives is the real wait rather than a fixed guess. The numbers live here so the route, its
  tests, and the privacy-page copy cannot fork.
- **`dedupe.ts` refuses rather than guesses — and the tier order is the route's, not the
  module's.** `POST /api/buildings` runs three tiers: an exact Google **place id**, then
  `findBuildingByAddress`, then an exact case-insensitive **(address, city)** for a manual
  entry with no place id. Only the middle tier is in `dedupe.ts`, and inside it the order is
  Boston address key plus range containment under the parity rule → ZIP tiebreak → survivor
  ranking: a user row before its seeded twin, then the narrower span, then the oldest.
  `findBuildingByAddress` itself returns **null** (the route creates a page) whenever it
  cannot decide: no candidate, several candidates spanning different ZIPs with no input ZIP,
  or a lone candidate whose ZIP disagrees with the input. The candidate span bound (100
  numbers) applies to user-entered rows **only** — six real seeded parcels are wider, up to 628 at
  `10-638 Georgetowne Dr`, and the assessor's range *is* the parcel.
- **`stripTrailingLocality` is called by `addressKey` and `buildIdentity`, not
  `streetKey`.** It removes a comma-less trailing "Boston" / neighborhood / "MA" / ZIP tail
  that `normalizeStreet`'s comma rule cannot see. `streetKey` takes a street it has already
  been handed, so adding the stripper there would change seed keys.
- **`display.ts` holds a privacy gate.** `showMailingAddress` publishes a tax mailing
  address only for an owner that reads as an entity, and `mailingAddressLine` holds the
  addressee to the same test — an entity can list a person as its `C/O ATT`. It errs
  toward hiding: a hidden business address costs a reader one lookup, a published home
  address cannot be taken back. `BANNED_WORDS` in the same file is scanned against the
  panel's templates by `__tests__/recordsPanelCopy.test.ts`.

### Search, page metadata, and the sitemap

- **`searchSql.ts` is the only spelling of the query-mode buildings query.**
  `buildingSearchWhere`, `buildingSearchSelect` and `BUILDING_SEARCH_ORDER` are shared by
  `src/pages/search.astro` and `src/pages/api/search/results.ts`, so the page and the
  endpoint cannot disagree about which buildings match or in what order. Query mode returns
  every Boston building, reviewed ones first; browse mode, the landlord queries and the map
  keep their `HAVING COUNT(r.id) > 0`. `__tests__/recordsSearchParity.test.ts` fails if
  either call site stops using the fragments.
- **`buildingMeta.ts` decides the records-page title.** `buildingPageMeta` swaps in the
  records-flavored title and description only when a building has zero approved reviews, a
  Boston jurisdiction (`jurisdictionForCity`) and a parcel id, and avoids a doubled
  ", Boston" when the address already carries it. Reviewed pages keep the review metadata.
- **`sitemap.ts` owns the allowlist and the chunking.** `STATIC_SITEMAP_PATHS` is the
  hand-kept list of public pages (property-manager pages are deliberately absent);
  `SITEMAP_CHUNK` is 10,000 URLs per chunk; `buildingChunkCount` has no floor of 1, so an
  empty table advertises no chunk at all. `lastmod` is the newest of the building's
  `updated_at`, its newest approved review, and its newest pull.
- **`bostonLocalities.ts` is the one Boston locality vocabulary.** `BOSTON_LOCALITY_NAMES`
  holds the 26 names in display form — every USPS city name for a Boston-only ZIP plus the
  neighborhood names people type, minus `CHESTNUT HILL`, whose 02467 also covers Newton and
  Brookline. Three consumers derive from it and none restates it: `locality.ts`
  (`BOSTON_NEIGHBORHOODS`, normalized and minus 'boston', behind the `isBostonLocality`
  predicate — Google Places routinely hands back the neighborhood as the locality),
  `records/identity.ts` (`TRAILING_LOCALITIES`, uppercased, for the trailing-locality
  stripper), and `records/dedupe.ts` (`CITY_CANDIDATES`, the bind list for its `city IN (…)`
  candidate predicate). Add a name here and nowhere else.

### `enrichment/` — municipal property data

Adapter pattern: `dispatcher.ts` routes to `adapters/boston.ts` (Boston Assessing, CKAN),
`adapters/new-haven.ts` (CT CAMA, Socrata), or `adapters/null.ts`. Adding a city means
adding an adapter, not branching the dispatcher's callers.

Enrichment is **human-in-the-loop**. Fetched data is surfaced to an admin for review and
is never auto-saved.

---

## Tests

Unit tests live in `__tests__/` alongside the modules. Run the full Vitest suite before
declaring work complete.

```bash
npm test
npm test -- scoring
```

Scoring, validation, and privacy changes need test coverage. The SQL/JS parity test is a
guardrail, not a formality; if it fails, you have forked the scoring logic.
