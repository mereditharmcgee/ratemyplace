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
- `getEarlyScoreStyle(score)` → the muted look of an early rating: `text` / `textHex` is a
  neutral gray-600 for the number (AA at any size on white, Paper and the score tints), and
  `marker` / `markerHex` is the band fill for the small dot beside it, so the band still reads

### `earlyRating.ts` is how a thin score is displayed, not computed

A building score shows from its first approved review. Below `NAMED_PARTY_MIN_REVIEWS` it is
an **early rating** everywhere a building score appears (building page, search cards,
landlord and property manager building lists, map info window, homepage dropdown): the count
sits beside the score ("from 1 review"), `scoreNumberClass` mutes it to gray with an
`earlyScoreMarkerClass` band dot beside it, and issue and recommend rates are counts ("1 of 1
review") instead of percentages. A unit row on the building page goes by the unit's own
review count, as `unitRecommendText` does. Import the constant; never type 3.

The percentages it still prints use the formulas in `calculateAggregatedScores` /
`calculateBuildingAverages`, and `earlyRating.test.ts` holds them equal. It changes no score.
A "Maybe / It depends" answer is never a no: the recommend percentage counts yes and no only
(as it always has), a maybe is shown on its own as a count, and a lone maybe produces no
recommend figure at all rather than "0%". The methodology paragraph `#early-ratings` says so
and its test pins the wording that matters.

The search and map islands import it, so its only runtime imports are `./scoring` and
`./scoring-colors`, which import nothing; its test fails if that changes.

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

`maybeEnv(locals)` is the exception, and only for render paths that must never throw and
have a safe default for every value they read — today, BaseLayout's head, which reads
`SITE_URL` and falls back to `https://ratemyplace.org`, and the sign-in and sign-up pages'
review note (`reviewSignin.ts`), which reads `DB` and drops the address without it. It returns `undefined` when there is
no runtime (the Astro container in unit tests) and when the Astro 6+ Cloudflare adapter's
`locals.runtime.env` getter throws its migration error, and logs that once per isolate.
Everything else keeps using `getEnv`, which throws on purpose.

`fireAndForget(context, promise)` registers work with `ctx.waitUntil` so the Worker isolate
stays alive after the response is sent, and swallows rejections into structured logs. An
unhandled rejection inside `waitUntil` crashes the isolate in production, so the internal
`.catch` is not optional. It returns `void` specifically so callers cannot `await` it.

Outbound email does not call it directly: it goes through `trackSend`, which wraps it (below).

### Email delivery and owner notices

- **`email.ts`** holds every template and exactly one Resend call, the private `deliver`.
  A send never logs and never throws: a missing key, a Resend error and a thrown call come back
  as `{ success: false, reason, code, httpStatus }` (`not_configured` / `provider_error` /
  `exception`). `error` can carry Resend's message, which can echo the recipient, so it is
  never stored or logged. `__tests__/emailPayloads.test.ts` snapshots every existing payload;
  a diff there is a change a recipient would see, not something to update with `-u`.
  `OWNER_NOTIFY_EMAIL` is the owner inbox.
- **`siteSettings.ts`** is a leaf, like `records/settings.ts`: it imports only types. It owns
  the site-level `app_settings` keys (`SITE_SETTING_KEYS`); site keys and `records_*` keys
  never mix, and a test enforces it.
- **`emailHealth.ts`** is the trace a failed send leaves. Kinds belong to one of three
  channels — `owner` (notices and the contact notification), `records` (the Worker's alerts)
  and `public` (everyone else) — and each channel keeps its own last-failure key, so a bounced
  landlord receipt cannot hide a failed owner notice. A record holds kind, reason, a sanitized
  code, the HTTP status, an 8-hex recipient hash and the request host; never an address and
  never Resend's message. `trackEmail` and `recordEmailProblem` never reject. Their writes are
  two sequential `.run()` calls, **never `db.batch`**: they run in the background after a
  route has answered, and a batch would open a transaction that can collide with the
  request's own. Imports from `email.ts` are type-only, so a partial `vi.mock('../email')` in a
  route test cannot break it. Worker-safe (no `node:`, no runtime `astro`).
- **`trackSend.ts`** is the one call shape for a route send:
  `trackSend(context, kind, to, sendX(…))`. It never throws after a route's write; the
  source host it records comes from `request.url`, so a preview deploy's failure — preview
  writes to the production D1 — is labelled "from <host>" on `/admin`.
- **`ownerNotify.ts`** emails the owner when an intake needs action. A notice carries only a
  kind and a building id (`OwnerNotice`), so a route cannot pass PII into one; the email
  shows the building address, the time and a link to the queue. Caps: 6 per hour and 15 per
  day per kind, 40 per day site-wide, on the `rate_limits` table. A denied notice is recorded
  as `capped` (its own counter, its own log event). If the limiter itself errors the notice
  **fails open** — every intake except review edit has already run its own fail-closed
  limiter on the same table and answered 503 before inserting, so in practice only review
  edits reach that path. It is not a relaxation of fail-closed request limiting; do not copy
  it into a request path.
- **`records/schedulerAlert.ts`** is the Worker's `alert` dependency, moved out of
  `workers/records-scheduler/src/index.ts` so it is tested. It sends through `trackEmail`
  with source `records-scheduler`, falls back to `OWNER_NOTIFY_EMAIL` when
  `RECORDS_ALERT_EMAIL` is unset or blank, and never throws.
- **`admin/inbox.ts`** is the dashboard's "Waiting on you" counts, one statement of scalar
  subqueries. It is the safety net for a notice that was capped or filtered. Contact messages
  are excluded: they have no resolve action, so the count could never clear.

### `privacy.ts` — fuzzing is a safety control

`formatRecency()` and the season/year formatters exist so exact tenancy dates never reach
a public surface. Do not add a display path that bypasses them, and do not "improve"
precision here — the imprecision is the point.

The move-in question is optional, but `reviews.move_in_season` and `move_in_year` are NOT
NULL, so a skipped part holds a placeholder (winter, the current year). `move_in_given`
(migration 0035) says which parts the reviewer gave, `moveIn.ts` decides what the submit
and edit routes store, and `givenMoveIn()` is the one reader: anything that shows a move-in
goes through it (or `reviewSeasonChipProps` / `formatMoveIn`), never the two columns
directly. NULL means the review predates the column and is shown as stored. The module is
a client leaf (`clientLeafModules.test.ts`): the edit form and admin table import it.

### `reviewEdit.ts` and `tenure.ts`: a review edit changes only what it sends

The reviewer's edit page starts every select at the stored answer, so an untouched save
writes back what was there: `moveOutEditValue` / `moveOutEditChoices` (`privacy.ts`) for the
move-out, `tenureEditValue` / `tenureEditChoices` (`tenure.ts`, a client leaf) for the
tenure. A blank stored answer starts on a blank "Select..." choice, never on a default.
`PATCH /api/reviews/[id]` keeps every field in `KEPT_WHEN_ABSENT` as stored when the body
leaves its key out (`withStoredFields`), and `moveOutFromEdit` keeps the move-out the same
way and clears a stored move-out season whenever the year changes, because the form has no
season control. `review_text` / `comments` and the laundry type and cost are still written as
sent: each pair is read together.

### `validation.ts` — use the shared primitives

`isValidEmail`, `isSafeHttpUrl`, `validateReviewText`, `enforceMaxLength`,
`escapeLikePattern`, `fitsLikePattern`, `sanitizeText`, plus per-form validators (`validateReviewForm`,
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
  sit at the same priority anyway. A fourth caller, `POST
  /api/admin/records/queue/backfill-reviewed`, is an admin one-shot that enqueues a
  `follower` row for every reviewed Boston building with no deeper pull — including
  parcel-less user rows, because the pull resolves the parcel itself and an unresolvable
  address completes in one attempt with an error row per source. `topUpFill` orders
  `has_any_pull` first and then `FILL_PRIORITY_ZIPS` (02134, 02135 — Allston–Brighton)
  before everything else, so the fill reaches the owner's neighbourhood first.
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
  the assessor, so its outage fails every other source), pauses the fill, records the cause
  in `records_breaker_pause_cause`, and emails once. A `fixture`-caused pause resumes
  itself at the end of a later `plan` whose fixture passed (at least one check run, none
  failed) with no source over the error threshold — flag cleared, cause deleted, one "fill
  resumed" email, `PlanResult.resumed`. An `errors` pause and a hand pause (no cause)
  never auto-resume: a quiet day is not evidence that a 50%-error source has recovered.
  `setFillPaused(db, paused, now, cause?)` is the only writer and batches flag and cause
  in one transaction; a write without a cause deletes the cause.
- **`settings.ts` owns four `app_settings` keys** — `records_fill_paused`,
  `records_breaker_pause_cause`, `records_breaker_last_alert`, `records_fixture_last` —
  and is a leaf module that imports
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
  sources. `addressLikeClauses` in `ckan.ts` then tries every street spelling on the
  identity that the short and long forms do not already prefix-cover, because the feeds
  spell suffixes differently (permits write `RADFORD LN` where the assessor writes
  `RADFORD LA`; legacy 311 writes `VFW PKWY` for the assessor's `VFW PW`).
- **Range addresses match every number on their side of the street.** `buildIdentity`
  keeps `numbers` as written (parcel resolution keys on them, so a middle number can never
  pull in a neighbouring parcel) and adds `matchNumbers`, every same-parity number between a
  plain range's endpoints, capped at `MAX_RANGE_NUMBERS`. The address-keyed feeds also find a
  city record filed under a wider range that contains the address: the violation feeds pair
  `enclosingLows` with `enclosingHighs` in two `IN` lists, and 311 adds one regex clause
  (`rangeAddressClause` / `rangeNumberClause` in `ckan.ts`) whose rows are then checked by
  `houseNumberTokenMatches`, since a range that starts below the address can end below it too.
  One regex, not one LIKE per number: each LIKE re-runs `upper()` over a whole 311 year, and
  the GET URL tops out near 8 KB (HTTP 414). The regex arm keeps the interpolation invariant
  by a digits-only guard on numbers and a plain-text guard on street spellings, with no
  backslash anywhere. Permits take the middle numbers only; their parcel arm covers the rest.
- **The 311 and violation-feed ZIP filters also accept the parcel's ZIP.** The current-year
  assessor row carries the parcel's own `ZIP_CODE`, and `pullBuildingRecords` copies it onto
  `identity.parcelZip` (through `zip5`) once that row is stored. It starts from the ZIP on the
  row an earlier pull stored, so a current-year assessor that fails (or whose write fails) does
  not drop the parcel ZIP and empty the records attached under it. A freshly stored row replaces
  it; on a failed write the fresh ZIP fills in only when the stored row has none. Either way the
  stored row's ZIP is one the feeds searched. The assessor years run first in
  `sourcesForCity`, so 311, ISD and Public Works see it; `recordZips` then lists the page ZIP
  plus the parcel's when they differ, and `zipEqualsClause` writes `=` for one and `IN` for two.
  It only widens: a page with no usable ZIP stays unnarrowed rather than narrowed to the
  parcel's, and the building row is never changed. Permits keep the page ZIP (their parcel arm
  covers the rest). The fixture runs its sources concurrently and never sets `parcelZip`.
- **`matchConfidence.ts` decides when an address-keyed zero is not a finding.** A range too
  wide to expand, a mixed-parity range, or a current-year parcel (`parcelStreetNumber` /
  `parcelStreetNumberHigh`, FY2026 only) that covers numbers the page's address does not:
  then each empty 311 group, Public Works and ISD say "not matched with confidence" instead of
  "none on record" (a 311 group with requests keeps its count). A page ZIP that differs from
  the parcel's is not a reason, because the pull searches both. It reads only stored data, so
  it needs no column, and a payload stored before October 2026 reads as no reason.
- **`seed/` is the bulk pipeline, not a request path.** `scripts/records-seed-boston.ts`
  downloads the assessor and SAM resources once (`fetchAllRows` in `ckan.ts`), and the pure
  modules under `records/seed/` filter, collapse, format, match, and emit SQL. Every string
  in the emitted SQL goes through `lit()`; the file is applied with
  `wrangler d1 execute --file`, which binds nothing. Seeded rows have `source = 'seed'` and
  deterministic ids (`seed-<parcel>`), so re-running is an upsert.
- **`seed/impliedUnits.ts` is the seed's land-use unit estimate (R2 is 2, R3 is 3), with two
  readers.** The seed writes it into `buildings.unit_count` when the assessor leaves the count
  blank, which the FY2026 file does for every residential parcel, and a seed match writes it
  over a user row's count too. No column records who wrote a count, so `unitCountLabel` in
  `buildingDetails.ts` labels a stored count "Units (estimated from land use)" when it equals
  the estimate and the building's current assessor record (`getCurrentAssessment` in
  `query.ts`, the row the facts strip shows) has no count. The facts strip prints the
  assessor's own count only when there is one. Change the table here and both follow.
- **`addressKey` / `streetKey` in `identity.ts`** are the lookup keys for seed matching and
  reviewer dedupe: base street name plus the assessor spelling of the suffix, and a
  house-number range. A change to the suffix table changes both, on purpose. Both return
  null for a degenerate street — a bare suffix like `Ave`, or an empty one — rather than a
  key that silently collides. That rule is `isDegenerateStreet`, defined once in
  `identity.ts` and called from four places (`buildIdentity`, `streetKey`, `addressKey`, and
  `seed/format.ts`); change the rule there, not at a call site.
  The first spelling of each `SUFFIX_SPELLINGS` row is the key spelling and must stay the
  assessor's; `recordsAddressKey.test.ts` pins it. The October 2026 additions put
  `WY`/`HW`/`PW`/`CI`/`LA`/`RO`/`AL`/`CR` ahead of `WAY`/`HWY`/`PKWY`/`CIR`/`LN`/`ROW`, so
  374 of the 375 affected stored keys did not move. After any change to the table, run
  `npm run records:suffix-backfill -- --remote --pulled-since <T_live>` (it only reads, via
  `seed/suffixBackfill.ts`) and apply its files by hand, in the order its `summary.txt` gives:
  the re-key is mandatory, the respell is optional, and the refresh waits for a live pilot.
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
- **`parseSearchQuery` reads a typed address before any of it is matched.** The stored
  address is the street line only, so `BOSTON_LOCALITY_NAMES` (multiword names as a unit),
  "MA", "Massachusetts", "USA", five-digit ZIPs and ZIP+4 come out of the street terms and
  become `places` / `zips`, which rank and never filter. A place word stays a street word when
  the next word in the same comma segment is a street suffix in any `SUFFIX_SPELLINGS`
  spelling ("Brighton Ave", "Allston St", "Boston St"), or when it follows "the" ("The
  Fenway"). The first number is the house number; later numbers, "apt"/"unit" plus the next
  word, and anything after "#" are unit numbers and are dropped. A hyphenated word with no
  digit is split ("Allston-Brighton" is two places); "14-18" and a ZIP+4 stay whole. A house
  number with only a place beside it ("7 Allston") keeps the place as its street word too,
  or the number alone would match every building with that number. A query that leaves no
  street word and no number but names a place or ZIP is an area search (`isAreaSearch`).
- **`coverage.ts` is the page-state table, read-only.** `recordsRequestState` answers
  `ineligible`, then for a building with any deeper pull `refresh_requested` / `stale` /
  `pulled`, then `fill_queued` / `parked` / `requested` / `never_pulled`, in **one** statement
  (indexed `building_id` seeks as correlated subqueries), because the public endpoint calls it
  once per request; `hasDeeperPull` and `pendingQueueReason` stay exported for callers that
  need one answer without the other. `stale` is `planRefresh`'s own predicate (newest deeper
  pull, any status, older than `REFRESH_AFTER_SECONDS`) with no pending row but a `fill` one;
  it is where the panel offers "Ask for newer records". `pulled` (30 days or less, or a parked
  non-fill row) is the 409 and the per-building debounce. `isPulledState` groups the three.
  **Three callers enqueue off this state:** the reader button (`request.ts`), which enqueues
  a `button` row from every state but `ineligible`, `pulled` and `refresh_requested` (that
  one answers `already_queued` with no write, so a press can never turn a planner `refresh`
  row into a cap-counted `button` row), and the follower enqueue on save and on review
  approval (`PATCH /api/admin/reviews/[id]`, a `follower` row), both only from
  `never_pulled`. A finished `button` row is interest to `planRefresh` forever, so a refresh
  press keeps the building on the monthly cycle with no Worker change.
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
- **`dedupe.ts` refuses rather than guesses — and the tier order lives in
  `buildingResolve.ts`, not here.** `findExistingBuilding` runs three read-only tiers: an
  exact Google **place id** (`findBuildingByPlaceId`, the one spelling of tier 1), then
  `findBuildingByAddress`, then an exact case-insensitive **(address, city)** for a manual
  entry with no place id. `POST /api/buildings` and the `/review/new?placeId=` handoff both
  call it, so the handoff and Continue cannot disagree about which page an address belongs
  on; only POST writes (it stamps a matched address-tier row, and creates otherwise). Only
  the middle tier is in `dedupe.ts`, and inside it the order is
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
- **`recordGroups.ts` sorts 311 into the panel's three groups at render time** (living
  conditions, building safety and code, property upkeep, in that order), by the request type
  the city recorded. It never changes the pull-time `classification` in
  `sources/boston/serviceRequests.ts`, which the daily fixture check and the breaker read, so
  editing the table needs no Worker deploy and cannot pause the fill. A request the pull
  calls `housing` always lands in a group; a type in no group is counted, never listed. The
  methodology page renders the same table, so add a type there and nowhere else. ISD
  violations are counted by case number and Public Works tickets by ticket number
  (`ledger.ts`), not by code line.
- **`display.ts` holds a privacy gate.** `showMailingAddress` publishes a tax mailing
  address only for an owner that reads as an entity, and `mailingAddressLine` holds the
  addressee to the same test — an entity can list a person as its `C/O ATT`. It errs
  toward hiding: a hidden business address costs a reader one lookup, a published home
  address cannot be taken back. `BANNED_WORDS` in the same file is scanned against the
  panel's templates by `__tests__/recordsPanelCopy.test.ts`.
- **The owner of record list is three modules over one table, `building_owners`.**
  `ownerOfRecord.ts` holds the rules, pure: `ownerKey` (the grouping key: case, spacing and
  punctuation only, never the mailing address), `isEntityOwner` (the mailing-address gate's
  entity words plus link-only words such as MANAGEMENT and LTD, kept apart so linking never
  publishes a mailing address; a trust whose only entity words are TRUST, FAMILY, NOMINEE or
  a trustee suffix is a person, since many owner-occupied homes are held that way, while
  `EXAMPLE REALTY TRUST` stays an entity), `linkableOwnerKey` (an entity always; a person
  only at `MIN_PARCELS_FOR_PERSON` distinct residential parcels; a condominium never) and
  `ownerRowFromAssessment`, the one row builder both writers use. `owners.ts` is the write
  side, run inside each assessor year's pull batch: the row is the newest stored fiscal year
  (the row the panel shows), so each year writes only when no newer year is stored. It runs
  in the Worker, so it stays runtime-agnostic, and it asks `sqlite_master` once per pull so a
  pull before migration 0034 writes nothing and fails nothing. `ownerList.ts` is the read
  side: the panel link (`ownerOfRecordHref`, only when this building's own row carries the
  same key), the list (`loadOwnerList`, which applies the person rule to whatever name was
  typed into the URL) and landlord search (`searchOwnerNames`, the same rule in SQL and again
  in code). Its statements are exported so `ownerOfRecordStore.test.ts` checks their query
  plans against `idx_building_owners_key`. List counts come from `ledgerModel` over
  `getRecordsViews` (two statements for a whole page), so a row and the building's panel
  show the same numbers. Every reader treats a missing table as no owner, never as a 500.
- **`provenance.ts` is the panel's source list and its freshness rule.** `recordsCitations`
  turns the source ids a building has pulls for into resource-level Analyze Boston links
  (`<dataset page>/resource/<id>`), built only from the resource-id constants in
  `sources/boston/*.ts`: a 311 pull cites all sixteen yearly files plus the new-system file,
  the assessor cites the fiscal years pulled, and an unknown id is left out. The license line
  is what CKAN `package_show` reported for all six packages on 2026-10-27 (ODC PDDL); if a
  package's `license_title` changes, the one-line credit stops being true and has to change
  here. `showStalePullNote` adds a plain note beside the pull date on a `pulled` building
  whose newest pull is older than `REFRESH_AFTER_SECONDS` (30 days). It is a label only: the
  reader button still refuses a `pulled` building (409), so it is not offered there.

### Search, page metadata, and the sitemap

- **`searchSql.ts` is the only spelling of the query-mode buildings query.**
  `buildingSearchWhere`, `buildingSearchSelect` and `buildingSearchOrder` are shared by
  `src/pages/search.astro` and `src/pages/api/search/results.ts`, so the page and the
  endpoint cannot disagree about which buildings match or in what order. Query mode returns
  every Boston building, reviewed ones first; browse mode, the landlord queries and the map
  keep their `HAVING COUNT(r.id) > 0`. `__tests__/recordsSearchParity.test.ts` fails if
  either call site stops using the fragments.
- **Query-mode order: the exact address, then reviewed before unreviewed.**
  `buildingSearchOrder` puts a building whose house number matches (whole, or inside a range
  under the `rangeContains` parity rule) and whose street words all match as whole words
  first, the typed neighborhood or ZIP deciding between twins. That is the only tier allowed
  above reviewed buildings; everywhere else a reviewed building never sorts below an
  unreviewed one. Then whole-word street matches, then the typed place, review count, score,
  and the house number as a number (not text). An area search (`isAreaSearch`: only a place
  and/or ZIP, such as "Brighton" or "02135") puts the newest approved review
  (`NEWEST_REVIEW_FIRST`, the browse rule) between the typed place and review count, so its
  reviewed buildings read most recently reviewed first; unreviewed ones tie on it and keep
  the order above. An address search never reads that key. The house number comes from `st_num_lo` /
  `st_num_hi` when set, else from the front of `b.address`. The ORDER BY carries binds and
  must be bound after the WHERE's. Keep a full query (where + order + LIMIT/OFFSET) under
  D1's 100 bound parameters: `__tests__/searchFullAddress.test.ts` checks the widest query
  the parser allows, which is why places and ZIPs are capped.
- **D1 refuses a LIKE pattern over 50 bytes** (UTF-8, wildcards and escapes included) and
  fails the whole statement, which the search page then shows as no match. A full address
  typed with its neighborhood, "Boston, MA" and ZIP is over that easily. `fitsLikePattern`
  (`validation.ts`) is the check: `searchSql.ts` writes a pattern that does not fit as `0`
  (no address word, neighborhood or landlord name is that long), and the landlord queries
  on the search page and the results endpoint skip it. `searchFullAddress.test.ts` measures
  every bind of a long query.
- **Browse mode is Boston first, most recently reviewed.** Its query stays in the two call
  sites, but its ORDER BY is `BROWSE_BUILDINGS_ORDER` in `searchSql.ts`: Boston buildings
  (`BOSTON_CITY_SQL`, the same city test `has_records` uses, without the parcel check), then
  the rest, each by newest approved review `created_at`, then `b.id` so Load more pages never
  overlap. The reviews row has no approval time (`moderated_at` is never written, `updated_at`
  moves on later moderation saves); it exists only in the admin `audit_logs` table, which a
  public query should not join, and submission and approval are days apart at most. Hence
  submission time. It orders rows only and is never shown.
  `__tests__/searchBrowseOrder.test.ts` pins the order against SQLite.
- **`buildingMeta.ts` decides the records-page title.** `buildingPageMeta` swaps in the
  records-flavored title and description only when a building has zero approved reviews, a
  Boston jurisdiction (`jurisdictionForCity`) and a parcel id. Reviewed pages keep the review
  metadata. The records title is `<address>, <neighbourhood>, Boston` (`bostonPlace`): the
  neighbourhood is named only when `bostonLocalityName` recognises it, in its display
  spelling; East Boston and South Boston drop the suffix; a blank, street-word, junk or
  out-of-city value ("St. Elizabeth's", "Chestnut Hill") falls back to `<address>, Boston`;
  and a Boston locality the address already carries is never named twice. Before October 2026
  711 seeded URLs shared a title; twin parcels at one address and ZIP (about 120 groups) still
  share one by design, because the parcel id stays out of the metadata.
- **`seo.ts` builds every page's head** (BaseLayout is the only caller). The canonical and
  `og:url` come from `SITE_URL` through `siteOriginFrom`, which never throws and falls back to
  `https://ratemyplace.org`; the query string is dropped and the trailing slash stripped, the
  sitemap's form. A `noindex` page (BaseLayout's prop) gets `robots: noindex, follow` and
  carries neither tag, so a private URL is never advertised; `isSearchVariant` noindexes
  `/search` with any parameter. `DEFAULT_OG_IMAGE` is the committed PNG, guarded by
  `__tests__/ogImage.test.ts`. Every page must be classified as a sitemap page, an indexable
  dynamic route or noindex — `__tests__/pageIndexing.test.ts` fails on a new page until it is.
- **`sitemap.ts` owns the allowlist and the chunking.** `STATIC_SITEMAP_PATHS` is the
  hand-kept list of public pages (property-manager pages are deliberately absent);
  `SITEMAP_CHUNK` is 10,000 URLs per chunk; `buildingChunkCount` has no floor of 1, so an
  empty table advertises no chunk at all. `lastmod` is the newest of the building's
  `updated_at`, its newest approved review, and its newest pull.
- **`bostonLocalities.ts` is the one Boston locality vocabulary.** `BOSTON_LOCALITY_NAMES`
  holds the 26 names in display form — every USPS city name for a Boston-only ZIP plus the
  neighborhood names people type, minus `CHESTNUT HILL`, whose 02467 also covers Newton and
  Brookline. Five consumers derive from it and none restates it: `locality.ts`
  (`BOSTON_NEIGHBORHOODS`, normalized and minus 'boston', behind the `isBostonLocality`
  predicate — Google Places routinely hands back the neighborhood as the locality),
  `locality.ts` again (`bostonLocalityName`, the display spelling of any value
  `isBostonLocality` accepts, for records-page titles), `records/identity.ts`
  (`TRAILING_LOCALITIES`, uppercased, for the trailing-locality stripper), and
  `records/dedupe.ts` (`CITY_CANDIDATES`, the bind list for its `city IN (…)` candidate
  predicate). A fifth, `searchQuery.ts`, strips them from typed searches. Add a name here
  and nowhere else. `BOSTON_SUB_AREAS` in the same
  file maps sub-area names Google hands back as the locality (Aberdeen, Oak Square, Cleveland
  Circle, Savin Hill, …) to the neighborhood they sit in; `displayLocality` and
  `resolveBostonSubArea` in `locality.ts`, `titleCaseNeighborhood` in
  `records/seed/format.ts` and `api/places/details.ts` apply it, gated on
  `isBostonLocality(city)` so a non-Boston "Aberdeen" is left alone. Do not add sub-areas
  to `BOSTON_LOCALITY_NAMES`; that list is the dedupe and search vocabulary.
- **`bostonBox.ts` and `mapView.ts` are the map's only geography.** `BOSTON_BOX` /
  `inBostonBox` (shared with `records/seed/sam.ts`) say what counts as inside Boston;
  `initialMapView` fits the first non-empty marker load to the Boston markers only (a New
  Haven pin does not drag the viewport out to sea), clamps zoom to 15, centres a lone marker,
  and `shouldPanToUser` pans to the reader only when they are inside the fitted box.
  `BuildingMap.tsx` fits once (`didFitRef`) and never again on refetch, and skips viewport
  refetches until the first unbounded load lands so that one fit sees every building.
- **The homepage dropdown has its own Places scope.** `GET /api/places/autocomplete` serves
  two islands. The review form's `AddressAutocomplete` sends no scope and gets any US
  address (people review buildings outside Boston). `HomeSearch` alone sends `scope=boston`:
  `autocompleteRequestBody` (`places.ts`) adds a location bias to `BOSTON_BOX`,
  `matchPredictionsToBuildings` (`homeSearchMatch.ts`) resolves each suggestion read-only
  through `findExistingBuilding`, refusing an address-key match when Google and the building
  name different neighborhoods, and matching a suggestion outside Massachusetts by its exact
  place id only (Boston's neighborhood names are towns elsewhere: "Brighton, MI"). Then
  `bostonScopePredictions` keeps Massachusetts, Boston first, and drops every suggestion
  from elsewhere that did not match one of our buildings. `homeSearchItems.ts` (a leaf) orders the rows:
  buildings we have ("See this building", with "Write a review" beside it), landlords, then
  "Other addresses". Never add the scope to the review form without the owner's say.
- **`mapCluster.ts` decides how a marker cluster looks.** A dark neutral circle with a ring
  and a whole-number count, labelled "N buildings", so it cannot be read as a score pin.
  Never fill it with a score band colour: a reader once took a cluster's "2" in the
  Concerning colour for a Concerning score. `mapCluster.test.ts` fails on any `SCORE_HEX`
  value in the badge style, and no score of any kind is computed for a cluster. The map
  legend shows the same circle as a "Group of buildings" row below the four score rows
  (`CLUSTER_LEGEND_SWATCH_STYLE`); `buildingMapClusters.test.tsx` mounts the island on a
  stubbed map to check the legend and the badge, since no Maps key exists off production.
- **`admin/landlordMatch.ts` decides whether a tenant-typed landlord name is "the same
  landlord".** `classifyLandlordCandidates` preselects an existing landlord only when exactly
  one same-name landlord shares the building's state and city (Boston localities count as
  Boston; a trailing ", ST" is ignored); otherwise the link panel opens in create mode and
  names the same-name landlords elsewhere, and `keptSeparateNote` writes the decision into
  `landlords.admin_notes`. Name alone is never enough — "AA Management" in Boston and in
  New Haven are two companies.
- **`admin/orphanBuildings.ts` is the one definition of a deletable building.** See the
  cleanup trap in the root `AGENTS.md`; the list toggle and the delete share it.

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
