# Records scheduler runbook

Operating the companion Cron Worker that fills in Boston building records:
`ratemyplace-records-scheduler`, deployed from `workers/records-scheduler/`. This is the
operator's document — what runs, what to do on the first deploy, how to read the panel, and
what to do when the breaker trips. For how the Worker is wired to the scheduler code, read
[`workers/records-scheduler/README.md`](../../workers/records-scheduler/README.md); for what
the scheduler decides, read `src/lib/records/scheduler.ts` and `src/lib/records/queue.ts`.

The Worker is a **second deployable**. Pushing `main` deploys the Pages site and nothing
else; a change to `src/lib/records/scheduler.ts` or `queue.ts` is live in the site's admin
routes but not in the cron until someone runs `npm run records:worker:deploy`.

## What runs when

| Cron | Runs | What it does |
|---|---|---|
| `* * * * *` | every minute | `drain`. Up to three people-facing rows (priority 0 and 1: button, follower, refresh), then one city-wide `fill` row unless the fill is paused. Logs one `records_drain` line. |
| `0 6 * * *` | 06:00 UTC daily | `plan`. In order: purge finished `refresh`/`fill` rows older than 90 days, enqueue refreshes, top the fill queue back up in batches of 100 inserts, run the Lanark fixture, compute per-source error rates, then decide the circuit breaker. Logs `records_plan_enqueued` and `records_plan`. |

Rows are claimed **one at a time, immediately before the pull that uses them**, so a lease
covers a request that is actually in flight. The two crons overlap at 06:00 UTC. That is
safe: they are separate invocations, `plan` takes no locks, and every claim is a conditional
`UPDATE`, so the worst case is that minute's drain picking up a row the planner enqueued a
second earlier — which is what it is for.

## First deploy

Do these in order. The first minute tick starts pulling the moment the Worker is live, so
the pause flag has to be on production **before** the Worker is.

> **As of 2026-09-10 the Worker is not yet deployed.** The API token in use lacks the
> "Workers Scripts: Edit" permission, so `npm run records:worker:deploy` cannot run — grant
> that permission (or `wrangler login`) first. Owner action. And note that `app_settings` on
> production is empty today, so step 1 below is required rather than a formality: with no
> row for `records_fill_paused` the fill reads as running, and the first minute tick after
> the deploy would start the city-wide pass.

**1. Confirm the fill is paused on production.** This is an upsert, so it is safe whether or
not the row already exists:

```bash
npx wrangler d1 execute ratemyplace-db --remote --command \
  "INSERT INTO app_settings (key, value, updated_at) VALUES ('records_fill_paused', '1', unixepoch())
   ON CONFLICT(key) DO UPDATE SET value = '1', updated_at = unixepoch()"
```

Read it back and confirm it is `1` before going further:

```bash
npx wrangler d1 execute ratemyplace-db --remote --command \
  "SELECT key, value, updated_at FROM app_settings WHERE key = 'records_fill_paused'"
```

Remote D1 needs `CLOUDFLARE_API_TOKEN` in the environment or you get a 7403.

**2. Set both secrets.** Worker secrets are not shared with Pages, so these are separate
from the site's, and each is set once:

```bash
npx wrangler secret put RESEND_API_KEY --config workers/records-scheduler/wrangler.jsonc
npx wrangler secret put RECORDS_ALERT_EMAIL --config workers/records-scheduler/wrangler.jsonc
```

`RECORDS_ALERT_EMAIL` is the address the breaker alert goes to. It is a secret rather than a
`vars` entry so a personal address is not committed to git. Miss it and the breaker still
pauses the fill — it just logs `records_breaker_email_skipped` at error level instead of
emailing anyone, which is a silence you would only notice too late.

**3. Deploy:**

```bash
npm run records:worker:deploy
```

**4. Wait for one `records_drain` line.** Tail the Worker and stay there for a minute or
two:

```bash
npx wrangler tail --config workers/records-scheduler/wrangler.jsonc --format pretty
```

On a quiet queue with the fill paused, expect one line a minute reading `records_drain` with
`fillPaused: true`, `pulled: 0`, `failed: 0`, `budgetHit: false`. A `records_scheduler_error`
means stop and look before walking away.

So does a `pulled` count while the fill is paused — but **only before the first 06:00 planner
run**. Until the planner has run there is nothing legitimate in the queue, so a pull is a
pull that should not be happening. After it, refresh rows exist and drain normally while the
fill is paused; that is the design, not a leak. What settles it is `trigger_reason` on the
pulls themselves, not the count in the log line — `queue:refresh`, `queue:button` and
`queue:follower` are all expected on a paused fill, and `queue:fill` is not:

```bash
npx wrangler d1 execute ratemyplace-db --remote --command \
  "SELECT trigger_reason, COUNT(*) FROM record_pulls WHERE retrieved_at >= unixepoch() - 3600
   GROUP BY trigger_reason"
```

**5. Check the next 06:00 UTC `records_plan` line.** The planner runs once a day, so this is
a next-morning check rather than a same-session one. Look for `records_plan` with
`fixtureFailures: 0` and `alerted: false`, and for the `records_plan_enqueued` line just
before it. Workers Logs is enabled on this Worker, so both can be read after the fact under
Workers → `ratemyplace-records-scheduler` → Logs rather than by sitting on a tail at 2am.

Unpausing the city-wide fill is a separate, deliberate step (sub-project C3, after the site
release), not part of this deploy. See the next section.

## Turning the city-wide fill on for the first time

The Worker ships paused. Once the C3 site release is live (search, the records button, the
sitemap), turn the fill on once, deliberately.

**Step 0, before anything else: apply migration `0033` by hand.** It indexes
`records_queue(reason, requested_at)`, which is the records button's rolling daily-cap count
over a table whose `button` rows are never purged. It is idempotent, and it is the one
migration on this branch that production does not have yet.

```bash
npx wrangler d1 execute ratemyplace-db --remote --file migrations/0033_records_queue_reason_requested.sql

# Verify — this must return the index name, not an empty result
npx wrangler d1 execute ratemyplace-db --remote --command \
  "SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_records_queue_reason_requested'"
```

Then open `/admin/records`, confirm the fixture line reads "Fixture: all N checks passed at
<date>" with today's date, and press **Resume fill**. Within a minute `records_drain` lines
start showing `pulled: 1` and `fillPaused: false`.

Watch three numbers on the first day:

- **Completed (24 h)** should climb toward about 1,440.
- **Oldest pending** should stay under an hour.
- Per-source errors should stay well under half of attempts for every source:

```bash
npx wrangler d1 execute ratemyplace-db --remote --command \
  "SELECT source_id, status, COUNT(*) FROM record_pulls WHERE retrieved_at >= unixepoch() - 86400
   GROUP BY 1, 2"
```

If the 06:00 planner pauses the fill and emails, read the email before resuming — see below.

## Reading the admin panel

`/admin/records`, the "Pull queue" section. It polls the read-only
`GET /api/admin/records/queue`.

- **Fill running / Fill paused**, with the button that flips it. Only the city-wide fill is
  affected; button, follower and refresh rows drain either way.
- **Pending counts by reason** — button, follower, refresh, fill. These count *claimable*
  rows: a parked row is not in them.
- **Parked** — rows that used up their three claims. Listed in full below the counts, with
  the address, the reason, the attempt count, and the last error.
- **Completed (24 h)** — rows finished in the last day. At full rate with an otherwise empty
  queue this sits near 1,440.
- **Oldest pending** — the age of the oldest claimable row. A number that climbs past a few
  hours with the fill running means the drain has stopped; check the Worker's Cron Events
  tab for red rows.
- **Fixture** — the last daily Lanark fixture result, from
  `app_settings.records_fixture_last`. The healthy state is a line reading "Fixture: all N
  checks passed at <date>" — the panel names the number of checks out loud, because "nothing
  failed" is also true of a run where nothing ran — with a timestamp from this morning. A
  timestamp more than a day old means the planner did not run.

## The breaker email, and unpausing

The subject is "RateMyPlace records fill paused". It arrives once. It means the daily
planner found one of two things:

- **The Lanark fixture failed** — any failed check, or any source that threw. The email
  lists each failure and then the per-source row counts, which are the fastest way to tell
  "the city is down" from "our query broke": a source returning zero rows where it returned
  four hundred yesterday is a different problem from one that threw.
- **A source is erroring** — at least 20 attempts in the last 24 hours with more than half
  of them errors. The six assessor years are counted here on purpose, even though the fill's
  notion of "covered" excludes them: parcel resolution runs through the assessor, so an
  assessor outage fails every other source for the same building, and a breaker blind to it
  would watch five sources fail without ever naming the one thing that broke them.

What the breaker does: sets `records_fill_paused = '1'`, logs `records_fill_paused` with the
reasons, sends the one email, and stamps `records_breaker_last_alert`. It never unpauses —
a source that flaps must not be able to pause and resume the fill behind everyone's back.
Button, follower and refresh pulls keep running the whole time; only the city-wide fill is
held.

Before unpausing, find out whether the cause is fixed. `npm run records:check` runs the same
fixture by hand against the live datasets and prints every check, which is the quickest
answer. Boston retiring a 311 resource id is a common cause and does not heal on its own —
`LEGACY_311_RESOURCES` in the 311 source has to be updated, and both the site and the Worker
redeployed.

Then unpause from `/admin/records` with the Resume fill button, or, if the site is not
reachable:

```bash
npx wrangler d1 execute ratemyplace-db --remote --command \
  "INSERT INTO app_settings (key, value, updated_at) VALUES ('records_fill_paused', '0', unixepoch())
   ON CONFLICT(key) DO UPDATE SET value = '0', updated_at = unixepoch()"
```

The fill resumes on the next minute tick. If the cause has not actually cleared, the next
06:00 planner pauses it again and emails again.

## Retrying a parked row

A row parks after three **claims**. Retry — in the parked list on `/admin/records`, or
`POST /api/admin/records/queue/retry` with `{ "id": <queue row id> }` — zeroes the attempts,
clears the stale error and the lease, and lets the next tick claim it again.

**A 409 means the pull is still running.** `attempts` counts claims, not failures, so a row
crosses three at the moment of its last claim and appears parked while that pull may still
be in flight — for up to the 30-minute lease (`LOCK_TTL_SECONDS = 1800`). Clearing the lease
then would hand the same building to the very next tick alongside the pull already running,
so the endpoint refuses with 409 and the panel disables the button. Wait for the lease to
expire and try again. A 404 is a different answer: no such row, or one that has already
finished.

Repeated parking on the same building is a real failure, not a transient one. Read the row's
`last_error` before retrying it a third time.

## Stopping everything

- **Stop the city-wide fill, keep people-facing pulls.** Pause from `/admin/records`, or run
  the SQL above with `'1'`. This is the normal brake and needs no deploy.
- **Stop everything, keep the Worker.** Remove the `crons` array from
  `workers/records-scheduler/wrangler.jsonc` and redeploy, or disable the triggers under
  Workers → `ratemyplace-records-scheduler` → Settings → Triggers in the dashboard.
- **Stop everything, remove the Worker:**
  ```bash
  npx wrangler delete --config workers/records-scheduler/wrangler.jsonc
  ```
  The queue tables live in D1 and survive; nothing drains them until a scheduler is back.

## Expected steady-state numbers

At full rate, with the fill unpaused:

- **About 110 requests a minute to data.boston.gov.** Four pulls a tick, about 27 requests
  each: 17 of them 311 (sixteen yearly files plus the new-system resource), one per assessor
  year, one each for permits, violations, code enforcement and RentSmart. A seeded building
  needs no parcel-resolution query, because its row already carries the parcel. That rate is
  the point: it is polite against a public CKAN endpoint, it sits well under the Workers
  limit of 1,000 subrequests per invocation, and it makes the city-wide fill take months
  rather than hammering the city in an afternoon.
- **About 1,440 fill pulls a day** — one a minute, every minute. Against 38,208 seeded
  buildings, a first pass is measured in weeks.
- **About 15,800 `record_pulls` rows a day from the fill** — 11 per pull, one per source,
  times 1,440. The typed `building_records` payload rows, the people-facing pulls, and the
  queue's own claim and complete updates all sit on top of that.

While the fill is paused, all three fall to whatever readers and the refresh planner
generate, which on a normal day is close to zero.

## Local development

**Stop the site dev server first.** `npm run dev` and `npm run records:worker` both open the
same local D1 SQLite file under `.wrangler/state`. Two writers on one file give you
`SQLITE_BUSY` mid-drain — a confusing failure with nothing to do with the code you are
testing. Run one at a time.

```bash
npm run records:worker
```

That starts `wrangler dev --test-scheduled` on `http://localhost:8787`. Nothing fires on a
schedule in dev; trigger a run by hand:

```bash
curl "http://localhost:8787/__scheduled?cron=0%206%20*%20*%20*"   # the daily planner
curl "http://localhost:8787/__scheduled?cron=*%20*%20*%20*%20*"   # one drain tick
```

Both make real requests to the live city API and write real rows to the local database.

## Known limits

- **A row whose pull kills the runner parks after three claims.** `attempts` counts claims,
  not caught failures, precisely so a building that OOMs or hits the CPU limit — a failure
  the dying runner cannot report — cannot be claimed forever. It parks for a human instead.
  The cost is that three unlucky claims park a row that never failed cleanly; Retry is the
  answer.
- **A building whose every deeper pull errored re-enters the fill.** "Covered" means at
  least one deeper pull that came back `ok` or `empty` — an answer. A building that only
  ever errored learned nothing about the city, so it is queued again, but **behind** every
  building nobody has tried yet. First coverage beats a retry, and a source that is down for
  a week cannot spend the whole fill re-failing the same buildings. `empty` is an answer, not
  a miss: the city having no permits for a building is exactly what the panel shows.
- **A drain stops claiming after 45 seconds of wall clock** (`DRAIN_BUDGET_MS`) and reports
  `budgetHit: true` on its `records_drain` line, plus a `records_drain_budget_hit` line of
  its own. The cron fires every minute whether or not the previous tick has finished, so the
  ceiling is what keeps a slow city from stacking overlapping drains instead of throttling
  them. One such line is a slow minute at data.boston.gov. A run of them means the queue is
  draining more slowly than it fills, and the fill is the thing to pause.
- **The queue is a working set, not a copy of the city.** The fill is topped up to 2,000
  pending rows, so queue depth is not a progress bar. Coverage is a question for
  `record_pulls`, not `records_queue`.
