# Pitfalls Research

**Domain:** Retrofitting security hardening, validation, CSRF, async email, D1 indexes, and component refactors to a live production Astro + Cloudflare Pages app
**Researched:** 2026-04-26
**Confidence:** HIGH (based on direct codebase inspection; retrofit-specific risks from verified Cloudflare Workers documentation patterns)

---

## Critical Pitfalls

### Pitfall 1: Rate Limit False Positives Block Legitimate Users on First Deploy

**What goes wrong:**
The `checkRateLimit` function in `rateLimit.ts` is fail-closed: if D1 returns an error, the function returns `allowed: false` with a 503. This is the correct security posture (v1.2.2 decision). But when adding rate limits to new endpoints — specifically `bug-reports` and `search.astro` — the thresholds set in the first deploy are the live thresholds with no ability to tune them without a redeployment. Setting them too low (e.g., 5 bug reports per hour) blocks a legitimate user who submits on behalf of multiple household members. Setting `search` too low blocks a user who quickly tries several query variations.

**Why it happens:**
Greenfield implementations set thresholds conservatively with no traffic baseline. Retrofit implementations set thresholds against a live app with real usage patterns but no instrumentation to know what those patterns actually are. The existing implementation has zero rate-limit observability: there is no logging when a limit fires, only when D1 fails (`rate_limit_db_failure` in signin). Hitting 429 on a production endpoint leaves no Cloudflare log to diagnose.

**How to avoid:**
1. Before implementing rate limits on `bug-reports` and `search`, add structured logging to the `allowed: false` path in `checkRateLimit` (not just the `error: true` path). Log the endpoint, the key, and the current count. Review Cloudflare logs for 24 hours post-deploy.
2. Set initial thresholds conservatively high, then tighten. For `bug-reports`: start at 10/hour (current contact is 3/hour — bug reports are anonymous and lower-friction). For `search.astro`: start at 200/minute per IP. Note that `search.astro` is an SSR page doing DB queries directly, not an API route — a rate limit must be implemented in the page's frontmatter or a middleware check, not just in an API handler.
3. Include `Retry-After` header on all 429 responses. The `disputes.ts` and `signin.ts` routes do this correctly. `contact.ts` does not — it returns 429 without `Retry-After`. Fix this inconsistency during the retrofit.

**Warning signs:**
- Cloudflare analytics show a spike in 429s after deploy
- User reports they cannot submit a form they haven't submitted before
- `rate_limits` table grows faster than expected (check via admin or D1 console)

**Phase to address:**
Phase that adds rate limiting to `bug-reports` and `search`. Add Cloudflare log alerting for 429 responses before ship. Do NOT gate `search.astro` rate limiting on the API rate-limit helper — the page is SSR and runs in the same Worker request; implement it identically to how `contact.ts` does it (pull DB from runtime, call `checkRateLimit` before the main query block).

---

### Pitfall 2: `waitUntil` Not Available on Context Path Assumed During Retrofit

**What goes wrong:**
The async email pattern (fire-and-forget via `ctx.waitUntil`) requires access to `runtime.ctx.waitUntil`. This is declared in `env.d.ts` as `App.Platform.ctx: ExecutionContext`. However, `ctx` is on the `runtime` object accessed via `(context.locals as any).runtime`, not on `context.locals` directly. The current pattern for getting `runtime` is `(context.locals as any).runtime`, and `runtime.ctx` would be `runtime?.ctx`. But in Astro Pages adapter for Cloudflare, the actual property path exposed to SSR pages differs from what `env.d.ts` declares: the `runtime` shape from `@astrojs/cloudflare` adapter is `{ env, cf, ctx }` but this is accessed as `(context.locals as any).runtime` which is actually `Astro.locals.runtime` — the entire `App.Platform` object. So `runtime.ctx.waitUntil` is the correct path, but zero code in the codebase currently accesses `runtime.ctx` at all, meaning this has never been tested in production.

A specific failure mode: on a Cloudflare Pages cold start, if `runtime.ctx` is undefined (platform not yet initialized, or test/dev environment), calling `runtime.ctx.waitUntil(emailPromise)` throws a TypeError that kills the entire request, blocking the response completely — exactly the opposite of the desired fire-and-forget behavior.

**Why it happens:**
Developers pattern-match from Node.js background task idioms without verifying the exact Cloudflare Workers contract. `waitUntil` is not available in all execution environments — specifically not in Cloudflare Pages local dev (Wrangler simulates it but behavior differs), and not guaranteed if `ctx` is missing.

**How to avoid:**
1. Gate every `waitUntil` call: `if (runtime?.ctx?.waitUntil) { runtime.ctx.waitUntil(emailPromise); } else { await emailPromise; }` — this falls back gracefully to synchronous send in dev/test environments where `ctx` is unavailable.
2. Add a test that calls the email-sending path with a mock runtime where `ctx` is undefined. Verify the response still returns 200.
3. Keep the existing best-effort `.catch()` wrapping on the email promise when passed to `waitUntil`. A `waitUntil` promise that rejects does not crash the worker, but unhandled rejection logging in Cloudflare is noisy and hard to correlate.

**Warning signs:**
- `TypeError: Cannot read properties of undefined (reading 'waitUntil')` in Cloudflare Functions logs
- API response times get worse after the async email retrofit instead of better (means `waitUntil` is not being reached and sync path is running)
- Local dev email sends stop working after the change (mock environment may not stub `ctx`)

**Phase to address:**
Phase implementing async email. Must include: (a) a null guard wrapper function — e.g., `function fireAndForget(ctx, promise)` in `lib/email.ts` that handles the `ctx` check, (b) a unit test with `runtime.ctx = undefined`, (c) a manual Cloudflare Pages deploy verification that email fires without blocking response time.

---

### Pitfall 3: CSRF Token Breaks Google OAuth Callback

**What goes wrong:**
The Google OAuth callback at `/api/auth/google/callback` is a GET handler that creates a session by reading from cookies and URL params. It is not a form POST. Adding a blanket CSRF middleware that requires a CSRF token on all session-creating requests would break this endpoint because: (1) it is a GET, not a POST, (2) the CSRF-protection mechanism for OAuth is the state cookie (already correctly implemented — `oauth_state` is set as `httpOnly`, `secure`, `sameSite: lax`), and (3) there is no frontend opportunity to inject a CSRF token into a Google redirect.

A separate but related risk: if CSRF remediation involves changing session cookie `sameSite` from `lax` to `strict`, the Google OAuth callback will stop working. The callback is a cross-site redirect from `accounts.google.com` back to `ratemyplace.org`. With `SameSite=Strict`, the session cookie set just after the OAuth exchange would not be sent on the first navigation request from Google's domain to ratemyplace.org, leaving the user in a logged-out state despite a successful OAuth flow.

**Why it happens:**
CSRF retrofits often try to be comprehensive — "add CSRF protection to everything that changes state" — without accounting for OAuth flows that specifically depend on cross-site redirects. The `SameSite=Lax` default on Lucia session cookies is correct for this app. Strict would break OAuth.

**How to avoid:**
1. Do not change `sameSite` on the Lucia session cookie from `lax` to `strict`. The current setting is already in `src/lib/auth.ts` (via sessionCookie attributes) and `src/middleware.ts` (explicit `sameSite: 'lax'`). Leave both as-is.
2. The existing OAuth CSRF protection (state cookie) is correct. Do not add a second CSRF layer on top of the GET callback.
3. If adding a CSRF token to POST endpoints, apply it only to `application/json` and `multipart/form-data` POST routes. Scope the middleware to: `/api/reviews`, `/api/reviews/[id]`, and any other authenticated POST endpoints. Exempt: `/api/auth/google/callback`, `/api/auth/signin`, `/api/auth/signup` (Turnstile serves as the bot-protection layer here).
4. Verify CSRF protection audit conclusion before implementing tokens at all: the app's mutation endpoints require auth (session cookie, `SameSite=Lax`). A cross-site form POST cannot include the session cookie under `SameSite=Lax` unless it is a top-level navigation. Review actual risk before retrofitting token-based CSRF on top of existing controls.

**Warning signs:**
- Google OAuth login works in dev but produces a logged-out state in production after CSRF changes
- 403 errors on the OAuth callback endpoint after deploying CSRF middleware
- Session cookie missing from OAuth-initiated requests in browser DevTools

**Phase to address:**
Phase doing CSRF audit. Start with the audit conclusion: is the current `SameSite=Lax` + Turnstile posture sufficient? If yes, document why and close the finding without adding tokens. If CSRF tokens are added, do not add them to auth routes, and include an E2E test that completes a full Google OAuth flow (or mock it) to verify the callback path still works.

---

### Pitfall 4: Input Validation Retrofit Breaks Existing Valid Submissions

**What goes wrong:**
`validation.ts` validates `ReviewFormData` but the review submission endpoint (`/api/reviews.ts`) parses `FormData` independently — it does not call `validateReviewForm()`. The validation function checks a `scores` subobject, but the API endpoint reads scores individually from formdata (`formData.get('unit_pests')`). They are not wired together. Adding strict validation to the API endpoints risks rejecting reviews that the current frontend submits successfully, if the validation logic diverges from what the form actually sends.

Specific known gap: `validation.ts` has a legacy `scoreFields` list (12 v1 fields: `building_quality`, `maintenance`, etc.) that does not match the 27-item v2 survey fields now used. If a validation retrofit copies this list, it will not validate any of the real 29 survey items in production.

**Why it happens:**
Validation logic in `validation.ts` was written to validate a `ReviewFormData` interface that was kept synchronized with an earlier version of the form. The API endpoint grew independently. There is no compile-time enforcement that the validator and the API handler agree on field names.

**How to avoid:**
1. Before retrofitting any input validation, do a diff between: (a) every field read from `formData` in `/api/reviews.ts`, (b) every field in `ReviewFormData` in `types.ts`, (c) every field in `validateReviewForm` in `validation.ts`. The three must agree before adding validation calls.
2. The `ALL_SCORE_FIELDS` constant in `scoring.ts` is the authoritative list of 29 survey fields. Any input validation on review scores must iterate `ALL_SCORE_FIELDS`, not the 12-field legacy list in `validation.ts`. Update `validation.ts` to import and use `ALL_SCORE_FIELDS`.
3. Add max-length validation for free-text fields (`review_title`, `review_text`, `comments`) to the API endpoint, but verify against the frontend character limit already enforced in the form. If the form allows 2000 chars and the API now rejects > 1000, existing reviews submitted before the limit will fail on edit.
4. For numeric coercion: `rent_amount` is currently parsed via `parseInt()` which returns `NaN` for non-numeric input. `NaN` inserted into D1 becomes NULL. Add explicit `isNaN` checks, but do NOT make rent_amount required — it is optional and many users skip it.

**Warning signs:**
- Review form submissions return 400 after validation retrofit
- "Validation failed" errors in production with no corresponding user-visible error because the frontend does not display all `details` fields
- `validateReviewForm` test suite passes but live submissions fail (indicates the form and the validator diverge)

**Phase to address:**
Phase adding input validation to POST endpoints. Prerequisite step: audit the three sources of truth (form fields, API formData reads, validation function) and reconcile them before writing any new validation logic. Write unit tests against the validation function first, then wire it into the endpoint.

---

### Pitfall 5: D1 `ALTER TABLE` Limitations Block Migration Strategy

**What goes wrong:**
D1 (SQLite) does not support `ALTER TABLE ... ADD COLUMN ... NOT NULL` without a `DEFAULT` clause. Any attempt to add a required column without a default will fail with `Cannot add a NOT NULL column with no default value` on a table that already has rows. This is a known SQLite constraint (not just a D1 limitation). Any index migration that accidentally introduces a NOT NULL column (e.g., a developer writes `ADD COLUMN city TEXT NOT NULL`) will fail silently during `npx wrangler d1 migrations apply --local` only if the local DB is freshly seeded; it will fail loudly on production where the table has real rows.

Additionally, `CREATE INDEX` statements on D1 production may take several seconds on large tables. D1 does not support `CREATE INDEX CONCURRENTLY` (that is a Postgres feature). Index creation blocks writes on the affected table for its duration. For the `buildings` table (current index candidate: `neighborhood`, `city`, `building_type`), this is low risk at current data volume. For the `rate_limits` table, which receives writes on every request, index creation during peak traffic is higher risk.

**Why it happens:**
Developers write migrations locally against a freshly created schema with no rows, then apply to production against a table with data. The local migration succeeds (empty table accepts any column definition), the production migration fails.

**How to avoid:**
1. Rule: every new column in a migration must have a `DEFAULT` clause or be added as `NULL` (i.e., no `NOT NULL` constraint). Enforce this as a review checklist item.
2. For index additions to `rate_limits`: apply during off-peak hours (Sunday early morning; the site has minimal traffic). The current `rate_limits` table has `expires_at` and `rate_key` — if adding an index on `expires_at` to speed up the cleanup `DELETE`, this is the highest-traffic column. Apply this migration outside business hours.
3. Test every migration against the seeded local database (`npm run db:seed` before `npx wrangler d1 migrations apply --local`), not an empty schema. The seeder provides realistic data volume to catch performance issues.
4. Never drop columns in a migration unless you've confirmed zero code references that column. The dual `had_pests`/`had_pest_issues` cleanup is in scope for v1.5.0 — the migration must set `had_pest_issues = 1 WHERE had_pests = 1` BEFORE dropping `had_pests`, and it must be a single transaction-like migration sequence (SQLite has no multi-statement transactions in D1 migration files).

**Warning signs:**
- Migration `apply --remote` fails with "Cannot add NOT NULL column"
- Wrangler reports migration applied successfully locally but remote apply hangs
- `SELECT COUNT(*)` on `rate_limits` shows rows accumulating without cleanup (indicates a missing index on `expires_at` is hurting the DELETE cleanup query)

**Phase to address:**
Phase doing D1 index audit. Migration checklist: (1) run migration against seeded local DB first, (2) check EXPLAIN QUERY PLAN on the search queries in `search.astro` to confirm indexes are hit, (3) apply production index migrations during lowest-traffic window, (4) verify via D1 query performance metrics in Cloudflare dashboard post-deploy.

---

### Pitfall 6: Partial Runtime Wrapper Migration Leaves a Mixed-Typing Minefield

**What goes wrong:**
There are 71 instances of `(context.locals as any).runtime`. A partial migration — where 30 are converted to the typed wrapper and 41 remain as `any` casts — is worse than no migration. Two reasons:
1. If the typed wrapper gets the shape wrong (e.g., `env` is typed as `Record<string, string>` but a consumer expects `D1Database`), TypeScript reports errors on the converted sites but passes on the `any` sites. The type error is hidden half the time.
2. After partial conversion, future developers copying code from an unconverted file perpetuate the `any` pattern. The goal of the migration is lost.

The current `env.d.ts` already has the correct shape via `App.Platform`:
```
env: { DB: D1Database; VERIFICATION_BUCKET: R2Bucket; TURNSTILE_SECRET_KEY: string; }
ctx: ExecutionContext;
```
But it omits the env vars accessed at runtime: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_MAPS_API_KEY`, `GOOGLE_PLACES_API_KEY`, `RESEND_API_KEY`, `SITE_URL`. A typed wrapper that only exposes what is in `env.d.ts` will cause TypeScript errors at all the sites that access those vars, forcing developers to add `as any` right back to get past the type error.

**Why it happens:**
Typed wrapper shape is scoped to what's formally declared, not what's actually used. Secret env vars (keys, URLs) are not declared in `env.d.ts` because they are not bindings — they are Cloudflare Pages secrets that appear at runtime but are not in `wrangler.jsonc`.

**How to avoid:**
1. Before writing a single line of the typed wrapper, audit every `runtime.env.SOMETHING` access across all 71 sites. The full set of env var names is: `DB`, `VERIFICATION_BUCKET`, `TURNSTILE_SECRET_KEY`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_MAPS_API_KEY`, `GOOGLE_PLACES_API_KEY`, `RESEND_API_KEY`, `SITE_URL`. Update `env.d.ts` `App.Platform.env` to include all of these before writing the wrapper.
2. The wrapper function must be a complete drop-in for every use site. Recommended shape:
   ```typescript
   export function getRuntime(locals: App.Locals & { runtime?: App.Platform }): App.Platform {
     const runtime = (locals as any).runtime;
     if (!runtime) throw new Error('Cloudflare runtime not available');
     return runtime as App.Platform;
   }
   ```
   This keeps the `any` cast in one place and types every call site correctly.
3. Do the migration in a single PR, not incrementally. 71 sites is a find-and-replace operation. A script using `sed` or a TypeScript codemod can mechanically replace `(context.locals as any).runtime` with `getRuntime(context.locals)`. Do not hand-edit 71 files — that introduces bugs.
4. After migration, add a `no-explicit-any` ESLint rule that flags `as any` in API routes specifically. This prevents regression.

**Warning signs:**
- TypeScript build passes but at runtime gets `Cannot read properties of undefined` on a typed `runtime.env.RESEND_API_KEY` because it was not added to `App.Platform.env`
- Partial migration causes `git diff` to show some files converted and some not, making future code review harder
- `getRuntime()` is called from a context where `locals.runtime` is undefined (unit test environment without Cloudflare simulation)

**Phase to address:**
Phase doing typed runtime wrapper. First commit: update `env.d.ts` with full env var list. Second commit: write `getRuntime()` wrapper and update `lib/db.ts` and `lib/rateLimit.ts` and `lib/audit.ts` (the core lib files). Third commit: mechanical replacement of all 71 API route call sites. Verify build passes before merging.

---

### Pitfall 7: Component Split Breaks React Hydration Boundary

**What goes wrong:**
`ReviewEditForm.tsx` (907 lines) is used as a `client:load` island in an Astro page. Splitting it into sub-components (e.g., `ReviewEditFormUnit.tsx`, `ReviewEditFormBuilding.tsx`) introduces new hydration boundaries if any sub-component is itself declared as a separate island. The failure mode: a sub-component that manages state (e.g., the current step indicator or score state) re-renders independently from the parent, losing shared state. More concretely: if step state lives in the parent and a child sub-component is separately hydrated, the child may receive stale props on first render while hydration is pending.

For `BuildingsTable.tsx` (844 lines) and `ReviewsTable.tsx` (733 lines), the risk is different: these components manage filter state, sort state, and pagination state. If filtering logic is extracted into a custom hook and the hook's initial state depends on URL search params (e.g., preserving filter state on page reload), the hook must initialize from the URL before the component first renders — otherwise the table flashes unfiltered content before the filter applies.

**Why it happens:**
Large component splits in React island architectures are done thinking about code organization, not about Astro's hydration model. Each `client:load` component gets its own hydration pass. Shared state between separately-hydrated components is only possible through lifting state to a common parent or a context provider — both require the parent to also be a React island.

**How to avoid:**
1. Keep all split sub-components as internal React components (not separate Astro islands). Export only the root component from each file. The split is purely for maintainability, not for independent hydration.
2. The parent component (`ReviewEditForm`, `BuildingsTable`, `ReviewsTable`) remains the single `client:load` entry point. Sub-components are imported as regular React components within the same module graph.
3. Before splitting, verify how each component receives its initial data: from Astro props (SSR), from URL params, or from an API call. State that initializes from URL params must be read via `window.location.search` or a custom hook that reads the URL — not from an Astro prop that is only available at SSR time.
4. After splitting, verify that stale event handler references do not occur: if a sub-component holds a callback from a parent via props, and the parent re-renders with a new callback, the sub-component must receive the new callback. This is standard React behavior but large components sometimes use closure references over `useRef` patterns that break under extraction.

**Warning signs:**
- After split, a filter change in `BuildingsTable` causes the table to reset to page 1 unexpectedly (stale closure on pagination handler)
- Review edit form loses score data when navigating between steps after the split (step state not shared correctly between sub-components)
- TypeScript reports no errors but the browser shows React key warnings or hydration mismatch warnings in console

**Phase to address:**
Component refactor phase. Mandatory: run the full E2E suite after each file's split. Do not split all three files in one PR — split one, verify E2E, merge, repeat. The ReviewEditForm split is highest risk because it is a multi-step form with complex interdependent state. Split BuildingsTable or ReviewsTable first to build confidence.

---

## Technical Debt Patterns

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| Copy-paste `checkRateLimit` call pattern into each endpoint without abstraction | Fast to ship per-endpoint rate limiting | Different endpoints accidentally get different error response formats (contact.ts already omits `Retry-After` header) | Never — extract a shared `applyRateLimit(db, context, endpoint, max, window)` helper that handles the 429/503 response itself |
| Add validation as inline if-blocks in each API endpoint | Requires no refactoring | Validation logic diverges across endpoints; no single test suite covers it | Only acceptable for a single new endpoint with no analogous endpoints — not for a cross-cutting retrofit |
| Skip CSRF analysis and add CSRF tokens to all POST routes | Feels comprehensive | Breaks OAuth callback path; adds frontend complexity for no practical security gain if SameSite+Turnstile already covers the risk | Never without completing the threat model analysis first |
| Migrate only the "easy" 30 of 71 `any` casts | Reduces PR size | Partial migration is permanent; the remaining 41 are never cleaned up in practice | Never — do all 71 in one PR or defer the entire migration |
| Fire-and-forget email without null guard on `runtime.ctx` | Simple code change | Silent failure in dev/test; TypeErrors in cold-start edge cases | Never in production without the null guard |

---

## Integration Gotchas

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| Cloudflare `waitUntil` | Calling `runtime.ctx.waitUntil()` without checking that `runtime.ctx` exists | Guard: `if (runtime?.ctx?.waitUntil) { runtime.ctx.waitUntil(p) } else { await p }` |
| Cloudflare `waitUntil` | Passing a promise that does not have a `.catch()` handler — unhandled rejection logs appear in Cloudflare dashboard | Always wrap: `runtime.ctx.waitUntil(emailPromise.catch(err => logError(...)))` |
| D1 `checkRateLimit` in SSR pages | Calling `checkRateLimit` in an Astro `.astro` file frontmatter where the response is returned by `Astro.redirect()` — need to verify the redirect path also returns the 429 response correctly | In SSR pages, return `new Response(...)` with status 429 from the frontmatter using `Astro.response` pattern, or redirect to an error page; do not silently swallow the rate limit |
| Google OAuth + SameSite cookies | Setting session cookie to `SameSite=Strict` during CSRF hardening | Leave Lucia session cookie as `SameSite=Lax`; the OAuth flow requires cross-site redirect to complete successfully |
| Resend email + `waitUntil` | Assuming Resend client SDK handles retries internally | It does not retry on transient errors; if fire-and-forget is critical, add one manual retry with exponential backoff before passing to `waitUntil` |
| D1 index creation | Running `CREATE INDEX` on `rate_limits` during peak traffic | Apply during off-peak; the table is write-heavy and index creation will briefly lock writes |

---

## Performance Traps

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| `LIKE '%query%'` search without FTS or index | Search slows proportionally as `buildings` and `landlords` tables grow; full table scans on every search | Add composite index on `(address, neighborhood)` and `(name)` or migrate to D1 FTS (experimental) | Noticeable at ~5,000 buildings; critical at 50,000 |
| Rate limit cleanup DELETE on every request | Every `checkRateLimit` call issues a `DELETE FROM rate_limits WHERE expires_at < ?` before the count query — two D1 round trips per rate-limited endpoint | Add an index on `rate_limits(expires_at)` to speed the DELETE; consider decoupling cleanup to a scheduled Worker (Cloudflare Cron Triggers) | Currently fine at low volume; degrades as rate_limits table grows and cleanup slows |
| Sync email blocking response | Every email route (verify, forgot-password, notification) awaits Resend before returning to user | Switch to `waitUntil` fire-and-forget pattern | Already noticeable — Resend API adds 200-500ms to each response that sends email |
| Search SSR page does 4 DB queries per page load | `search.astro` does COUNT + SELECT for buildings AND COUNT + SELECT for landlords synchronously | Parallelize with `Promise.all()` on the two independent query pairs | Doubles the search response time at current scale; worse as data grows |

---

## Security Mistakes

| Mistake | Risk | Prevention |
|---------|------|------------|
| `bug-reports.ts` has Turnstile but no `checkRateLimit` | Turnstile protects against bots but not against a legitimate user (or someone with Turnstile tokens) spamming the endpoint | Add `checkRateLimit` with endpoint `'bug_report'` and limit 5/hour; existing Turnstile stays as a first layer |
| `search.astro` has no rate limiting of any kind | The page executes 4 D1 queries per request; a scraper or load test can DoS the database | Add IP-based rate limit check at the top of the SSR frontmatter using the same `checkRateLimit` helper and `getClientIP` |
| CSRF audit conclusion skipped in favor of blanket token implementation | Blanket CSRF tokens on all POST routes breaks Google OAuth callback and adds frontend complexity with marginal benefit given Turnstile + SameSite=Lax | Audit first: document the current protection (Turnstile on unauthenticated POSTs, session cookie SameSite=Lax on authenticated POSTs, state cookie on OAuth GET) and determine if a gap actually exists |
| Typed wrapper exposes only `wrangler.jsonc` bindings but not Pages secrets | After migration, `runtime.env.RESEND_API_KEY` fails TypeScript type check because `RESEND_API_KEY` is a Pages secret not a D1 binding — developer adds `as any` back, negating the whole migration | Update `App.Platform.env` in `env.d.ts` to declare all Pages secrets before starting the migration |
| Error response format drift after validation retrofit | Some endpoints return `{ error: string }` and some return `{ error: string, details: ValidationError[] }` — frontend components that only handle the first format silently drop field-level error detail | Audit every `fetch()` call in React components to confirm they handle both formats, or standardize on `{ error: string, details?: ValidationError[] }` |

---

## UX Pitfalls

| Pitfall | User Impact | Better Approach |
|---------|-------------|-----------------|
| Adding stricter input validation without updating frontend error messages | User sees "Validation failed" with no indication of which field is wrong (backend returns `details` array but form only shows `error` string) | Before adding backend validation, verify the frontend form renders `details[].message` per field; ReviewForm and ContactForm both need audit |
| Rate limit 429 with no `Retry-After` header (contact.ts currently missing this) | User hits "Too many submissions" with no idea when they can retry; some users will assume the form is broken | All 429 responses must include `Retry-After` header; frontend forms should surface "Try again in X minutes" from this header |
| EmptyState component inconsistency across pages | New users see different empty state messages depending on which page they land on first; undermines trust | Build `EmptyState` component before or alongside the component refactor phase to ensure the 3 large components use it consistently |

---

## "Looks Done But Isn't" Checklist

- [ ] **Rate limiting on bug-reports**: `checkRateLimit` import added, but `Retry-After` header missing on 429 response — verify header is present in all rate-limited endpoints
- [ ] **Async email via waitUntil**: email function updated to pass promise to `waitUntil`, but null guard on `runtime.ctx` missing — verify `runtime?.ctx?.waitUntil` guard exists before every `waitUntil()` call
- [ ] **CSRF audit complete**: CSRF finding marked resolved, but the actual audit conclusion (threat present or not) is not documented — verify a written decision exists stating whether CSRF tokens are needed and why
- [ ] **Typed runtime wrapper**: all 71 `(context.locals as any).runtime` casts replaced, but `env.d.ts` still missing Pages secrets — verify `App.Platform.env` lists every env var accessed at runtime, not just wrangler.jsonc bindings
- [ ] **D1 index migrations**: `CREATE INDEX` statements added to migration file, but never verified against actual query execution plan — verify `EXPLAIN QUERY PLAN` on search queries shows index scan, not full table scan
- [ ] **Component split complete**: large component extracted into sub-components, but the Astro page still uses `client:load` on a now-deleted component name — verify the import path in every `.astro` page that uses the split component
- [ ] **Input validation retrofit**: validation added to API endpoints, but `validation.ts` still references the 12 legacy v1 score fields instead of `ALL_SCORE_FIELDS` — verify the validator uses the current 29-item field list
- [ ] **Error format consistency**: validation now returns `{ error, details }` but frontend `fetch` handlers in React components only read `data.error` — verify every form component surfaces field-level validation errors from `details`

---

## Recovery Strategies

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| Rate limit thresholds too low, users blocked in production | LOW | Deploy a new build with increased thresholds; no DB schema change needed; rate_limits table auto-expires via TTL |
| `waitUntil` TypeError crashes API responses after async email retrofit | MEDIUM | Revert the async email change via git revert deploy; add null guard; redeploy; takes one deploy cycle (5-10 min on Cloudflare Pages) |
| CSRF token implementation breaks Google OAuth login | HIGH | Immediate revert required — OAuth is the primary auth path for most users; deploy revert within minutes; then re-approach with OAuth-exempt scope |
| D1 migration fails on production (NOT NULL column) | LOW | D1 migration failures do not corrupt the database — the migration is rejected. Roll back the migration file, fix the column definition, redeploy |
| D1 migration fails mid-apply (partial index creation) | LOW | D1 migrations are not transactional for DDL. If `CREATE INDEX` fails midway, check D1 console for current schema state, then write a compensating migration |
| Typed wrapper migration causes TypeScript errors on deploy | LOW | TypeScript errors block the Astro build, so the broken build does not ship. Fix the env.d.ts declarations and rebuild |
| Component split breaks E2E tests | MEDIUM | E2E suite catches this before production if run pre-deploy (as mandated by CLAUDE.md QA process). Revert the component split for the broken component; split other components first |
| Input validation rejects valid existing data in edit flow | MEDIUM | Any review submitted before the new length limits was valid under old rules. Must grandfather: validate `max_length` only on new submissions (create), not on edit if the existing value exceeds the limit; or increase the limit to cover historical data |

---

## Pitfall-to-Phase Mapping

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| Rate limit false positives on bug-reports and search | Rate limiting + input validation phase | Check Cloudflare 429 analytics 24h post-deploy; confirm `Retry-After` header in network tab |
| `waitUntil` TypeError on null ctx | Async email phase | Unit test with `runtime.ctx = undefined`; Cloudflare Pages deploy smoke test confirming email fires without blocking response |
| CSRF retrofit breaks Google OAuth | CSRF audit phase — audit before implementing | E2E test completing full auth flow (sign in with Google mock); check Playwright test still passes with any CSRF changes applied |
| Validation retrofit breaks existing form submissions | Input validation phase | Smoke test review create and review edit flows with production-realistic data; run E2E review.spec.ts suite before merge |
| D1 migration NOT NULL failure | D1 index phase | Run `npx wrangler d1 migrations apply --local` against seeded local DB before any `--remote` apply |
| Partial typed wrapper migration | Typed runtime wrapper phase — do all 71 in one PR | `grep -r '(context.locals as any).runtime\|locals as any).runtime' src/` returns zero matches after migration |
| Component split hydration issue | Component refactor phase — split one file per PR, E2E between each | Full Playwright E2E suite green after each component is split; manual test of multi-step ReviewEditForm before/after |

---

## Sources

- Direct codebase inspection: `src/lib/rateLimit.ts`, `src/pages/api/contact.ts`, `src/pages/api/disputes.ts`, `src/pages/api/bug-reports.ts`, `src/pages/api/auth/google/callback.ts`, `src/lib/auth.ts`, `src/middleware.ts`, `src/env.d.ts`, `wrangler.jsonc`
- `.planning/codebase/CONCERNS.md` audit (2026-04-26)
- Cloudflare Workers `ExecutionContext.waitUntil()` — [developers.cloudflare.com/workers/runtime-apis/context](https://developers.cloudflare.com/workers/runtime-apis/context/) (verified: `waitUntil` keeps the worker alive after response is returned; requires `ExecutionContext` passed from `fetch` handler event)
- Cloudflare Pages Functions and `@astrojs/cloudflare` adapter runtime shape — `App.Platform.ctx` is the `ExecutionContext`
- SQLite `ALTER TABLE` constraints (official SQLite docs): NOT NULL without DEFAULT is rejected on non-empty tables — identical behavior in D1
- Lucia v3 session cookie defaults: `SameSite=Lax` is the default; `SameSite=Strict` breaks cross-site OAuth redirects (Lucia docs: [lucia-auth.com/guides/oauth/basics](https://lucia-auth.com/guides/oauth/basics))
- `@astrojs/cloudflare` adapter runtime access pattern: `(context.locals as any).runtime` is the current access path per adapter docs for Astro 5 SSR

---
*Pitfalls research for: v1.5.0 "Closed Loops" — security hardening retrofit on live production app*
*Researched: 2026-04-26*
