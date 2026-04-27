# Stack Research

**Domain:** Security hardening + validation + async email — v1.5.0 "Closed Loops" additions to existing Astro 5 / Cloudflare Workers app
**Researched:** 2026-04-26
**Confidence:** HIGH (all key claims verified against official docs and primary sources)

---

## Context: What This Research Covers

The existing stack (Astro 5, Cloudflare D1, Lucia v3, Resend, Vitest, Playwright, Tailwind 4) is locked and validated. This research covers only the *additions and changes* needed for v1.5.0:

1. Input validation library decision (introduce Zod/Valibot vs. extend `validation.ts`)
2. CSRF protection: what Lucia v3 and Astro v5 actually provide vs. what gaps remain
3. `waitUntil` for fire-and-forget email on Cloudflare Workers (how to access from Astro v12 adapter)
4. D1 index audit tooling (what queries to run)
5. Rate limit application pattern (no new library — infrastructure exists)

---

## Finding 1: Input Validation — Extend validation.ts, No New Library

**Decision: Do NOT add Zod or Valibot. Extend `src/lib/validation.ts`.**

### Rationale

The existing `validation.ts` already handles the review form (the most complex validation in the app). The remaining gaps are simpler endpoints: `/api/bug-reports`, `/api/disputes`, `/api/contacts` — all of which do inline ad-hoc validation today. These need:

- Max-length enforcement on text fields (already the pattern in `validation.ts`)
- Type coercion guards (string/number checks already in signin.ts pattern)
- Email format validation (one regex or simple `includes('@')` already used)

Zod v3 adds ~17 KB minified (gzipped: ~8–9 KB). Valibot v1.3.1 is ~1–2 KB tree-shaken — meaningfully smaller but still a new dependency with a new API to learn. Neither provides capability that `validation.ts` cannot provide with modest additions.

**The real gap is coverage, not capability.** Adding a library solves the wrong problem and creates integration friction with the existing `ValidationError[]` return shape that API routes already consume.

### What to add to validation.ts instead

```typescript
// Add these validators alongside validateReviewForm():

export function validateContactForm(data: unknown): ValidationError[]
export function validateDisputeForm(data: unknown): ValidationError[]
export function validateBugReport(data: unknown): ValidationError[]

// Add shared primitives:
export function isValidEmail(value: string): boolean   // RFC-lite check
export function clampLength(s: string, max: number): boolean
```

**Validation gaps by endpoint (from CONCERNS.md audit):**

| Endpoint | Missing | Fix |
|----------|---------|-----|
| `/api/bug-reports` | No rate limit, no max on `url` field, no email format check | Add `checkRateLimit` (infrastructure exists), add `validateBugReport()` |
| `/api/disputes` | No max-length on `landlordName`, `landlordPhone`, `disputeExplanation`; no email format on `landlordEmail` | Add `validateDisputeForm()` |
| `/api/contacts` | Already has rate limit and Turnstile; email check is too weak (`includes('@')` only) | Strengthen email regex in shared `isValidEmail()` |
| `/api/search/results` | GET endpoint — rate limit at 60 req/min per IP is the real need, not schema validation | Apply `checkRateLimit` with lenient window |

**Confidence: HIGH** — based on direct code inspection of all target endpoints and `validation.ts`.

---

## Finding 2: CSRF Protection — Partial Gap, Two-Layer Fix Required

### What Astro v5 provides

Astro v5 enables `security.checkOrigin: true` by default (changed from opt-in in v4). This checks that the `Origin` header matches the request host for state-changing requests (POST, PUT, PATCH, DELETE).

**Critical limitation:** The check only fires when `Content-Type` is one of:
- `application/x-www-form-urlencoded`
- `multipart/form-data`
- `text/plain`

**`application/json` is NOT covered.** POST requests with `Content-Type: application/json` bypass `security.checkOrigin` entirely.

The current `astro.config.mjs` does not set `security.checkOrigin` explicitly, meaning it is enabled by default (Astro v5 default = `true`). However, this provides no protection for JSON API endpoints.

**Known CVE:** CVE-2024-56140 (Astro CSRF Content-Type bypass) affected versions < 4.16.17. The project is on Astro 5.16.11, which is fully patched — but only for the three covered content types. JSON remains uncovered by design.

### What Lucia v3 provides

Lucia v3 does **not** implement CSRF protection. It provides `verifyRequestOrigin()` as a utility function but does not call it automatically. Session cookies use `SameSite=Lax` (confirmed in `src/middleware.ts` line 30: `sameSite: sessionCookie.attributes.sameSite as 'lax' | 'strict' | 'none' ?? 'lax'`).

`SameSite=Lax` provides meaningful CSRF mitigation for cross-site navigations (attackers cannot trigger credentialed POST from a third-party form) but does NOT protect against:
- CORS-exploiting same-origin-ish attacks
- JSON requests from JavaScript on a malicious page (those send cookies with SameSite=Lax on cross-site `fetch` POST in some browser versions)

### Gap assessment

| Endpoint category | CSRF risk | Current protection |
|-------------------|-----------|-------------------|
| Form-based POST (Turnstile present) | Low | Turnstile + SameSite=Lax |
| Form-based POST (no Turnstile) | Medium | SameSite=Lax only |
| JSON POST (`disputes.ts`, `reviews.ts`, etc.) | Real | SameSite=Lax only |
| Authenticated JSON POST (requires session cookie) | Low-medium | Session auth acts as implicit token |

### Recommended fix: Origin header check in middleware

Add an Origin check to the Astro middleware for all state-changing requests not already protected by Turnstile. No CSRF token library needed.

```typescript
// In src/middleware.ts — before calling next():
// For POST/PUT/PATCH/DELETE on /api/* paths, verify Origin matches host
const method = context.request.method;
const isStateChanging = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method);
const isApiRoute = context.url.pathname.startsWith('/api/');

if (isStateChanging && isApiRoute) {
  const origin = context.request.headers.get('origin');
  const host = context.url.host;
  if (origin && !origin.endsWith(host)) {
    return new Response(JSON.stringify({ error: 'Forbidden' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}
```

This is the same approach Lucia v3 docs recommend via `verifyRequestOrigin()`. Implementing it directly in middleware covers all JSON POST endpoints without modifying any individual route.

**Exclude from check:** Turnstile-verified endpoints are already safe. The check can be universal (Turnstile adds defense-in-depth on top).

**Confidence: HIGH** — Astro v5 default behavior verified via official docs. Lucia CSRF behavior verified via v3 docs. SameSite behavior confirmed in `src/middleware.ts`.

---

## Finding 3: waitUntil for Fire-and-Forget Email

### How to access it in @astrojs/cloudflare v12 (current version)

The project uses `@astrojs/cloudflare@^12.6.12` with Astro 5. In v12, the Cloudflare runtime is accessed via `(context.locals as any).runtime`, and the ExecutionContext is at `runtime.ctx`. This is confirmed by `src/env.d.ts` which declares `Platform.ctx: ExecutionContext`.

**Note:** v13 (`@astrojs/cloudflare@13+`, paired with Astro 6) changes this to `Astro.locals.cfContext`. The project should NOT use `cfContext` — that would require upgrading to Astro 6.

### The fire-and-forget pattern

```typescript
// In any API route:
const runtime = (context.locals as any).runtime;
const ctx: ExecutionContext = runtime.ctx;

// Respond immediately:
const response = new Response(JSON.stringify({ success: true }), { status: 201 });

// Then fire email in background (does not block response):
ctx.waitUntil(
  sendVerificationEmail(apiKey, siteUrl, email, token).catch((err) => {
    console.error('Background email failed:', err);
  })
);

return response;
```

### Constraints and behavior

- `waitUntil` extends Worker lifetime up to **30 seconds** after the response is returned
- The 30-second window is shared across all `waitUntil` calls in the same request
- Promises that don't settle within 30 seconds are cancelled (no retry)
- Failures in one `waitUntil` do not cancel others (`Promise.allSettled` semantics)
- For email: Resend API latency is 200–500 ms — well within 30 seconds. `waitUntil` is appropriate. Cloudflare Queues would be needed only if retries or guaranteed delivery were required.

### What to change

Currently, `sendVerificationEmail` is `await`ed before returning the response in `signup.ts` (line 116). The same blocking pattern exists in `auth/forgot-password.ts` and `auth/resend-verification.ts`.

The change is: move email calls after constructing the success response, wrap in `ctx.waitUntil()`, and return early. The try/catch error handling for email already exists (best-effort pattern) — keep that inside the waitUntil promise.

**No new library or npm package required.** `ExecutionContext` is a platform API, typed via `@cloudflare/workers-types` (already installed).

**Confidence: HIGH** — `waitUntil` is Cloudflare Workers platform API, documented at developers.cloudflare.com. Access path via `runtime.ctx` confirmed via project's own `env.d.ts` type declarations.

---

## Finding 4: D1 Index Audit Tooling

### No external tooling needed

D1 supports standard SQLite PRAGMA statements for index inspection. These run as normal D1 queries via `wrangler d1 execute` or inside API routes.

### Queries to run

```sql
-- List all indexes in the database
SELECT name, tbl_name, sql
FROM sqlite_master
WHERE type = 'index'
ORDER BY tbl_name, name;

-- Check indexes on a specific table
PRAGMA index_list('buildings');
PRAGMA index_list('reviews');
PRAGMA index_list('rate_limits');

-- See which columns an index covers
PRAGMA index_info('idx_buildings_neighborhood');

-- Check query plan for a specific search query
EXPLAIN QUERY PLAN
SELECT b.*, COUNT(r.id) as review_count
FROM buildings b
LEFT JOIN reviews r ON b.id = r.building_id AND r.status = 'approved'
WHERE b.address LIKE '%boston%' OR b.neighborhood LIKE '%boston%'
GROUP BY b.id;
```

### Run against local D1

```bash
npx wrangler d1 execute ratemyplace-db --local \
  --command "SELECT name, tbl_name FROM sqlite_master WHERE type = 'index' ORDER BY tbl_name"
```

### Known gaps from migration audit

From `migrations/0001_initial.sql`, indexes confirmed present:
- `idx_buildings_slug`, `idx_buildings_landlord`, `idx_buildings_neighborhood`, `idx_buildings_address`
- `idx_landlords_slug`, `idx_landlords_name`
- `idx_users_email`, `idx_sessions_user`

**Likely missing (need to verify):**
- `reviews(building_id)` — used in every join for building detail and search
- `reviews(status)` — filtered on `status = 'approved'` in every search and listing query
- `reviews(user_id)` — used in profile dashboard and user review listings
- `rate_limits(rate_key)` — queried by key on every rate limit check (performance-critical)
- `rate_limits(expires_at)` — used in DELETE cleanup

**Recommended additions (run `EXPLAIN QUERY PLAN` to confirm):**

```sql
CREATE INDEX IF NOT EXISTS idx_reviews_building ON reviews(building_id);
CREATE INDEX IF NOT EXISTS idx_reviews_status ON reviews(status);
CREATE INDEX IF NOT EXISTS idx_reviews_user ON reviews(user_id);
CREATE INDEX IF NOT EXISTS idx_rate_limits_key ON rate_limits(rate_key);
CREATE INDEX IF NOT EXISTS idx_rate_limits_expires ON rate_limits(expires_at);
```

Verify each with `EXPLAIN QUERY PLAN` before adding — SQLite optimizer may already use the primary key or existing indexes for some of these.

**Confidence: MEDIUM** — D1 PRAGMA support confirmed via official docs. Specific index gaps are inferred from migration files and query patterns; must be confirmed by running `EXPLAIN QUERY PLAN` against actual data.

---

## Finding 5: Rate Limit Application Pattern

**No new library needed.** `src/lib/rateLimit.ts` is complete and production-proven (fail-closed, structured logging, Retry-After headers).

### Endpoints needing rate limits added (from CONCERNS.md)

| Endpoint | Current | Target | Window |
|----------|---------|--------|--------|
| `/api/bug-reports` | None | 5 per hour per IP | 3600 |
| `/api/search/results` | None | 60 per minute per IP | 60 |
| `/api/search/autocomplete` | None | 30 per minute per IP | 60 |

Note: `/api/disputes` (3/hr) and `/api/contact` (3/hr) already have rate limits applied correctly.

### Integration pattern (copy from signin.ts)

```typescript
const clientIP = getClientIP(context);
const rateLimit = await checkRateLimit(db, clientIP, 'bug-report', 5, 3600);
if (!rateLimit.allowed) {
  return new Response(JSON.stringify({ error: 'Too many submissions.' }), {
    status: rateLimit.error ? 503 : 429,
    headers: { 'Retry-After': String(rateLimit.retryAfterSeconds) }
  });
}
```

**Confidence: HIGH** — infrastructure verified by reading source code.

---

## No New npm Packages Required

The entire v1.5.0 security/validation/async scope can be delivered by extending existing modules:

| Capability | Approach | Files Touched |
|------------|----------|--------------|
| Input validation coverage | Extend `validation.ts` | `validation.ts`, 3 API routes |
| CSRF protection | Middleware Origin check | `middleware.ts` |
| Async email (fire-and-forget) | `runtime.ctx.waitUntil()` | 3 API routes (`signup.ts`, `forgot-password.ts`, `resend-verification.ts`) |
| D1 index audit | SQL PRAGMA queries | New migration file |
| Rate limit coverage | Apply existing `checkRateLimit` | 2–3 API routes |

**Deliberately excluded:**
- **Zod / Valibot**: Bundle cost and new API surface not justified for coverage-only gap. `validation.ts` has the right shape already.
- **CSRF token library (csrf, csurf)**: Origin header checking in middleware is sufficient. Token-based CSRF adds state management complexity with no meaningful security gain for an SSR app behind Cloudflare with SameSite=Lax sessions.
- **Cloudflare Queues**: Not needed for email. `waitUntil` + 30-second window is more than sufficient for Resend API calls (200–500 ms typical). Queues make sense if reliable delivery + retries are needed — they are not for this use case.
- **@astrojs/cloudflare upgrade to v13**: Would force Astro 6 upgrade. Out of scope for a hardening milestone.

---

## Version Compatibility

| Package | Current Version | Notes |
|---------|-----------------|-------|
| `@astrojs/cloudflare` | 12.6.12 | `runtime.ctx` is the ExecutionContext path. Do NOT use `cfContext` (that's v13/Astro 6) |
| `astro` | 5.16.11 | `security.checkOrigin` defaults to `true` but only covers form content types, not JSON |
| `lucia` | 3.2.2 | No built-in CSRF; provides `verifyRequestOrigin()` utility but doesn't call it automatically |
| `@cloudflare/workers-types` | 4.20260117.0 | Provides `ExecutionContext` type for `runtime.ctx.waitUntil()` — already installed |

---

## Sources

- https://v3.lucia-auth.com/guides/validate-session-cookies/ — Verified: Lucia v3 does NOT provide automatic CSRF protection; provides `verifyRequestOrigin()` utility only
- https://docs.astro.build/en/reference/configuration-reference/ — Verified: `security.checkOrigin` defaults to `true` in Astro v5; only covers form content types (NOT `application/json`)
- https://github.com/withastro/astro/security/advisories/GHSA-c4pw-33h3-35xw — CVE-2024-56140 patched in 4.16.17; project is on 5.16.11 (patched)
- https://developers.cloudflare.com/workers/runtime-apis/context/ — Verified: `ctx.waitUntil()` extends Worker lifetime up to 30s after response; accepts Promise
- https://valibot.dev/blog/valibot-v1-the-1-kb-schema-library/ — Valibot v1 stable at 1.3.1; tree-shaken bundle 1–2 KB; rejected because capability gap doesn't justify new dependency
- https://developers.cloudflare.com/d1/sql-api/sql-statements/ — Verified: D1 supports `PRAGMA index_list()`, `PRAGMA index_info()`, and `sqlite_master` queries
- Direct source inspection: `src/lib/rateLimit.ts`, `src/lib/validation.ts`, `src/lib/auth.ts`, `src/middleware.ts`, `src/env.d.ts`, `package.json`, `astro.config.mjs`

---

*Stack research for: v1.5.0 "Closed Loops" security hardening milestone*
*Researched: 2026-04-26*
