# Phase 17: Public Endpoint Security - Context

**Gathered:** 2026-04-28
**Status:** Ready for planning

<domain>
## Phase Boundary

Every public POST endpoint and search endpoint gets rate limiting and structured input validation. Specifically: `/api/bug-reports`, `/api/disputes`, `/api/search/results`, `/api/search/autocomplete`. Existing `/api/contact` is brought into the same shared-primitive validator pattern.

This phase delivers backend hardening only. No UI changes, no new endpoints, no new dependencies (no Zod/Valibot per REQUIREMENTS.md). After this phase: every unauthenticated request path has a rate limit, an input validator using shared primitives, and a content-type guard. Frontend behavior is unchanged on the happy path.

</domain>

<decisions>
## Implementation Decisions

### Validator response shape
- **Validators return full `ValidationError[]`** (matches existing `validateReviewForm` in `src/lib/validation.ts`). They do NOT short-circuit on first error.
- **Endpoints return all errors at once:** `400 { error: 'Validation failed', details: [{field, message}, ...] }`. Frontend can highlight every bad field in one round-trip.
- **`field` property carries the form input name** — `landlordEmail`, `disputeExplanation`, `q` — not the DB column name. Frontend maps directly to the input element.
- **Error messages are field-specific:** "Dispute explanation is required.", "Email format is invalid." — matches the `validateReviewForm` style ("Building is required").
- **Sanitization happens at the endpoint AFTER validation passes.** Validators check raw input length and format; endpoints call `sanitizeText()` only on validated input before INSERT. Validators stay pure (no mutation). A 5001-char input is rejected for length even if it has HTML tags that would shrink it below 5000.

### Search wildcard handling (VAL-04)
- **Escape SQL LIKE wildcards to literal characters.** `%`, `_`, and `\` in the user's query are escaped with `\` and the SQL LIKE clause uses `ESCAPE '\'`. User typing `5%` matches addresses literally containing "5%".
- **Length cap applies to trimmed query.** `query.trim().length > 200` returns 400. Leading/trailing whitespace doesn't count toward the cap. Consistent with the existing `query.trim()` in both search endpoints.
- **No minimum length enforcement.** Autocomplete queries shorter than 2 chars continue to return empty results (no 400) — consistent with current behavior, avoids spamming console errors per keystroke. Rate limit still applies to those requests.
- **Empty query is allowed on `/api/search/results`.** Empty `q` browses all buildings with reviews (current behavior, used by the browse-all UI). Empty `q` on `/api/search/autocomplete` returns empty results.

### Content-type guards (VAL-02 generalized)
- **Apply guard to all four POST endpoints** (`/api/bug-reports`, `/api/disputes`, `/api/contact`; `/api/search/*` are GET, no guard needed).
- **Strict mode:** wrong or missing Content-Type returns `415 Unsupported Media Type`.
  - `/api/disputes` requires `application/json`
  - `/api/bug-reports` and `/api/contact` require `multipart/form-data` or `application/x-www-form-urlencoded`
- **No "sniff and continue" fallback.** Missing Content-Type is treated identically to wrong Content-Type — strong signal of non-browser traffic.

### Validator file organization (VAL-05)
- **Single flat `src/lib/validation.ts`** continues to host both shared primitives and form validators. File grows from ~109 lines to ~300; that's acceptable for a hardening phase. No subfolder split.
- **Shared primitives are standalone exports** — `export function isValidEmail(s: string): boolean { ... }`, etc. Tree-shakeable, matches the existing `sanitizeText` pattern.
- **`isValidEmail`** uses pragmatic regex `/^[^\s@]+@[^\s@]+\.[^\s@]+$/` — catches the obvious `"notanemail"` case (success-criteria test) and typical typos. Not RFC 5322 strict.
- **`isValidZipCode`** accepts US 5-digit and 5+4: `/^\d{5}(-\d{4})?$/`. Future-proof if the app expands beyond Boston; supports out-of-state landlords on disputes.
- **`enforceMaxLength`** is the canonical length-cap helper used by every validator: `enforceMaxLength(value, max, fieldName) => ValidationError | null`.

### Rate limiting
- **Use existing `checkRateLimit` from `src/lib/rateLimit.ts`** unchanged. Same fail-closed pattern as `contact.ts` and `disputes.ts`.
- **Per-IP only** (`getClientIP(context)`). Public endpoints are unauthenticated; per-user is not applicable. Confirmed by REQUIREMENTS.md "Out of Scope: Per-user rate limiting on public endpoints".
- **Rate limits per requirements (locked):**
  - `/api/bug-reports`: 5 / hour per IP (SEC-04)
  - `/api/search/results`: 60 / minute per IP (SEC-05)
  - `/api/search/autocomplete`: 120 / minute per IP (SEC-05)
- **`Retry-After` header set on every 429.** Matches `disputes.ts` model — the cleanest existing implementation. (Phase 21 SEC-07 will retro-fit `contact.ts`.)
- **Endpoint check ordering:** content-type guard → rate limit → Turnstile (where applicable) → validator → DB write. Rate limit before Turnstile because Turnstile is a paid Cloudflare call and we don't want spammers to consume Turnstile budget.

### Claude's Discretion
- Exact wording of validation error messages (field-specific style locked, exact strings up to Claude)
- Whether `enforceMaxLength` returns `ValidationError | null` or pushes to an existing array — implementation detail
- Exact escape implementation for SQL LIKE wildcards (helper name, where it lives in `validation.ts`)
- Whether to extract a shared `requireContentType()` helper or inline the check in each endpoint
- 415 response body shape (`{ error: 'Unsupported Media Type' }` vs more descriptive)

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/lib/rateLimit.ts` — `checkRateLimit(db, identifier, endpoint, maxAttempts, windowSeconds)` works fail-closed. Returns `{allowed, remaining, retryAfterSeconds, error}`. Already wired in `contact.ts` (3/hr) and `disputes.ts` (3/hr with Retry-After header).
- `src/lib/validation.ts` — `validateReviewForm` returns `ValidationError[]` (`{field, message}`). `sanitizeText()` strips HTML tags and collapses whitespace. New primitives extend this file.
- `src/lib/turnstile.ts` — `verifyTurnstile()` already wired in `contact.ts` and `bug-reports.ts`. Phase 17 does not change Turnstile usage.
- `getClientIP(context)` from `rateLimit.ts` — Cloudflare CF-Connecting-IP fallback chain.
- `getDB(context)` and `getEnv(context)` from Phase 16 — typed accessors, no `as any` casts.

### Established Patterns
- API error shape: `{ error: 'message' }` for single error; new pattern adds `{ error: 'Validation failed', details: ValidationError[] }` for multi-field validators (matches CLAUDE.md error pattern).
- Rate-limit endpoint key naming: short verb-noun like `'contact'`, `'dispute'` — keys for new endpoints: `'bug-report'`, `'search-results'`, `'search-autocomplete'`.
- 429 response (best model in `disputes.ts`): includes `Retry-After: ${rateLimit.retryAfterSeconds}` header.
- `disputes.ts` is the canonical reference for the full POST endpoint pattern — content-type → rate limit → Turnstile → validate → INSERT → notify → email.
- Search endpoints use `LIKE '%${input}%'` with parameterized binding — wildcard escape happens BEFORE binding, then `ESCAPE '\'` clause is added to LIKE.

### Integration Points
- `/api/bug-reports` POST handler — adds rate limit + content-type guard + `validateBugReport()` call.
- `/api/disputes` POST handler — replaces inline length check with `validateDisputeForm()` call; adds content-type guard.
- `/api/contact` POST handler — replaces inline checks with `validateContactForm()` call; adds content-type guard. Existing 3/hr rate limit stays.
- `/api/search/results` GET handler — adds `validateSearch()` call before query construction; adds rate limit; uses LIKE escape helper.
- `/api/search/autocomplete` GET handler — same as results endpoint, with 120/min limit.
- `BugReportButton.tsx` (React island) — frontend that posts to `/api/bug-reports`. Should keep working unchanged because content-type guard accepts FormData. Frontend can later be enhanced to display `details[]` errors but not required for this phase.

</code_context>

<specifics>
## Specific Ideas

- The `ValidationError[]` plural-error response shape mirrors what `validateReviewForm` already returns — this phase's validators just bring the other four endpoints up to that bar.
- Reference the `disputes.ts` POST handler as the canonical pattern when implementing the other endpoints — its `Retry-After` header behavior, fail-closed rate-limit handling, and structured error returns are already correct.
- The success criterion `"landlordEmail set to 'notanemail' returns 400 with field-level error identifying the email field"` is the acceptance test for the chosen pragmatic regex. The regex must reject `"notanemail"` and accept `"a@b.c"`.
- The `5%` literal-search example: a tenant searching for a building called "Studio 5%" should find it. The escape strategy preserves that.

</specifics>

<deferred>
## Deferred Ideas

- **SEC-07 / SEC-08:** `Retry-After` retro-fit on `contact.ts` and `X-RateLimit-Limit`/`X-RateLimit-Remaining` headers on every rate-limited endpoint — already mapped to Phase 21 in REQUIREMENTS.md. Plans 17-01/17-02 should structure 429 responses such that Phase 21 only needs to add headers, not refactor the rate-limit call sites.
- **SEC-06:** CSRF audit — Phase 18.
- **PERF-03 / PERF-04:** `waitUntil` for `/api/contact` admin email and `/api/disputes` landlord email — Phase 18.
- **Frontend display of `details[]`:** the structured multi-error response is server-side ready; the client UI for highlighting multiple field errors at once is out of scope and can land later as UX work.
- **Splitting `validation.ts` into a folder** when it grows past ~500 lines — revisit in v1.6.0 if more validators land.
- **Per-user rate limits / Cloudflare Queues / Sentry / Astro 6** — already explicitly out of scope per REQUIREMENTS.md.

</deferred>

---

*Phase: 17-public-endpoint-security*
*Context gathered: 2026-04-28*
