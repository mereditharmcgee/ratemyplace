# `ratemyplace-records-scheduler`

The companion Cron Worker for the building-records queue. The Pages site cannot run cron
triggers, so this Worker exists purely to call into the site's own code on a schedule: it
binds the same `ratemyplace-db` D1 database and imports `drain` and `plan` from
[`src/lib/records/scheduler.ts`](../../src/lib/records/scheduler.ts).

There is no logic here. `src/index.ts` builds a `SchedulerDeps` bag from the Worker's
bindings (D1, Resend key, alert address) and calls one of two functions. Everything that
decides *what* to pull, *when* to pause, and *whether* to alert is unit-tested in the site
package against the `node:sqlite` D1 double.

## The two crons

| Cron | Runs | What it does |
|---|---|---|
| `* * * * *` | every minute | `drain` — claims up to 3 people-facing rows plus 1 city-wide fill row, pulls each building's records for real, logs `records_drain`. Skips the fill row entirely while the fill is paused. |
| `0 6 * * *` | 06:00 UTC daily | `plan` — enqueues refreshes, tops the fill queue back up, purges finished rows, runs the Lanark fixture and the source error-rate check, trips the circuit breaker (pausing the fill and emailing once) if either fails. Logs `records_plan`. |

A pull is roughly twenty requests to `data.boston.gov`, so a full minute tick is about
eighty requests. That rate is deliberate: it is polite against a public CKAN endpoint, and
it makes the city-wide fill take months rather than hammering the city in an afternoon.

Both handlers write one structured JSON line per run (`records_drain` / `records_plan`),
plus `records_scheduler_error` if the run throws and `records_breaker_email_failed` if the
alert email does not send.

## Running it locally

From the repo root, against the local seeded D1 under `.wrangler/state`:

```bash
npm run records:worker
```

That starts `wrangler dev --test-scheduled` on `http://localhost:8787`. Nothing fires on a
schedule in dev; trigger a run by hand:

```bash
# the daily planner
curl "http://localhost:8787/__scheduled?cron=0%206%20*%20*%20*"
# one drain tick
curl "http://localhost:8787/__scheduled?cron=*%20*%20*%20*%20*"
```

Both make real requests to the live city API and write real rows to the local database.
Inspect the result with:

```bash
npx wrangler d1 execute ratemyplace-db --local --command \
  "SELECT reason, COUNT(*) FROM records_queue WHERE done_at IS NULL GROUP BY reason;
   SELECT trigger_reason, COUNT(*) FROM record_pulls GROUP BY trigger_reason;
   SELECT key, value FROM app_settings"
```

If the local database is behind, apply migrations first:
`npx wrangler d1 migrations apply ratemyplace-db --local`.

## First deploy

Deploy it paused. The first minute tick starts pulling the moment the Worker is live, so
the pause flag has to be on production *before* the Worker is.

1. **Pause the fill on production.** Toggle it off in the admin records panel, or:
   ```bash
   npx wrangler d1 execute ratemyplace-db --remote --command \
     "INSERT INTO app_settings (key, value, updated_at) VALUES ('records_fill_paused', '1', unixepoch())
      ON CONFLICT(key) DO UPDATE SET value = '1', updated_at = unixepoch()"
   ```
   Confirm it reads back as `1`. People-facing rows still drain while paused; only the
   city-wide fill is held.
2. **Set the Resend secret** (once per Worker, not shared with Pages):
   ```bash
   npx wrangler secret put RESEND_API_KEY --config workers/records-scheduler/wrangler.jsonc
   ```
3. **Deploy:**
   ```bash
   npm run records:worker:deploy
   ```
4. **Watch the first few ticks:**
   ```bash
   npx wrangler tail ratemyplace-records-scheduler --format pretty
   ```
   Expect a `records_drain` line every minute with `fillPaused: true` and `pulled: 0` on a
   quiet queue. Anything else — `records_scheduler_error`, or a `pulled` count on a paused
   fill — means stop and look before walking away.

Unpausing the city-wide fill is a separate, deliberate step (sub-project C3), not part of
this deploy.

## Stopping it

- **Stop the city-wide fill, keep people-facing pulls:** flip the pause switch in the admin
  records panel (or the `records_fill_paused` SQL above with `'1'`). This is the normal
  brake and needs no deploy.
- **Stop everything, keep the Worker:** remove the `crons` array from
  `workers/records-scheduler/wrangler.jsonc` and redeploy, or disable the triggers under
  Workers → `ratemyplace-records-scheduler` → Settings → Triggers in the Cloudflare
  dashboard.
- **Stop everything, remove the Worker:**
  ```bash
  npx wrangler delete --config workers/records-scheduler/wrangler.jsonc
  ```
  The queue tables live in D1 and survive; nothing drains them until a scheduler is back.

The circuit breaker does the first of these on its own if the Lanark fixture fails or a
source's error rate crosses the threshold, and emails `RECORDS_ALERT_EMAIL` once.
