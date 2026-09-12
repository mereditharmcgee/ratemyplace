# RateMyPlace Boston — Agent Guide

This is the canonical instruction file for AI coding agents working in this repo
(Codex, Claude Code, and anything else that reads `AGENTS.md`). `CLAUDE.md` points here.

Directory-specific rules live in nested `AGENTS.md` files and override this one where they overlap:

| Path | Covers |
|------|--------|
| [`src/lib/AGENTS.md`](src/lib/AGENTS.md) | Scoring, survey items, validation — the load-bearing logic |
| [`src/components/AGENTS.md`](src/components/AGENTS.md) | Astro vs React, brand tokens, islands |
| [`migrations/AGENTS.md`](migrations/AGENTS.md) | Schema changes and the production migration trap |
| [`ops/AGENTS.md`](ops/AGENTS.md) | Non-code work: growth, funding, partnerships, content |

> **Never put an `AGENTS.md` (or any `.md`) inside `src/pages/`.** Astro's file-based
> routing turns Markdown in `src/pages/` into a public page — a guide at
> `src/pages/api/AGENTS.md` ships as `ratemyplace.org/api/AGENTS`, publishing internal
> security notes. API route guidance lives in the "API routes" section below instead.

---

## What this project is

RateMyPlace is **a public record of rental housing, from the people who know it best** —
a tenant housing review platform grounded in public health research. Renters rate their
unit, building, and landlord on a 32-item survey (27 scored + 5 ancillary) adapted from
three validated instruments: OHQS, PHQS, and WHO LARES.

It is not Yelp for apartments. It is closer to a public health department with a comment
section. Housing is a social determinant of health, and rental markets have severe
information asymmetry — landlords pull credit reports and tenant blacklists, tenants get
a walkthrough. The product exists to close that gap.

Live at **ratemyplace.org**. Single maintainer. ~51 reviews in production across Boston
and New Haven.

## Non-negotiables

These are product commitments, not preferences. Do not trade them away for convenience,
and flag it explicitly if a requested change would erode one.

1. **Tenant anonymity is a safety feature.** Retaliation is the risk being designed
   against. Exact timestamps and tenure are collected but **never displayed** — public
   surfaces show fuzzy buckets only (`src/lib/privacy.ts`). No per-user analytics.
   *Accurate scope:* reviewer IPs are never stored. IPs **are** persisted in two
   operational places — `rate_limits` keys on client IP, and `audit_logs.admin_ip`
   records the acting admin. Don't widen that, and don't state "no IPs are stored"
   in public copy.
2. **Scoring changes are retroactive and require sign-off.** Touching `ITEM_WEIGHTS`,
   `RECENCY_BANDS`, or the aggregation formula silently rewrites every score in the
   database. Never adjust them as a side effect of another change.
3. **The methodology is public and must stay true.** `/methodology` publishes every item,
   weight, and citation. Code and page must not drift apart.
4. **Landlords get due process, not veto power.** Reviews are moderated and disputable.
   A negative review is never removed because someone disagrees with it.
5. **Admin actions are audited.** Every destructive admin action writes an audit log entry.

## Stack

| Layer | Choice |
|-------|--------|
| Framework | Astro 5 SSR (`output: 'server'`) + React 18 islands |
| Hosting | Cloudflare Pages — auto-deploys from `main` |
| Database | Cloudflare D1 (SQLite), binding `DB` |
| File storage | Cloudflare R2, binding `VERIFICATION_BUCKET` |
| Auth | Lucia v3 + D1 adapter; password (Oslo crypto) and Google OAuth |
| Styling | Tailwind CSS 4 via Vite plugin |
| Email | Resend |
| Bot defense | Cloudflare Turnstile |
| Types | TypeScript strict mode |
| Tests | Vitest (unit) + Playwright (E2E) |

Runtime env vars are reached through `getEnv(context)` in `src/lib/runtime.ts` — **never**
`(context.locals as any).runtime`. v1.5.0 removed 89 such casts; do not reintroduce them.

## Commands

```bash
npm run dev        # Astro dev server
npm run check      # Astro/TypeScript diagnostics
npm test           # Vitest unit suite
npm test -- scoring   # filter by name
npm run build      # production build
npm run e2e        # fresh local D1 + seed + build + Playwright
npm run db:setup   # db:fresh then db:seed (local D1 only)
npm run ops:metrics   # regenerate ops/METRICS.md from production (read-only)
npm run records:check   # live Lanark fixture check (hits data.boston.gov), run by hand
npm run records:seed -- --dry-run   # Boston bulk seed; --write / --apply --local / --apply --remote
npm run records:worker        # run the records-scheduler Worker locally (stop `npm run dev` first)
npm run records:worker:deploy # deploy the records-scheduler Worker — separate from the site deploy
```

`npm run smoke` has no default target. Supply an explicit `--environment` and
`--base-url`; preview and production also require a 40-character
`--expected-release` SHA. See [`docs/runbooks/release-smoke.md`](docs/runbooks/release-smoke.md).

Run `npm run check`, `npm test`, and `npm run build` before declaring work complete.

## Conventions

- **Business logic lives in `src/lib/`, never in components.** Components render.
- **Every API route handles auth explicitly.** No implicit protection anywhere.
- **Parameterized queries always.** Never string-interpolate user input into SQL.
- **Timestamps are `unixepoch()`**, never `datetime('now')`. Column type
  `INTEGER DEFAULT (unixepoch())`.
- **No new `any` types.** Define interfaces in `src/lib/types.ts`. This is a direction, not
  a finished state — `audit.ts`, `rateLimit.ts`, and several pages still use `any`. Don't
  add more; clean up what you touch.
- **Score colors come from `src/lib/scoring-colors.ts`.** Never hardcode a band color.
- React islands use `client:load`; everything else stays server-rendered.

### Git

Commit prefixes: `feat:` `fix:` `docs:` `chore:` `refactor:`.
`main` is production and auto-deploys — work on feature branches.

## API routes (`src/pages/api/`)

Nothing is protected implicitly — every route handles its own auth,
validation, and rate limiting. A missing check is a live vulnerability, not a style issue.

### Checklist for every new endpoint

- [ ] Auth check if it needs one (`context.locals.user`)
- [ ] Admin check if admin-only (`context.locals.user?.isAdmin`)
- [ ] Content-type guard if it accepts JSON
- [ ] Rate limiting if it is public
- [ ] Turnstile if it is an unauthenticated public POST
- [ ] Input validation before any processing
- [ ] Parameterized queries — never string interpolation
- [ ] Audit log if it is a destructive admin action

**Narrow exception:** the input-free, read-only `GET`/`HEAD /api/health` endpoint has no
D1-backed application limiter, so cookie-free release monitoring stays independent of D1.
This exception applies to no other public endpoint and does not authorize a custom edge
rate rule; any such edge configuration needs separate approval.

**Documented exception to "parameterized queries always":** Boston's CKAN SQL endpoint
(`datastore_search_sql`) has no parameter binding, so `src/lib/records/` is the one place
in this repo that builds SQL by interpolation. It is scoped to that directory and to
queries sent to `data.boston.gov`, never to D1. The invariant that keeps it safe: every
interpolated value passes through `sqlLiteral` or `addressLikeClauses` or a digits-only
guard, and every identifier (resource id, column name) is a code constant, never user
input. After touching an adapter, run `npm run records:check` against the Lanark fixture.
This exception does not extend to any other module or any other data source.

### Getting the database

```typescript
import { getDB } from '../../lib/db';

const db = getDB(context);
```

`getDB` takes the `APIContext` itself. It does **not** take `context.locals.runtime`, and
it needs no cast. Older docs showed `getDB((context.locals as any).runtime)` — that is
wrong, does not compile, and reintroduces the `as any` pattern v1.5.0 removed from 89 sites.

### Auth

```typescript
if (!context.locals.user) {
  return new Response(JSON.stringify({ error: 'Authentication required' }), {
    status: 401, headers: { 'Content-Type': 'application/json' }
  });
}

if (!context.locals.user?.isAdmin) {
  return new Response(JSON.stringify({ error: 'Admin access required' }), {
    status: 403, headers: { 'Content-Type': 'application/json' }
  });
}
```

Ownership is a separate check from authentication. A signed-in user editing a review must
be verified as the *author* of that review, not merely logged in.

### Responses

Success `{ data }` / client error `{ error, details }` / server error `{ error }`, all with
`Content-Type: application/json`. Never return a stack trace, file path, SQL fragment, or
internal field name — log detail server-side with `logError` from `lib/logger.ts`.

Select columns explicitly on anything public-facing. `admin_notes` leaked through a search
endpoint once because the query used `SELECT *`.

### Rate limiting

```typescript
import { checkRateLimit, getClientIP, buildRateLimitHeaders } from '../../lib/rateLimit';

const clientIP = getClientIP(context);
const rateLimit = await checkRateLimit(db, clientIP, 'dispute', 3, 3600); // 3 per hour

if (!rateLimit.allowed) {
  const status = rateLimit.error ? 503 : 429;   // fail closed: limiter error → 503, not open
  return new Response(JSON.stringify({ error: 'Too many requests. Please try again later.' }), {
    status,
    headers: { 'Content-Type': 'application/json', ...buildRateLimitHeaders(rateLimit, 3) }
  });
}
```

Rate limiting is **fail-closed**. If the limiter itself errors, the request is refused, not
allowed through. Preserve that.

### CSRF — read before adding any endpoint

No CSRF token implementation, deliberately. Protection is three layers (audited 2026-04-28,
`.planning/audits/csrf-2026-04.md`):

1. **SameSite=Lax** on the session cookie (`src/middleware.ts`) and the OAuth state cookie
   — cross-site POSTs carry no session, so authenticated endpoints are inherently covered.
2. **Cloudflare Turnstile** on every unauthenticated public POST form.
3. **Astro `security.checkOrigin`** (default `true` for SSR) — rejects cross-origin POSTs
   with form content types.

**The caveat that matters:** `checkOrigin` does **not** cover `application/json` POSTs. An
unauthenticated endpoint accepting JSON gets nothing from layers 1 or 3, so it must wire
all three of: a content-type guard, a rate limit, and Turnstile.

`src/pages/api/disputes.ts` is the reference implementation. Read it before writing a new
public endpoint. Its order matters:

```
content-type guard → rate limit → request.json() → Turnstile → validation → logic
```

The content-type guard must come **before** `request.json()`, which throws a raw
`SyntaxError` on non-JSON input.

Re-audit triggers: Astro major upgrade, replacing Lucia, a new OAuth provider, or a new
non-form content-type endpoint.

### Turnstile and email

`verifyTurnstile(token, getEnv(context).TURNSTILE_SECRET_KEY, clientIP)` — required on
signup, signin, forgot-password, contact, disputes, bug reports, reviews, record
corrections, and the public records request (`/api/records/request`). It cannot be tested on
preview or locally; verify on production.

Email templates live in `lib/email.ts`, never in route handlers, and every interpolated
user value goes through that module's local `escapeHtml`. Send with
`fireAndForget(context, promise)`, never a bare `await`.

## Traps

Things that have already cost time. Read before debugging.

- **The CI audit gate has an allowlist.** `scripts/audit-critical.mjs` fails on any critical
  npm advisory not listed in `audit-allowlist.json`; each entry carries the reason it does
  not apply to this deployment and an expiry date, after which CI fails again. Added
  2026-09-09 for the Astro AVIF advisory (GHSA-26w7-cxv4-gfx2), which needs Astro 7 to
  fix. Never add an entry without a reason and a date.
- **There is a second deployable.** `workers/records-scheduler/` is a Cron Worker that runs
  the records queue; Pages has no cron triggers. Pushing `main` deploys the site and nothing
  else, so a change to `src/lib/records/scheduler.ts` or `queue.ts` is live in the admin
  routes but not in the cron until someone runs `npm run records:worker:deploy`. Its secrets
  (`RESEND_API_KEY`, `RECORDS_ALERT_EMAIL`) are Worker secrets, separate from the site's.
  After a deploy, zero cron invocations for more than fifteen minutes has so far meant a
  Cloudflare Cron Triggers incident rather than a broken Worker — check the status page
  first. See [`docs/runbooks/records-scheduler.md`](docs/runbooks/records-scheduler.md).
- **`app_settings.records_fill_paused` is the brake on the city-wide fill.** `'1'` stops the
  fill; button, follower and refresh pulls keep running. The circuit breaker sets it and
  never clears it — a human unpauses from `/admin/records`. Deploy the Worker with it set,
  and never assume a quiet queue means the Worker is broken until you have checked the flag.
- **Preview deploys cannot exercise Turnstile or the map.** The Turnstile sitekey is not
  allowlisted for `pages.dev`, and preview has no Maps key. Verify those widgets on
  production only — a failure in preview is expected, not a bug.
- **Production migrations 0025–0027 were applied via the Cloudflare dashboard**, not
  wrangler, so wrangler does not know they ran. `0027` is a non-idempotent `DROP COLUMN`
  batch. Never blindly run `migrations apply --remote`. See `migrations/AGENTS.md`.
- **The domain is `ratemyplace.org`.** `ratemyplace.boston` does not resolve.
- **Remote D1 CLI needs `CLOUDFLARE_API_TOKEN`** in the environment, or you get a 7403.
- **`bg-coral-*` is not a Tailwind class.** Use `bg-red-*`.
- **The repo lives in a Google Drive synced folder.** The Vite watcher ignores
  `.tmp.driveupload/` so dev doesn't reload-loop. Don't remove that config.
- **Google OAuth on production is historically flaky** (Workers bot detection) while fine
  locally. Status unverified since May 2026 — see `GOOGLE_OAUTH_TROUBLESHOOTING.md`.
- **Parcel ids drop their leading zero in some Boston datasets.** `buildings.parcel_id`
  holds the canonical 10-digit form with the zero; the permits resource stores `parcel_id`
  as a number, so the zero is gone. The assessor and RentSmart adapters query both forms;
  the permits adapter uses the numeric form only because its column is numeric; the
  violation feeds have no parcel column and key on street, number, and SAM id.
- **The FY2026 assessor stores ranged addresses as `ST_NUM` plus `ST_NUM2`**, and street
  names arrive mixed-case. An exact `datastore_search` filter therefore misses `23-27
  Lanark Rd` entirely, which is why `src/lib/records/` uses the CKAN SQL endpoint with
  `upper()` and checks both number columns.
- **The violation and code-enforcement feeds drop street directionals** and store ranges
  split across a low and a high column (`violation_stno` / `violation_sthigh`), where the
  high column doubles as the letter of a lettered number. Matching strips the directional,
  so `84 E Newton St` and `84 W Newton St` collide; the zip predicate narrows that and the
  correction workflow is the escape hatch.
- **311 is sixteen yearly resources plus a new-system resource with a different schema.**
  The legacy files keep the address as free text in `location`; the new one splits it into
  `street_number` / `street_name` / `zip_code`. A retired legacy resource id fails every
  pull until someone updates `LEGACY_311_RESOURCES`; it does not clear on its own.
- **CKAN rejects `ESCAPE '\'`** with `HTTP 409 Query is not a single statement`. LIKE
  clauses against `data.boston.gov` use `ESCAPE '!'` instead. See `src/lib/records/ckan.ts`.
- **Seeded buildings** (`buildings.source = 'seed'`, ids `seed-<parcel>`) come from
  `npm run records:seed`, which is idempotent and applied by hand. Never regenerate slugs
  for them; the slug is the public URL.
- **Public records are never fetched on a public page view.** Pulls are admin-triggered and
  stored in D1; the panel reads only what was stored. Lazy pull-on-view is permanently
  rejected: it is an amplification vector and ties page latency to a third-party API.
- **Two admin paths pull synchronously; everything else is the Worker's.** The admin pull
  button (`src/pages/api/admin/buildings/[id]/records/pull.ts`) and the correction re-pull
  (`src/pages/api/admin/records/corrections/[id]/repull.ts`) call `pullBuildingRecords`
  inside the request and answer with the summary — an admin is waiting on their own click,
  and both are rate-limited and audited. Every `records_queue` row is pulled by the companion
  Cron Worker on a later minute tick instead, never by a request; the admin retry endpoint
  un-parks a row rather than pulling it (it refuses a row whose lease is still live with a
  409); and the reader-facing button (`src/pages/api/records/request.ts`) enqueues a `button`
  row rather than pulling. So
  "I clicked it and nothing happened" is expected for up to a minute on anything queued — but
  not on those two admin buttons, which either return a summary or fail in front of you.
- **Search is not reviewed-only any more, but browse and the map are.**
  `buildingSearchWhere` / `buildingSearchSelect` / `BUILDING_SEARCH_ORDER` in
  `src/lib/searchSql.ts` are the only spelling of the query-mode buildings query, shared by
  `src/pages/search.astro` and `src/pages/api/search/results.ts` so a seeded Boston page
  cannot appear on one and not the other. Browse mode (no query), the landlord queries and
  `src/pages/api/buildings/map.ts` keep their `HAVING COUNT(r.id) > 0`.
  `recordsSearchParity.test.ts` fails if either call site stops using the fragments or if
  the browse-mode and landlord counts change.
- **`/sitemap.xml`, `/sitemaps/*.xml`, and `/robots.txt` are D1-backed routes** in
  `src/pages/`, not files in `public/`. The static-page allowlist is `STATIC_SITEMAP_PATHS`
  in `src/lib/sitemap.ts`; a new public page is not in the sitemap until it is added there.
- **Never call `turnstile.reset()` from a callback that submits.** A reset re-runs the
  challenge, which re-fires the callback, which submits again — an unbounded POST loop
  against your own endpoint. Tokens are single-use, so a stale one has to go somehow: reset
  on the next press instead (`renderWidget` in
  `src/components/records/RecordsRequestButton.tsx`, whose success callback posts), or after
  a failed POST only where the callback merely stores the token —
  `src/components/records/RecordCorrectionForm.tsx` is that shape. Either way, gate a
  submitting callback on a press flag so an auto-solve cannot post on its own.
- **`buildings.updated_at` feeds sitemap `lastmod`.** Do not bump it on a no-op write; a
  write-through that stamps nothing new would move a page's date for every crawler with no
  content change behind it. `POST /api/buildings` only stamps a matched row when it has
  something to add and the row lacks it.
- **An `_`-prefixed file under `src/pages/` is not a route.** Astro excludes it from
  file-based routing, which is how `src/pages/api/admin/records/queue/_json.ts` can be a
  shared helper next to the endpoints that import it. The rule cuts the other way for
  Markdown: any `.md` under `src/pages/` **is** routed and served as a public page, which is
  why there is no nested `AGENTS.md` in that tree.

## Pre-deploy QA

Before any production deploy, walk every user-facing flow the change touches. If the
change affects displayed data, check **every** view that data appears in — search results,
property detail, admin panel, user profile — not just the page you edited.

1. **Display & UI** — overflow, leaked snake_case field names, `undefined`/`null`/`NaN`,
   layout at 375 / 768 / 1280px.
2. **Data consistency** — same counts and scores everywhere; spot-check three properties;
   confirm all views update after an add/edit/delete.
3. **Empty & edge states** — no results, empty query, zero-review property, invalid form
   input, very long text.
4. **Security** — exposed keys or internal IDs in HTML/JS, direct-URL access to auth and
   admin routes, parameterized queries, error responses that leak internals.
5. **Search & filter** — expected results, correct narrowing, sorting, pagination,
   accurate counts.

Always run this after changes to database queries, scoring, search, shared components, or
when adding an endpoint.

*(Claude Code has this wired as the `/qa` skill. Other agents: run the checklist manually.)*

## Documentation map

| Doc | Role |
|-----|------|
| [`MASTER.md`](MASTER.md) | **Canonical product spec** — mission, ethics, full rating instrument, privacy model, verification, moderation policy |
| [`brand.md`](brand.md) | Brand handbook v1.4 — voice, color, typography, component fingerprint. Accurate and implemented. A separate brand bible v1.0 outranks it where they disagree |
| [`ARCHITECTURE.md`](ARCHITECTURE.md) | Technical architecture reference |
| [`SECURITY.md`](SECURITY.md) | Security policy |
| `.planning/` | Milestone system — `STATE.md`, `ROADMAP.md`, `PROJECT.md`, per-milestone requirements and audits |
| `.planning/audits/csrf-2026-04.md` | The CSRF posture audit. Read before adding any endpoint |

**Staleness warning:** `CLAUDE_CONTEXT.md` and `VERSION.md` are stale (v1.1.0-alpha era,
January 2026) and `.planning/STATE.md` is accurate only through April 2026. Trust the code
and this file over those. When a doc and the source disagree, **the source wins** — verify
before relying on any line-level specific in a doc.
