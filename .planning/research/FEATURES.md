# Feature Research

**Domain:** Security hardening and quality-debt closure for a Cloudflare Workers + Astro SSR tenant review platform
**Researched:** 2026-04-26
**Confidence:** HIGH (based on direct codebase audit — no external sources needed for implementation-specific findings)

---

## Codebase Baseline (What Already Exists)

Before categorizing features, here is the precise state of each gap area as found in the audit. This prevents over-building.

| Area | Status |
|------|--------|
| `checkRateLimit()` in `src/lib/rateLimit.ts` | Exists, fail-closed, D1-backed, per-IP |
| Rate limiting on `/api/contact.ts` | DONE — 3/hr, with `Retry-After` header |
| Rate limiting on `/api/disputes.ts` | DONE — 3/hr, with `Retry-After` + 503/429 split |
| Rate limiting on `/api/bug-reports.ts` | MISSING — Turnstile present but no `checkRateLimit` call |
| Rate limiting on `/api/search/results.ts` | MISSING — no protection at all (GET endpoint) |
| Rate limiting on `/api/search/autocomplete.ts` | MISSING — no protection at all (GET endpoint) |
| Input validation on `/api/contact.ts` | Solid — name 2-100, email includes('@'), message 10-3000 |
| Input validation on `/api/disputes.ts` | Partial — required-field check, no length limits on text fields, email not regex-validated |
| Input validation on `/api/bug-reports.ts` | Partial — description 10-5000, category allowlist; email field accepted without format check |
| `validation.ts` | Covers review form only; no shared validators for email, zip, generic text length |
| CSRF tokens | None. Session cookie is `SameSite=Lax` which blocks cross-site top-level POSTs but NOT fetch/XHR |
| Lucia CSRF built-in | Lucia v3 does NOT include CSRF protection; it relies on the host framework |
| Async email in `/api/contact.ts` | Uses `.catch()` but still `await`s both sends before returning — synchronous |
| `waitUntil` availability | `context.locals.runtime.ctx.waitUntil()` — `ctx: ExecutionContext` is typed in `env.d.ts` but cast to `any` in practice |
| Admin moderation E2E | UI actions tested (approve/reject/resolve); audit log assertion is ordering-dependent, not action-specific |
| Cross-view consistency E2E | No coverage — audit explicitly calls this out as HIGH priority |
| D1 indexes: `reviews(building_id, status)` composite | Missing — search joins `reviews` on both columns repeatedly |
| D1 indexes: `buildings.city` | Missing — used in search filters |
| D1 indexes: `buildings.building_type` | Missing — used in search filters |
| D1 indexes: `buildings.zip_code` | Missing — not currently in search but natural filter candidate |
| Component LOC: ReviewEditForm | 907 lines |
| Component LOC: BuildingsTable | 844 lines |
| Component LOC: ReviewsTable | 733 lines |
| Typed runtime wrapper | 71 `(context.locals as any).runtime` casts; `App.Platform` type exists in `env.d.ts` but not wired to `locals` |
| EmptyState component | No shared component; each page has ad-hoc empty state text |

---

## Feature Landscape

### Table Stakes (Production Web Apps Must Have These)

These are the behaviors any hardened production web app is expected to have. Missing them is a security or quality deficit, not a missing feature.

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Rate limiting on all public POST endpoints | Bot mitigation baseline; spammers target contact/dispute forms | LOW | `checkRateLimit()` already exists; this is call-site wiring only. Bug-reports needs it; search is GET so use a lighter limit |
| Rate limit response headers (`X-RateLimit-*` + `Retry-After`) | RFC 6585 / industry norm; clients and monitoring tools expect them | LOW | `Retry-After` already present on dispute/signin; needs to be consistent across all rate-limited endpoints |
| 429 status for rate limit exceeded | HTTP standard — `429 Too Many Requests`; 503 is correct only when the rate-limit DB itself fails | LOW | Pattern already correct in `disputes.ts` (429 vs 503 split); replicate everywhere |
| Input length limits on all text fields | Prevents DB bloat, log flooding, and denial-of-service via oversized payloads | LOW | `disputeExplanation` has no max; `landlordName`, `landlordPhone` have no limits in disputes.ts |
| Numeric type guards (`rent_amount`, `laundry_cost_per_load`) | Prevents storing NaN or strings in numeric columns | LOW | `reviews.ts` uses `parseInt()` without `isNaN` guard in some places |
| Email format validation on all endpoints that accept email | Prevents garbage data in contact/dispute records | LOW | `/api/contact.ts` uses `includes('@')` only; `/api/disputes.ts` accepts any string for `landlordEmail`; use regex `/^[^\s@]+@[^\s@]+\.[^\s@]+$/` |
| SameSite=Lax cookie attribute | Blocks cross-site form POST attacks (most CSRF vectors) | LOW | Already set in middleware — this is done. Verify it covers all state-changing endpoints |
| CSRF audit documentation | Know what protection exists before claiming it is sufficient | LOW | SameSite=Lax does NOT block cross-origin fetch/XHR. Authenticated state-changing APIs need an additional check if called by JS |
| Non-blocking email sends | API response time should not depend on a third-party email SLA (Resend adds 200-500ms) | MEDIUM | Pattern: `context.locals.runtime.ctx.waitUntil(sendEmail(...))` — fire-and-forget without losing the promise to the runtime |
| E2E coverage for admin moderation with audit-log assertion | Admin approve/reject already tested at UI level but audit log assertion is ordering-dependent, not causal | MEDIUM | Need: trigger approve action, then assert the specific audit log entry exists for that review ID |
| E2E coverage for cross-view data consistency | Same score appearing correctly on search, building detail, and profile page is the core promise of the platform | MEDIUM | Playwright: submit review → check all 3 views → edit review → check all 3 views again |
| Composite DB index on `reviews(building_id, status)` | Search query joins reviews on both columns in every request; without composite index, SQLite scans all rows for a building | LOW | Single migration adding `CREATE INDEX idx_reviews_building_status ON reviews(building_id, status)` |

### Differentiators (Quality Bets That Distinguish This Codebase)

Features that go beyond the minimum and reduce long-term maintenance cost. Not expected by users, but valued by the team.

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Typed Cloudflare runtime wrapper | Eliminates 71 `any` casts; IDE completion on `env.DB`, `ctx.waitUntil`; refactoring becomes safe | MEDIUM | Approach: extend `App.Locals` in `env.d.ts` to expose `runtime` with the `App.Platform` type, then update `getDB()` and `rateLimit.ts` signatures. Repetitive but mechanical — can be done in one PR |
| Shared `<EmptyState>` component | Consistent empty-state UX across 8+ pages; single place to update messaging | LOW | Props: `title`, `description`, optional `action` (label + href). Replace ad-hoc messages in search, building detail, profile, admin tables |
| Component splits for >700 LOC files | ReviewEditForm (907 lines), BuildingsTable (844), ReviewsTable (733) are hard to test and review | HIGH | Extract form steps into sub-components; move filter/sort logic to custom hooks; split admin tables into `TableRow`, `TableFilters`, `TablePagination`. 2-3 PRs, not one |
| `X-RateLimit-Remaining` header on all rate-limited endpoints | Allows future API clients and the browser DevTools to show quota state; professional API signal | LOW | Add `X-RateLimit-Limit` and `X-RateLimit-Remaining` to response headers alongside existing `Retry-After` |
| Centralized validation helpers for email, zip, text length | `validation.ts` currently covers only review form; other endpoints inline the same patterns | LOW | Add `validateEmail()`, `validateZip()`, `validateTextLength(max)` to `validation.ts`; import at each endpoint |

### Anti-Features (Do Not Build These)

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|-----------------|-------------|
| Separate CSRF token system (cookie + header, double-submit pattern) | "Proper" CSRF protection | Overkill for this architecture. All authenticated state-changing requests are initiated by JavaScript fetches from the same origin (Astro SSR pages), which means `SameSite=Lax` on the session cookie already blocks cross-site attacks. Adding a CSRF token adds a DB round-trip or crypto op per request with no additional security for same-origin JS callers. The gap would only matter if a form were submitted with `method="POST" enctype="application/x-www-form-urlencoded"` from a different site, which Lucia + Astro's architecture does not expose. | Audit the existing SameSite=Lax coverage, document the decision, and verify no forms bypass it. If a specific gap is found (e.g., a form that could be forged), add an `Origin` header check in the middleware — not a full CSRF token system |
| Email queue worker (Cloudflare Queue or Durable Object) | "Proper" async email at scale | Introduces a separate Cloudflare product (Queues), additional binding, dead-letter handling, and debugging overhead. Resend's own retry logic handles transient failures. `waitUntil()` is the correct Cloudflare Workers pattern for fire-and-forget tasks within a single request lifetime. A queue is only warranted if email volume exceeds Resend's burst limit or if retry logic needs persistence across Worker restarts — neither applies at current scale | Use `ctx.waitUntil(sendEmail(...))` — this is the idiom Cloudflare recommends for non-blocking work |
| Zod or other schema validation library | Structured validation, better DX | Adds a dependency for a codebase that already has `validation.ts` with working patterns. Cloudflare Workers has strict bundle-size sensitivity. Zod's full bundle is ~13KB gzipped. The payoff (better error messages, schema inference) does not justify the bundle cost for 4-5 endpoints being hardened. | Extend `validation.ts` with typed helper functions. Use the existing `ValidationError[]` return shape |
| Per-user rate limiting on public endpoints | More nuanced abuse prevention | Contact, bug reports, and dispute endpoints do not require authentication. Per-user rate limiting requires auth state which is not present. Hybrid per-IP-or-user logic adds branching complexity. The current per-IP model is correct for anonymous endpoints. For authenticated endpoints (review submission), Turnstile + auth requirement is the correct gate. | Keep per-IP rate limiting for public endpoints; rely on Turnstile + auth for authenticated endpoints |
| Stress/load testing phase | Validate rate limits and DB indexes at scale | Deferred from v1.3.0 already. Current dataset is small (single city, <1000 buildings). D1 SQLite at this scale does not need stress testing — the index additions are provably correct by examining the query plans. Stress testing adds significant infra complexity (k6, wrk, synthetic load) for a dataset that won't stress D1. | Defer stress testing until 5+ cities with 50+ reviews per building. The index audit (migration) is sufficient validation now |
| Sentry or error tracking service | Production visibility | Not wrong, but out of scope for a hardening milestone. Adding Sentry requires a new Cloudflare secret, SDK integration, and PII scrubbing decisions. Cloudflare's `wrangler tail` + structured `console.error()` logging is adequate for current scale. | Log structured JSON errors consistently (already done); revisit Sentry for v2.0 when multi-city traffic justifies it |

---

## Feature Dependencies

```
Rate limit headers (X-RateLimit-*)
    └──requires──> Rate limiting applied to endpoint (checkRateLimit call)

Async email (waitUntil)
    └──requires──> Typed runtime wrapper OR (context.locals as any).runtime cast

Typed runtime wrapper
    └──enhances──> Async email (ctx.waitUntil typed correctly)
    └──enhances──> getDB(), rateLimit.ts, all API routes (removes any casts)

Centralized validation helpers
    └──enhances──> All public POST endpoints (email/zip/length validators imported)

E2E: audit-log assertion
    └──requires──> Admin moderation E2E exists (it does — admin-actions.spec.ts)
    └──extends──> Existing E2E-10 test (audit log row presence check)

E2E: cross-view consistency
    └──requires──> Review submission E2E exists (it does — review.spec.ts)
    └──requires──> Approved review appears on building detail page (moderation needed in test)

Composite index reviews(building_id, status)
    └──no dependencies──> standalone migration

EmptyState component
    └──no dependencies──> standalone component extraction
```

### Dependency Notes

- **Rate limiting on bug-reports requires nothing new**: `checkRateLimit` and `getClientIP` are already imported in the file (imports visible at top of `bug-reports.ts`) — only the call is missing.
- **Async email requires runtime context**: `waitUntil` is on `runtime.ctx`, not `runtime`. The access path is `(context.locals as any).runtime?.ctx?.waitUntil(promise)`. Typed wrapper makes this safe; without it the cast works but is fragile.
- **Component splits are independent of each other**: ReviewEditForm, BuildingsTable, ReviewsTable can be split in separate PRs without affecting each other.
- **CSRF audit precedes any remediation**: Audit first (check SameSite coverage, verify no unprotected cross-origin vector), then decide if additional mitigations are needed. High probability the audit concludes SameSite=Lax is sufficient for this architecture.

---

## MVP Definition for v1.5.0

### Must Ship (Closed Loops milestone blockers)

- [ ] Rate limiting on `/api/bug-reports.ts` — security gap; the infrastructure exists, this is one function call
- [ ] Rate limiting on `/api/search/results.ts` and `/api/search/autocomplete.ts` — DoS vector; use a lighter limit (e.g. 60 req/min) since these are GET endpoints, not spam surfaces
- [ ] Input validation gaps: `disputeExplanation` max length, `landlordName` max length, `landlordEmail` format, `landlordPhone` max length — data integrity
- [ ] CSRF audit + documentation of what SameSite=Lax covers and what it does not — required before claiming "CSRF protection done"
- [ ] Async email in `/api/contact.ts` and any other route that awaits email sends — user-facing latency fix
- [ ] E2E test: admin approve/reject → verify specific audit log entry for that review ID — closes the causal gap in E2E-10
- [ ] E2E test: review created → score visible on search results, building detail, and user profile — closes the data-consistency coverage gap
- [ ] Migration: `CREATE INDEX idx_reviews_building_status ON reviews(building_id, status)` — query plan fix for the most common search join

### Add After the Critical Path Is Done

- [ ] `X-RateLimit-Limit` and `X-RateLimit-Remaining` headers — consistent with `Retry-After` already present; low effort, add alongside rate limit wiring
- [ ] Centralized email/zip/text-length validators in `validation.ts` — cleaner than inline checks, but existing inline checks work
- [ ] Migration: indexes on `buildings.city` and `buildings.building_type` — matters more as dataset grows; not urgent at current scale
- [ ] Shared `<EmptyState>` component — UX consistency; no user-facing bug, purely cleanup

### Defer to v1.6.0 or Later

- [ ] Typed Cloudflare runtime wrapper — MEDIUM complexity refactor (71 files), no user-facing impact; schedule as a dedicated cleanup PR when the team has bandwidth
- [ ] Component splits (ReviewEditForm, BuildingsTable, ReviewsTable) — structural quality improvement; nothing is broken; schedule across 2-3 PRs in a cleanup milestone
- [ ] `buildings.zip_code` index — not used in current search queries
- [ ] Stress testing — not warranted at current scale

---

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority |
|---------|------------|---------------------|----------|
| Rate limiting on bug-reports | LOW (invisible) | LOW (1 function call) | P1 — security gap |
| Rate limiting on search endpoints | LOW (invisible) | LOW (1-2 function calls) | P1 — security gap |
| Async email sends | MEDIUM (response time) | LOW (`ctx.waitUntil`) | P1 — UX + correctness |
| Input validation gaps on disputes | LOW (invisible) | LOW (add length checks) | P1 — data integrity |
| Rate limit response headers | LOW (invisible) | LOW (add headers) | P2 — API hygiene |
| CSRF audit + documentation | LOW (invisible) | LOW (analysis + docs) | P1 — security clarity |
| E2E: audit-log causal assertion | LOW (invisible) | MEDIUM (test authoring) | P1 — coverage gap |
| E2E: cross-view consistency | MEDIUM (catches real bugs) | MEDIUM (test authoring) | P1 — coverage gap |
| Composite index reviews(building_id, status) | LOW (invisible at scale) | LOW (1 migration) | P1 — query correctness |
| Centralized validation helpers | LOW (dev experience) | LOW (refactor) | P2 — cleanup |
| Shared EmptyState component | LOW (UX consistency) | LOW (new component) | P2 — cleanup |
| `buildings.city` / `building_type` indexes | LOW (invisible now) | LOW (1 migration) | P2 — scale preparation |
| Typed runtime wrapper | LOW (dev experience) | MEDIUM (71 files) | P3 — defer |
| Component splits (3 files >700 LOC) | LOW (dev experience) | HIGH (structured refactor) | P3 — defer |

---

## Implementation Notes Per Feature

### Rate Limiting on Search Endpoints

Search endpoints are GET requests, not POST. They should use a higher limit than spam-vector endpoints (contact, disputes) but still be protected. Recommended limits:
- `/api/search/results`: 60 requests per minute per IP
- `/api/search/autocomplete`: 120 requests per minute per IP (keystroke-driven, needs higher budget)

The response for rate-exceeded search should return `{ results: [], total: 0 }` with status 429 rather than an error shape, to degrade gracefully for the search UI.

### Async Email via `waitUntil`

The correct access pattern in Astro/Cloudflare Pages adapter:

```typescript
const ctx = (context.locals as any).runtime?.ctx;
if (ctx) {
  ctx.waitUntil(sendEmail(...).catch(err => console.error('Email failed:', err)));
} else {
  // Dev environment: await directly (no Workers runtime)
  await sendEmail(...).catch(err => console.error('Email failed:', err));
}
```

This pattern keeps email sends non-blocking in production while not breaking local dev where `ctx` is unavailable. The `waitUntil` call registers the promise with the Workers runtime, which keeps the isolate alive until the promise resolves — no data loss risk.

### CSRF Audit Scope

The audit should verify:
1. Session cookie `SameSite=Lax` is confirmed set in middleware (it is — line 30-31 in `middleware.ts`)
2. All state-changing API routes check `context.locals.user` (authenticated routes) or use Turnstile (public routes) — both patterns exist
3. No forms use `method="POST"` without JavaScript fetch mediation (check all `.astro` page forms — if any do raw HTML form POST, they are vulnerable to CSRF with `SameSite=Lax` because Lax allows top-level navigation POSTs from other sites)
4. If no raw HTML POSTs found: document that SameSite=Lax is sufficient, no token needed

Most likely outcome: audit confirms SameSite=Lax is sufficient. The audit result goes in a comment in `middleware.ts` and a brief note in CLAUDE.md.

### E2E: Audit Log Causal Assertion

Current E2E-10 checks that audit log rows exist after prior tests ran in sequence. This is fragile (depends on test ordering). The stronger assertion:

```typescript
// After approve action, assert audit log has entry for that specific review ID
const auditRows = await adminPage.evaluate(async () => {
  const res = await fetch('/api/admin/audit');
  return (await res.json()).logs;
});
const approveEntry = auditRows.find(
  (r: any) => r.action_type === 'review_approved' && r.entity_id === reviewId
);
expect(approveEntry).toBeDefined();
```

This requires the test to capture the `reviewId` before the approve action and assert after.

### D1 Composite Index

The search query in `search/results.ts` executes:
```sql
LEFT JOIN reviews r ON b.id = r.building_id AND r.status = 'approved'
```

SQLite will use `idx_reviews_building` (on `building_id` alone) but must then filter by `status` in-memory. The composite index `(building_id, status)` eliminates this secondary filter scan. At 1000 reviews this is microseconds; at 100K reviews this matters. Adding it now costs nothing.

---

## Sources

- Codebase audit: `.planning/codebase/CONCERNS.md` (2026-04-26) — HIGH confidence, direct inspection
- `src/lib/rateLimit.ts` — direct read, confirmed implementation
- `src/lib/validation.ts` — direct read, confirmed coverage gaps
- `src/pages/api/contact.ts`, `disputes.ts`, `bug-reports.ts` — direct read, confirmed rate limit and validation state
- `src/pages/api/search/results.ts`, `autocomplete.ts` — direct read, confirmed no rate limiting
- `src/middleware.ts` — direct read, confirmed SameSite=Lax cookie attribute
- `src/lib/auth.ts` — direct read, confirmed Lucia v3 with no built-in CSRF
- `src/env.d.ts` — direct read, confirmed `ctx: ExecutionContext` is typed (waitUntil available)
- `migrations/0001_initial.sql` through `0023_saved_buildings.sql` — direct read, confirmed existing index set
- `e2e/admin-actions.spec.ts` — direct read, confirmed audit log assertion gap
- RFC 6585: HTTP 429 Too Many Requests — rate limit status code standard
- Cloudflare Workers `ExecutionContext.waitUntil()` — documented in `@cloudflare/workers-types` v4.x

---

*Feature research for: v1.5.0 "Closed Loops" hardening milestone*
*Researched: 2026-04-26*
