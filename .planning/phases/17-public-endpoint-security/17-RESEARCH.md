# Phase 17: Public Endpoint Security - Research

**Researched:** 2026-04-28
**Domain:** API endpoint hardening — rate limiting, input validation, content-type guards, SQL LIKE escaping
**Confidence:** HIGH

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

- **Scope**: `/api/bug-reports`, `/api/disputes`, `/api/search/results`, `/api/search/autocomplete`; `/api/contact` brought into shared-validator pattern. Backend only — no UI changes.
- **Validator response shape**: Full `ValidationError[]` (not short-circuit). Endpoints return `400 { error: 'Validation failed', details: [{field, message}, ...] }`.
- **`field` property**: carries the form input name (`landlordEmail`, `disputeExplanation`, `q`), not the DB column name.
- **Sanitization order**: Happens at endpoint AFTER validation passes. Validators stay pure (no mutation). Length is checked against raw input, not post-sanitize length.
- **Search wildcard handling**: Escape `%`, `_`, `\` with `\` before binding, and add `ESCAPE '\'` to the LIKE clause. Length cap on trimmed query (> 200 chars = 400). No minimum length enforcement.
- **Empty `q` on `/api/search/results`**: Allowed — browses all buildings (existing behavior).
- **Content-type guards**: Apply to all three POST endpoints. `/api/disputes` requires `application/json`. `/api/bug-reports` and `/api/contact` require `multipart/form-data` or `application/x-www-form-urlencoded`. Wrong or missing Content-Type returns `415`. No sniff-and-continue fallback.
- **Validator file organization**: Single flat `src/lib/validation.ts` grows from ~109 to ~300 lines. No subfolder split.
- **`isValidEmail`**: Pragmatic regex `/^[^\s@]+@[^\s@]+\.[^\s@]+$/`. Must accept `a@b.c`, reject `notanemail`.
- **`isValidZipCode`**: `/^\d{5}(-\d{4})?$/`.
- **`enforceMaxLength`**: Canonical length-cap helper used by every validator.
- **Rate limiting**: Use existing `checkRateLimit` unchanged. Per-IP only. Limits: bug-reports 5/hr, search/results 60/min, search/autocomplete 120/min.
- **`Retry-After` header**: Set on every 429. Model: `disputes.ts`.
- **Endpoint check order**: content-type guard → rate limit → Turnstile (where applicable) → validator → DB write.
- **Rate-limit key naming**: `'bug-report'`, `'search-results'`, `'search-autocomplete'`.

### Claude's Discretion

- Exact wording of validation error messages (field-specific style locked, exact strings up to Claude)
- Whether `enforceMaxLength` returns `ValidationError | null` or pushes to an existing array
- Exact escape implementation for SQL LIKE wildcards (helper name, where it lives in `validation.ts`)
- Whether to extract a shared `requireContentType()` helper or inline the check in each endpoint
- 415 response body shape

### Deferred Ideas (OUT OF SCOPE)

- SEC-07 / SEC-08: `Retry-After` retro-fit on `contact.ts` and rate-limit headers — Phase 21
- SEC-06: CSRF audit — Phase 18
- PERF-03 / PERF-04: `waitUntil` for contact/disputes emails — Phase 18
- Frontend display of `details[]` — future UX work
- Splitting `validation.ts` into a folder — revisit in v1.6.0
- Per-user rate limits / Cloudflare Queues / Sentry / Astro 6 — explicitly out of scope
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| SEC-04 | Rate limiting on `/api/bug-reports` (5/hr per IP, fail-closed) | `checkRateLimit` wiring pattern verified in `disputes.ts`; key naming convention confirmed |
| SEC-05 | Rate limiting on `/api/search/results` (60/min) and `/api/search/autocomplete` (120/min) | Same `checkRateLimit` API; GET endpoint wiring pattern documented |
| VAL-01 | `validateDisputeForm` — email format, length limits on explanation/name/phone | `isValidEmail` regex and `enforceMaxLength` helper patterns documented |
| VAL-02 | `validateBugReport` — length limits and content-type guard on `/api/bug-reports` | Content-type guard behavior for formData endpoints; TypeError throw behavior documented |
| VAL-03 | `validateContactForm` — email format and length limits on `/api/contact` | Replaces inline single-error checks with `ValidationError[]` multi-error shape |
| VAL-04 | `validateSearch` — query-length cap and special-char handling on search endpoints | SQLite LIKE ESCAPE syntax verified; escape function design documented |
| VAL-05 | Shared primitives in `validation.ts`: `isValidEmail()`, `isValidZipCode()`, `enforceMaxLength()` | All three primitives designed; test coverage gaps identified |
</phase_requirements>

---

## Summary

Phase 17 hardens four unauthenticated API paths that currently lack rate limits (`/api/bug-reports`, both search endpoints) or use inline, non-reusable validation (`/api/disputes`, `/api/contact`). The work is entirely mechanical: wire existing infrastructure (`checkRateLimit`, `ValidationError[]`) into the gaps, add three shared primitives to `validation.ts`, and implement two protective patterns (content-type guards, SQL LIKE wildcard escaping) that prevent class-level vulnerabilities.

The codebase is well-prepared. The `checkRateLimit` function is proven and fail-closed. The `ValidationError[]` return shape already exists in `validateReviewForm`. The `disputes.ts` file is the canonical reference for the correct POST handler order and 429 response shape. No new dependencies are needed.

The critical implementation subtlety is the content-type guard: `request.formData()` throws a `TypeError` when Content-Type is wrong, so the guard must run *before* the `await request.formData()` call or the catch block sees an unhandled parse error rather than a clean 415. For `request.json()` on the disputes endpoint, the same principle applies — the guard prevents `SyntaxError` from raw body parsing. The SQL LIKE escape must cover all three special characters (`%`, `_`, `\`) and append `ESCAPE '\'` to the LIKE clause; without the `\` escape, a user with `\` in their query string would break the escape logic itself.

**Primary recommendation:** Use `disputes.ts` as the implementation template for all three POST endpoints, extend `validation.ts` in-place with the three shared primitives, and centralize LIKE escaping into a single exported helper function in `validation.ts` to keep search endpoint code clean.

---

## Standard Stack

### Core (verified from codebase)

| Library / Module | Version | Purpose | Status |
|---------|---------|---------|--------|
| `src/lib/rateLimit.ts` | project file | `checkRateLimit(db, identifier, endpoint, max, windowSeconds)` — D1-backed, fail-closed, returns `{allowed, remaining, retryAfterSeconds, error}` | Already works; no changes needed |
| `src/lib/validation.ts` | project file | `ValidationError[]` return shape, `sanitizeText()` — extend with three new primitives | Extend in-place |
| `src/lib/turnstile.ts` | project file | `verifyTurnstile()` — already wired in `bug-reports.ts` and `contact.ts` | No changes; Phase 17 does not touch Turnstile |
| Cloudflare D1 / SQLite | runtime | `LIKE ... ESCAPE '\'` clause for wildcard escaping | SQLite ESCAPE syntax verified |

### No New Dependencies

REQUIREMENTS.md explicitly rules out Zod/Valibot. All needed capability already exists in the project.

---

## Architecture Patterns

### Pattern 1: POST Endpoint Check Order (from `disputes.ts`)

**What:** content-type guard → rate limit → Turnstile (if applicable) → validator → DB write

**Why this order:** Rate limit before Turnstile (Turnstile is a paid external call; don't burn budget on spammers). Content-type guard before rate limit because a wrong content-type would cause `request.formData()` or `request.json()` to throw before we can even check the rate limit — putting the guard first makes error handling explicit.

```typescript
// Source: disputes.ts canonical pattern, extended with content-type guard
export async function POST(context: APIContext): Promise<Response> {
  // 1. Content-type guard — MUST come before body parsing
  const contentType = context.request.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) {
    return new Response(JSON.stringify({ error: 'Unsupported Media Type' }), {
      status: 415,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  const db = getDB(context);
  const ip = getClientIP(context);

  // 2. Rate limit
  const rateLimit = await checkRateLimit(db, ip, 'dispute', 3, 3600);
  if (!rateLimit.allowed) {
    const status = rateLimit.error ? 503 : 429;
    return new Response(JSON.stringify({ error: '...' }), {
      status,
      headers: {
        'Content-Type': 'application/json',
        'Retry-After': String(rateLimit.retryAfterSeconds)
      }
    });
  }

  // 3. Parse body (safe: content-type already verified)
  const body = await context.request.json();

  // 4. Validate
  const errors = validateDisputeForm(body);
  if (errors.length > 0) {
    return new Response(JSON.stringify({ error: 'Validation failed', details: errors }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  // 5. Sanitize (after validation passes)
  // ... sanitizeText() calls before DB write
}
```

### Pattern 2: Content-Type Guard for formData Endpoints

**What:** For `/api/bug-reports` and `/api/contact`, check that Content-Type is `multipart/form-data` or `application/x-www-form-urlencoded`. Use `includes()` for formData because `multipart/form-data` headers include a boundary parameter (e.g., `multipart/form-data; boundary=----WebKitFormBoundary...`).

**Critical:** `request.formData()` throws a `TypeError` when Content-Type is absent or wrong. The guard MUST precede the `await context.request.formData()` call. If the guard is placed after, the catch block sees a TypeError (500 to client) instead of the intended 415.

```typescript
// For formData endpoints (bug-reports, contact)
const contentType = context.request.headers.get('content-type') || '';
const isForm = contentType.includes('multipart/form-data') ||
               contentType.includes('application/x-www-form-urlencoded');
if (!isForm) {
  return new Response(JSON.stringify({ error: 'Unsupported Media Type' }), {
    status: 415,
    headers: { 'Content-Type': 'application/json' }
  });
}
// Safe to call formData() now
const formData = await context.request.formData();
```

### Pattern 3: SQL LIKE Wildcard Escape

**What:** User input passed to a `LIKE` clause must have `%`, `_`, and `\` escaped with `\` before binding. The LIKE clause then appends `ESCAPE '\'`.

**Why all three:** `%` and `_` are LIKE wildcards. `\` is the chosen escape character itself — if a user types a backslash, it must be escaped or it would "consume" the next character, breaking the escape logic.

**SQLite syntax verified:** `ESCAPE '\''` (single backslash char in SQL string, represented as `'\\'` in a JS string literal).

```typescript
// Source: verified against sqlite.org/lang_expr.html
export function escapeLikePattern(input: string): string {
  // Escape the escape character itself first, then wildcards
  return input
    .replace(/\\/g, '\\\\')
    .replace(/%/g, '\\%')
    .replace(/_/g, '\\_');
}

// Usage in search endpoint
const escaped = escapeLikePattern(query.trim());
const pattern = `%${escaped}%`;
// SQL: WHERE b.address LIKE ? ESCAPE '\'
// Binding: .bind(pattern)
```

**SQL side — both LIKE clauses in the query need the ESCAPE clause:**
```sql
WHERE b.address LIKE ? ESCAPE '\'
   OR b.neighborhood LIKE ? ESCAPE '\'
   OR l.name LIKE ? ESCAPE '\'
```

### Pattern 4: Shared Primitive — `enforceMaxLength`

**What:** Single helper that produces a `ValidationError | null`. Every form validator calls it instead of repeating the inline length check.

```typescript
// Source: pattern derived from existing validateReviewForm inline checks
export function enforceMaxLength(
  value: string | undefined | null,
  max: number,
  fieldName: string,
  label: string
): ValidationError | null {
  if (value && value.length > max) {
    return { field: fieldName, message: `${label} must be ${max} characters or less.` };
  }
  return null;
}
```

### Pattern 5: Shared Primitive — `isValidEmail`

```typescript
// Pragmatic regex — accepts a@b.c, rejects 'notanemail'
// Source: locked in CONTEXT.md
export function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}
```

### Pattern 6: GET Endpoint Rate Limiting

GET endpoints (`/api/search/*`) don't have a body, so no content-type guard is needed. Rate limit check happens at the top, before any query construction.

```typescript
export async function GET(context: APIContext): Promise<Response> {
  const db = getDB(context);
  const ip = getClientIP(context);

  const rateLimit = await checkRateLimit(db, ip, 'search-results', 60, 60);
  if (!rateLimit.allowed) {
    const status = rateLimit.error ? 503 : 429;
    return new Response(JSON.stringify({ error: 'Too many requests.' }), {
      status,
      headers: {
        'Content-Type': 'application/json',
        'Retry-After': String(rateLimit.retryAfterSeconds)
      }
    });
  }

  const query = (context.url.searchParams.get('q') || '').trim();
  if (query.length > 200) {
    return new Response(JSON.stringify({ error: 'Validation failed', details: [{ field: 'q', message: 'Search query must be 200 characters or less.' }] }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    });
  }
  // ...
}
```

### Recommended Additions to `validation.ts`

New exports to add (file grows from 109 to ~300 lines):

1. `isValidEmail(s: string): boolean`
2. `isValidZipCode(s: string): boolean`
3. `enforceMaxLength(value, max, fieldName, label): ValidationError | null`
4. `escapeLikePattern(input: string): string`
5. `validateDisputeForm(body: unknown): ValidationError[]`
6. `validateBugReport(data: {email?: string, category?: string, description?: string, url?: string}): ValidationError[]`
7. `validateContactForm(data: {name?: string, email?: string, category?: string, message?: string}): ValidationError[]`
8. `validateSearch(q: string | null): ValidationError[]`

### Anti-Patterns to Avoid

- **Guard placed after body parse:** `await request.formData()` with wrong content-type throws `TypeError` — the guard must precede the `await` call, not follow it.
- **Escaping only `%` in LIKE patterns:** Forgetting `_` (matches any single char) and `\` (breaks escape logic for backslash inputs) leaves partial vulnerability.
- **`ESCAPE '\\'` in TypeScript string vs. `ESCAPE '\'` in SQL:** In a JS string, the backslash must be `\\` to produce a single `\` character. In the raw SQL string passed to D1, it should be `ESCAPE '\'` (one char). Verify the JS string produces the correct SQL.
- **Applying sanitizeText before length check:** A 5001-char input with HTML tags might shrink below 5000 after stripping. The decision is locked: validate raw length first, sanitize after validation passes.
- **Short-circuiting validators:** All new validators must collect all errors before returning — do not return early on first error. Matches `validateReviewForm` pattern.
- **503 vs 429 for rate-limit DB failure:** When `rateLimit.error` is `true`, return 503, not 429. This is the `disputes.ts` pattern; replicate it in every endpoint.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Rate limiting | Custom sliding-window logic | `checkRateLimit` from `rateLimit.ts` | Already D1-backed, fail-closed, tested (9 unit tests passing) |
| IP extraction | Custom header parsing | `getClientIP(context)` from `rateLimit.ts` | Handles CF-Connecting-IP → X-Forwarded-For → X-Real-IP fallback chain |
| HTML sanitization | Custom tag stripper | `sanitizeText()` from `validation.ts` | Already strips tags and collapses whitespace, tested |
| ValidationError type | New interface | `ValidationError` from `validation.ts` | Already exported with `{field, message}` shape |

---

## Common Pitfalls

### Pitfall 1: Content-Type Guard Placement (Critical)

**What goes wrong:** Developer adds content-type check after `await request.formData()`. Wrong content-type causes `formData()` to throw `TypeError`, landing in the catch block and returning 500 instead of 415.

**Why it happens:** Logical flow makes it feel natural to parse first, then validate. But body-parsing APIs throw before you get a chance to check.

**How to avoid:** Content-type guard is always the first statement in the function body, before any `await request.*` call.

**Warning signs:** Test for wrong content-type returns 500 instead of 415; error logs show `TypeError: Could not parse content as FormData`.

### Pitfall 2: Incomplete LIKE Wildcard Escaping

**What goes wrong:** Escaping only `%` but forgetting `_` and `\`. A user searching `_` gets all rows (it matches any single character). A user searching `\%` breaks the escape sequence.

**Why it happens:** `%` is the most visible wildcard; `_` and `\` are less commonly considered.

**How to avoid:** The `escapeLikePattern` helper escapes in the correct order — `\` first (to avoid double-escaping), then `%`, then `_`. Tests include inputs containing all three characters.

**Warning signs:** Searching for `_` returns more results than expected.

### Pitfall 3: `ESCAPE` Clause Omitted from Multi-LIKE Queries

**What goes wrong:** The escape helper runs fine, but the LIKE clause doesn't include `ESCAPE '\'`, so D1/SQLite treats the backslashes as literal characters in the pattern rather than escape prefixes. Query `\%` never matches anything instead of matching literal `%`.

**Why it happens:** The `ESCAPE` clause must be appended to *each* individual `LIKE ? ` expression, not once at the end of the WHERE clause.

**How to avoid:** In `results.ts`, the WHERE clause uses three LIKE conditions. Each one needs `LIKE ? ESCAPE '\'`:
```sql
WHERE b.address LIKE ? ESCAPE '\'
   OR b.neighborhood LIKE ? ESCAPE '\'
   OR l.name LIKE ? ESCAPE '\'
```

### Pitfall 4: JS String Escaping for SQL ESCAPE Clause

**What goes wrong:** Developer writes `ESCAPE '\\\\'` (four backslashes in JS) intending one backslash, or `ESCAPE '\\'` when the SQL needs `ESCAPE '\'`.

**Why it happens:** JS string escaping and SQL string escaping are separate layers.

**How to avoid:** In a JS template literal or string, `'\\'` produces the single character `\`. So the SQL fragment should be written as `LIKE ? ESCAPE '\\'` in the JS source, which sends the SQL text `LIKE ? ESCAPE '\'` to D1. Unit-test the escape function output, not just the SQL string concatenation.

### Pitfall 5: `contact.ts` Already Has Rate Limiting But No `Retry-After`

**What goes wrong:** Developer assumes `contact.ts` is already fully up-to-date and skips adding content-type guard or the structured validator.

**Why it happens:** `contact.ts` does have rate limiting (3/hr) so it looks "done."

**How to avoid:** Phase 17 must still add (a) content-type guard and (b) replace inline single-error checks with `validateContactForm()` returning `ValidationError[]`. The `Retry-After` header retro-fit for `contact.ts` is deferred to Phase 21.

### Pitfall 6: `disputes.ts` Rate Limit Uses `getClientIP({ request })` Not `getClientIP(context)`

**What goes wrong:** Inconsistency between `disputes.ts` (passes `{ request }`) and `contact.ts` (passes the full context) is copied without understanding.

**Why it happens:** `getClientIP` accepts `any` — both forms work because it only needs `context.request.headers`. But the canonical form is `getClientIP(context)` for Astro `APIContext`.

**How to avoid:** New endpoints should pass the full `context` object. Either form works functionally; use the `contact.ts` pattern (`getClientIP(context)`) for consistency in new code.

---

## Code Examples

### Complete `validateDisputeForm` using new shared primitives

```typescript
// Source: derived from existing validateReviewForm pattern + locked CONTEXT.md decisions
export function validateDisputeForm(body: Record<string, unknown>): ValidationError[] {
  const errors: ValidationError[] = [];
  const { landlordName, landlordEmail, landlordPhone, disputeExplanation } = body;

  // landlordName: required, max 200
  if (!landlordName || typeof landlordName !== 'string' || !landlordName.trim()) {
    errors.push({ field: 'landlordName', message: 'Landlord name is required.' });
  } else {
    const err = enforceMaxLength(landlordName, 200, 'landlordName', 'Landlord name');
    if (err) errors.push(err);
  }

  // landlordEmail: required, format check
  if (!landlordEmail || typeof landlordEmail !== 'string' || !landlordEmail.trim()) {
    errors.push({ field: 'landlordEmail', message: 'Landlord email is required.' });
  } else if (!isValidEmail(landlordEmail.trim())) {
    errors.push({ field: 'landlordEmail', message: 'Email format is invalid.' });
  }

  // landlordPhone: required, max 30
  if (!landlordPhone || typeof landlordPhone !== 'string' || !landlordPhone.trim()) {
    errors.push({ field: 'landlordPhone', message: 'Landlord phone is required.' });
  } else {
    const err = enforceMaxLength(landlordPhone, 30, 'landlordPhone', 'Landlord phone');
    if (err) errors.push(err);
  }

  // disputeExplanation: optional, max 5000
  if (disputeExplanation && typeof disputeExplanation === 'string') {
    const err = enforceMaxLength(disputeExplanation, 5000, 'disputeExplanation', 'Dispute explanation');
    if (err) errors.push(err);
  }

  return errors;
}
```

### `validateSearch` with length cap (no minimum enforcement)

```typescript
export function validateSearch(q: string | null): ValidationError[] {
  const errors: ValidationError[] = [];
  const trimmed = (q || '').trim();
  if (trimmed.length > 200) {
    errors.push({ field: 'q', message: 'Search query must be 200 characters or less.' });
  }
  return errors;
}
```

### LIKE ESCAPE applied in `results.ts`

```typescript
// After validation passes and query is trimmed:
if (query) {
  const escaped = escapeLikePattern(query);
  const pattern = `%${escaped}%`;
  // SQL uses LIKE ? ESCAPE '\' on each LIKE expression
  binds = [pattern, pattern, pattern];
}
// SQL fragment:
// WHERE b.address LIKE ? ESCAPE '\'
//    OR b.neighborhood LIKE ? ESCAPE '\'
//    OR l.name LIKE ? ESCAPE '\'
```

---

## Existing Test Coverage Assessment

### Unit Tests (Vitest, `src/lib/__tests__/`)

| File | Covers | Gap for Phase 17 |
|------|--------|-----------------|
| `validation.test.ts` | `validateReviewForm`, `sanitizeText` | No tests for new primitives or new validators — Wave 0 work |
| `rateLimit.test.ts` | `checkRateLimit` (9 tests), `getClientIP` (7 tests) | None — fully covered |
| `searchResults.test.ts` | Client-side pagination/dedup logic | No LIKE escape tests — Wave 0 work |

### E2E Tests (Playwright, `e2e/security.spec.ts`)

The existing `security.spec.ts` tests are labeled `SEC-04` through `SEC-08` (old numbering from a pre-v1.5.0 audit). They cover auth bypass, privilege escalation, SQL injection, XSS, and rate limiting for `signin`/`signup`. **They do not cover:**
- Rate limiting for `bug-reports`, `search/results`, `search/autocomplete`
- Content-type guard behavior (415 responses)
- Field-level validation errors on dispute/contact/bug-report forms
- Search wildcard escaping

These gaps are Wave 0 test scaffolding needed before implementation.

### `clearRateLimits()` is in `security.spec.ts`, not `fixtures.ts`

The helper is defined inline in `security.spec.ts` (lines 11-16). It is not in `e2e/fixtures.ts`. REQUIREMENTS.md TEST-03 explicitly calls for extracting it to `fixtures.ts` — but that is Phase 20 work. Phase 17 tests should either duplicate the call or import from `security.spec.ts` (not ideal). The pragmatic choice: Phase 17 E2E test file defines its own `clearRateLimits()` call, and Phase 20 does the extraction.

---

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest 4.0.18 |
| Config file | `vitest.config.ts` (project root) |
| Quick run command | `npm test` |
| Full suite command | `npm test` (runs all `src/**/*.test.ts`) |
| E2E command | `npm run e2e` (Playwright, requires build + db:setup) |

### Phase Requirements to Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| SEC-04 | `/api/bug-reports` returns 429 after 5 requests/hr | E2E (Playwright) | `npx playwright test e2e/security.spec.ts` | Partial — file exists, new test needed |
| SEC-05 | `/api/search/results` returns 429 after 60/min; `/api/search/autocomplete` after 120/min | E2E (Playwright) | `npx playwright test e2e/security.spec.ts` | New test needed |
| VAL-01 | `validateDisputeForm` returns error for bad `landlordEmail`, rejects over-length `disputeExplanation` | Unit (Vitest) | `npm test -- validation` | ❌ Wave 0 |
| VAL-02 | `validateBugReport` rejects over-length `description`; POST `/api/bug-reports` with wrong content-type returns 415 | Unit + E2E | `npm test -- validation` | ❌ Wave 0 |
| VAL-03 | `validateContactForm` rejects `notanemail`, enforces length | Unit (Vitest) | `npm test -- validation` | ❌ Wave 0 |
| VAL-04 | `validateSearch` rejects query > 200 chars; search with `5%` literal returns correct results | Unit + E2E | `npm test -- validation` | ❌ Wave 0 |
| VAL-05 | `isValidEmail('notanemail')` = false; `isValidEmail('a@b.c')` = true; `isValidZipCode('02134')` = true; `enforceMaxLength` boundary tests | Unit (Vitest) | `npm test -- validation` | ❌ Wave 0 |

### Sampling Rate

- **Per task commit:** `npm test` (unit tests only, ~2s)
- **Per wave merge:** `npm test` (full unit suite)
- **Phase gate:** Full unit suite green + manual E2E smoke of all four endpoints before `/gsd:verify-work`

### Wave 0 Gaps

- [ ] `src/lib/__tests__/validation.test.ts` — add test blocks for `isValidEmail`, `isValidZipCode`, `enforceMaxLength`, `escapeLikePattern`, `validateDisputeForm`, `validateBugReport`, `validateContactForm`, `validateSearch` — covers VAL-01 through VAL-05
- [ ] `e2e/security.spec.ts` — add test block for rate limits on `bug-reports` (SEC-04), `search/results`, `search/autocomplete` (SEC-05), and content-type 415 tests for all three POST endpoints

---

## State of the Art

| Old Approach | Current Approach | Endpoint |
|--------------|------------------|----------|
| No rate limit | 5/hr per IP | `/api/bug-reports` |
| No rate limit | 60/min per IP | `/api/search/results` |
| No rate limit | 120/min per IP | `/api/search/autocomplete` |
| Inline single-error validation | `ValidationError[]` multi-field validator | `disputes.ts`, `contact.ts` |
| No content-type guard | 415 on wrong/missing | All three POST endpoints |
| Raw `%${input}%` | `%${escaped}%` + `ESCAPE '\'` | Both search endpoints |
| No shared email/length primitives | `isValidEmail`, `isValidZipCode`, `enforceMaxLength` | All new validators |

---

## Open Questions

1. **`contact.ts` rate-limit ordering inconsistency**
   - What we know: `contact.ts` calls Turnstile *before* rate limit. `disputes.ts` calls rate limit *before* Turnstile (matching CONTEXT.md locked order).
   - What's unclear: The CONTEXT.md says rate limit before Turnstile "because Turnstile is a paid call." Phase 17 adds a content-type guard to `contact.ts` but should it also reorder Turnstile vs rate limit?
   - Recommendation: Reorder `contact.ts` to match the locked order (content-type → rate limit → Turnstile → validate). This is a low-risk mechanical change included in Plan 17-01 work on `contact.ts`.

2. **`disputes.ts` inline validation removal scope**
   - What we know: The current `disputes.ts` has several inline validation checks beyond what VAL-01 requires (e.g., `Array.isArray(disputeReasons)`, `extractReviewIdFromUrl` check, review existence check).
   - What's unclear: Should Phase 17 move the `disputeReasons` array check into `validateDisputeForm`, or leave non-field-value checks inline?
   - Recommendation: Leave business-logic checks (`disputeReasons` array, `reviewId` extraction, DB existence checks) inline in the endpoint. `validateDisputeForm` only validates field values that map to form inputs — matching the `validateReviewForm` pattern.

---

## Sources

### Primary (HIGH confidence)

- Verified codebase: `src/lib/validation.ts` (109 lines), `src/lib/rateLimit.ts` (98 lines), `src/pages/api/contact.ts`, `src/pages/api/disputes.ts`, `src/pages/api/bug-reports.ts`, `src/pages/api/search/results.ts`, `src/pages/api/search/autocomplete.ts`
- Verified test files: `src/lib/__tests__/validation.test.ts`, `src/lib/__tests__/rateLimit.test.ts`, `e2e/security.spec.ts`
- [MDN: Request.formData()](https://developer.mozilla.org/en-US/docs/Web/API/Request/formData) — TypeError throw conditions for wrong/missing content-type
- [SQLite LIKE ESCAPE syntax](https://sqlite.org/lang_expr.html) — verified `ESCAPE` clause behavior for `%`, `_`, and `\`

### Secondary (MEDIUM confidence)

- [Cloudflare Workers Request docs](https://developers.cloudflare.com/workers/runtime-apis/request/) — confirms `formData()` and `json()` method availability; does not document error conditions explicitly

### Tertiary (LOW confidence)

- WebSearch results on `request.formData()` TypeError behavior — corroborated by MDN primary source; MEDIUM confidence overall

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all libraries verified from live codebase
- Architecture patterns: HIGH — patterns derived directly from existing `disputes.ts` and `validation.ts`
- Pitfalls: HIGH for content-type placement (MDN-verified throw behavior) and LIKE escaping (SQLite docs verified); MEDIUM for JS/SQL escaping string confusion (reasoning-based)
- Test gaps: HIGH — confirmed by direct inspection of test files

**Research date:** 2026-04-28
**Valid until:** 2026-06-01 (stable codebase; no upstream library churn expected)
