# Phase 18: CSRF Audit and Async Email - Research

**Researched:** 2026-04-28
**Domain:** Cloudflare Workers ctx.waitUntil, Astro 5 security.checkOrigin, Web Crypto / oslo sha256
**Confidence:** HIGH

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**CSRF audit — three deliverables:**
1. `.planning/audits/csrf-2026-04.md` — full audit with per-endpoint-category analysis, evidence links, explicit verdict
2. `src/middleware.ts` — inline comment near the top: `// CSRF audit (2026-04-28): see .planning/audits/csrf-2026-04.md — verdict: SameSite=Lax + Turnstile + Astro checkOrigin sufficient; no token implementation required.`
3. `CLAUDE.md` — short paragraph INSIDE existing "Security Checklist" section: CSRF subsection noting verdict, audit date, and pointer to audit doc

**Audit content:** per-endpoint-category structure (four categories: authenticated POST, public POST, GET, OAuth callback)

**Date stamping:** date-only (2026-04-28), no calendar revisit deadline

**Five routes in scope for async email refactor:**
- `/api/auth/signup` (PERF-01)
- `/api/auth/forgot-password` (PERF-02)
- `/api/contact` (PERF-03)
- `/api/disputes` (PERF-04)
- `/api/auth/resend-verification` (PERF-01 companion, appended to PERF-01 description in REQUIREMENTS.md)

**waitUntil null-guard:** fall back to `void wrapped` (not `await`) when `context.locals.runtime?.ctx` is undefined — never silently skip, never throw

**New helper:** `fireAndForget(context: APIContext, promise: Promise<unknown>): void` in `src/lib/runtime.ts` (colocated with `getEnv`)

**Helper signature (locked):**
```typescript
export function fireAndForget(context: APIContext, promise: Promise<unknown>): void {
  const ctx = context.locals.runtime?.ctx;
  const wrapped = promise.catch((err) => logError('fireAndForget failed', { route: context.url.pathname, error: err }));
  if (ctx?.waitUntil) {
    ctx.waitUntil(wrapped);
  } else {
    void wrapped;
  }
}
```

**Call site pattern (locked):**
```typescript
fireAndForget(context, sendVerificationEmail(getEnv(context).RESEND_API_KEY, siteUrl, email, token));
```

**Observability:** `logError` from `src/lib/logger.ts`, no `email_failures` DB table

**Log payload:** `{ route: context.url.pathname, recipient_hash: sha256(email).slice(0, 8), error: err.message, stack: err.stack }`

**Order of operations (locked):** content-type → rate limit → Turnstile → validate → DB write → `fireAndForget(...)` → return response

**Out of scope (explicit):** CSP/X-Frame-Options revisit, token-based CSRF, SameSite=Strict migration, calendar audit re-run reminder, `email_failures` table, `cf-csp-report-uri`, `getCtx()` general helper, email-failure UI for users, OAuth state cookie hardening

### Claude's Discretion

- Exact wording of audit doc paragraphs (verdict and analysis text)
- Whether `fireAndForget` lives in `src/lib/runtime.ts` (recommended) or a new `src/lib/async.ts` file
- Exact sha256 implementation for recipient hashing (Web Crypto SubtleCrypto vs node:crypto fallback)
- Whether audit doc lists every cookie set in codebase exhaustively or summarizes by category
- Whether middleware.ts comment is 2 lines or 5-8 lines

### Deferred Ideas (OUT OF SCOPE)

- `email_failures` table for retry/reconciliation
- Calendar-based audit re-run reminder
- CSP / security-header revisit
- `cf-csp-report-uri` integration
- `getCtx(context)` general helper
- Email-failure UI for users
- OAuth state cookie rotation/expiry hardening
</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| SEC-06 | CSRF protection audit completed against Astro 5 `security.checkOrigin` defaults, Lucia v3 session cookie attributes, and Cloudflare Turnstile coverage; conclusion documented in `middleware.ts` and `CLAUDE.md` | Verified actual source of `createOriginCheckMiddleware`; verified cookie attributes in middleware.ts and google.ts; audited each endpoint category |
| PERF-01 | `/api/auth/signup` converted to `ctx.waitUntil` with null guard (+ resend-verification companion) | Verified ctx.waitUntil type in @cloudflare/workers-types; verified adapter wires it; verified oslo sha256 works in Vitest |
| PERF-02 | `/api/auth/forgot-password` converted to `waitUntil` with null guard | Same infrastructure; current blocking pattern identified at line 90 |
| PERF-03 | `/api/contact` converted to `waitUntil` (two emails) | Current pattern identified at lines 78, 83; both must be fire-and-forgot |
| PERF-04 | `/api/disputes` converted to `waitUntil` (confirmation email) | Current pattern identified at lines 161-176; RESEND_API_KEY guard must be preserved |
</phase_requirements>

---

## Summary

Phase 18 has two independent deliverables that can be planned in separate waves. The CSRF deliverable is documentation-only: the codebase already has sufficient defenses (SameSite=Lax session cookies, Turnstile on public forms, Astro's checkOrigin middleware, OAuth state cookie). The research confirms the verdict is correct — no token-based CSRF is needed. The async email deliverable is a mechanical refactor: replace `await sendXxxEmail(...)` with `fireAndForget(context, sendXxxEmail(...))` across five routes, backed by a thin helper in `src/lib/runtime.ts`.

Critical technical findings: (1) `ctx.waitUntil` is typed non-optional in `App.Platform` per `src/env.d.ts`, but `context.locals.runtime` itself is undefined in Vitest unit tests because they bypass the `@astrojs/cloudflare` handler — so the `?.` null-guard on `context.locals.runtime?.ctx` is essential and correct. (2) The sha256 for recipient hashing should use `@oslojs/crypto/sha2` (already in the project, synchronous, pure JS, no Web Crypto dependency, works in both Workers and happy-dom Vitest). (3) `checkOrigin` does NOT fire for `application/json` content-type; `disputes.ts` is therefore not covered by it and relies on Turnstile + rate limiting — this must be documented accurately in the audit.

**Primary recommendation:** Wave A = fireAndForget helper + 5 route conversions (unit tests for helper). Wave B = CSRF audit document + middleware.ts comment + CLAUDE.md update (no tests). The waves are independent and can be planned in either order.

---

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@oslojs/crypto` | `^1.0.1` (already installed) | sha256 for recipient hashing | Pure JS, synchronous, already in project (used in `password.ts`), works in Vitest happy-dom without polyfill |
| `@oslojs/encoding` | `^1.1.0` (already installed) | `encodeHexLowerCase` to stringify sha256 Uint8Array | Already in project (used in `password.ts`) |
| `@astrojs/cloudflare` | `^12.6.12` (already installed) | Provides `ctx.waitUntil` wrapper in `runtime.locals` | Adapter sets up `ctx` in `locals.runtime` via `handler.js` |
| `@cloudflare/workers-types` | `^4.20260117.0` (already installed) | `ExecutionContext` type with `waitUntil(promise: Promise<any>): void` | Type-level guarantee |

### No New Dependencies
This phase requires zero new npm installs. All necessary libraries are already in `package.json`.

---

## Architecture Patterns

### waitUntil — How the Adapter Wires It

Source: `node_modules/@astrojs/cloudflare/dist/utils/handler.js` lines 24-36 (verified):

```javascript
const locals = {
  runtime: {
    env,
    cf: request.cf,
    caches,
    ctx: {
      waitUntil: (promise) => context.waitUntil(promise),
      passThroughOnException: () => { throw new Error("...") },
      props: {}
    }
  }
};
```

`context` here is the Workers `ExecutionContext` passed into `fetch(request, env, context)`. This path runs in both Wrangler dev and production. The `context.waitUntil(promise)` call extends the Worker's lifetime past the response so the promise can resolve without blocking the response stream.

### ctx.waitUntil — Race Condition Clarification

**Not a race condition.** The Workers runtime guarantees that promises registered with `waitUntil` complete before the isolate is terminated — even after the response has been sent. The pattern is:

1. Handler calls `fireAndForget(context, emailPromise)` → registers promise with `ctx.waitUntil`
2. Handler `return`s the success `Response` — sent immediately to the client
3. Workers runtime keeps the isolate alive until the `emailPromise` resolves/rejects
4. `.catch(logError)` captures any rejection so it doesn't surface as an unhandled promise rejection (which would crash the Worker)

**Critical:** `.catch()` is mandatory. An unhandled rejection inside `waitUntil` crashes the Worker in production. The CONTEXT.md helper already wraps this correctly.

### fireAndForget — Correct Fallback Behavior

The CONTEXT.md helper uses `void wrapped` (not `await wrapped`) in the fallback branch. This is correct:
- `void wrapped` schedules the promise microtask without awaiting — essentially non-blocking
- The promise is still running; it won't be garbage-collected
- In a Vitest test, the promise resolves in the same microtask queue as the test — a test that checks a side effect of the email send needs to `await` a small tick or mock the send function

**Contrast with the `await` alternative:** If the fallback were `await wrapped`, it would block the endpoint response in tests and local dev — defeating the purpose and creating a misleading test environment.

### sha256 Recipient Hashing — Recommended Implementation

Use `@oslojs/crypto/sha2` (already in project). The `sha256` function is synchronous, takes `Uint8Array`, returns `Uint8Array`. Use `encodeHexLowerCase` from `@oslojs/encoding` to convert to hex string.

**Why not `crypto.subtle.digest`?** SubtleCrypto's `digest()` is async (returns `Promise<ArrayBuffer>`). Using it inside a `.catch()` callback inside `fireAndForget` would create a nested async chain that complicates the helper without benefit. The oslo sha256 is simpler and produces the same output.

```typescript
// Source: verified from node_modules/@oslojs/crypto/dist/sha2/sha256.d.ts
// and node_modules/@oslojs/encoding/dist/index.d.ts
import { sha256 } from '@oslojs/crypto/sha2';
import { encodeHexLowerCase } from '@oslojs/encoding';

function hashRecipient(email: string): string {
  const encoder = new TextEncoder();
  const data = encoder.encode(email.toLowerCase());
  return encodeHexLowerCase(sha256(data)).slice(0, 8);
}
```

This function is synchronous and works in Vitest (happy-dom) without any polyfill — confirmed because `password.test.ts` already uses `@oslojs/crypto` (sha256) in the same test environment and all 311 tests pass.

### logError — Confirmed API Surface

Source: verified from `src/lib/logger.ts` (read directly):

```typescript
export function logError(event: string, context: LogContext): void
```

Where `LogContext` is:
```typescript
interface LogContext {
  endpoint?: string;
  ip?: string;
  error?: string;
  request_id?: string;
  [key: string]: any;  // open index signature — accepts arbitrary keys
}
```

**Key finding:** `LogContext` has an open index signature (`[key: string]: any`). The CONTEXT.md log payload shape `{ route, recipient_hash, error, stack }` is fully compatible — all fields spread into the logged JSON object. No changes to `logger.ts` are needed.

**Existing test coverage:** `src/lib/__tests__/logger.test.ts` verifies that arbitrary context keys are spread into the JSON output (line: `expect(parsed.endpoint).toBe('/api/test')`). The same mechanism covers `route`, `recipient_hash`, `stack`.

### checkOrigin — Exact Behavior (Verified from Source)

Source: `node_modules/astro/dist/core/app/middlewares.js` (read directly):

```javascript
const FORM_CONTENT_TYPES = [
  "application/x-www-form-urlencoded",
  "multipart/form-data",
  "text/plain"
];
const SAFE_METHODS = ["GET", "HEAD", "OPTIONS"];

// Logic:
if (SAFE_METHODS.includes(request.method)) return next();  // GET/HEAD/OPTIONS always pass
if (hasContentType) {
  if (hasFormLikeHeader && !isSameOrigin) → 403            // form POST from other origin blocked
  // else (non-form content-type, e.g. application/json): next() — NO origin check
} else {
  if (!isSameOrigin) → 403  // no content-type from other origin blocked
}
```

**Critical audit finding:** `checkOrigin` does NOT cover `application/json` POST requests. The condition is: when `content-type` is present AND is not a form-like type, the request passes through regardless of origin.

**Implications per endpoint:**
- `signup.ts` — sends `multipart/form-data` → covered by checkOrigin
- `forgot-password.ts` — sends `multipart/form-data` → covered by checkOrigin
- `resend-verification.ts` — sends `multipart/form-data` → covered by checkOrigin
- `contact.ts` — sends form data (multipart or url-encoded) → covered by checkOrigin
- `disputes.ts` — sends `application/json` → NOT covered by checkOrigin; relies on Turnstile + rate limit
- OAuth callback — GET request → exempt from checkOrigin (state cookie provides protection)

**Wiring:** `checkOrigin` is enabled via `createOriginCheckMiddleware()` inserted into the middleware chain when `manifest.checkOrigin === true`. The manifest's `checkOrigin` flag is set to `true` only when `settings.config.security?.checkOrigin && settings.buildOutput === "server"`. Since `astro.config.mjs` uses `output: 'server'` and does not override `security.checkOrigin`, it defaults to `true` (verified from schema: `ASTRO_CONFIG_DEFAULTS.security.checkOrigin = true`).

### Current Email Patterns — What Gets Replaced

**signup.ts** (line ~112-129): Email send is inside an inner `try/catch` block with `await`. The entire inner try block gets replaced with one `fireAndForget` call. The outer session creation and response remain unchanged.

**forgot-password.ts** (line ~90-99): `const emailResult = await sendPasswordResetEmail(...)`. Replaced with `fireAndForget(context, sendPasswordResetEmail(...))`. The `if (!emailResult.success)` check disappears — failures are now caught inside the helper. The `successResponse` is returned regardless (already the pattern for enumeration prevention).

**resend-verification.ts** (line ~60-73): `const emailResult = await sendVerificationEmail(...)`. Currently, the function returns a 500 if `!emailResult.success`. After conversion: always return 200 — the email is fire-and-forgot, failures don't propagate to the user response. NOTE: this is a behavior change — the route currently returns 500 on email failure; after refactor it always returns 200. This is acceptable per CONTEXT.md reasoning ("users have explicit resend buttons").

**contact.ts** (lines 78, 83): Two sequential `await ... .catch(...)` calls. Both get replaced with two `fireAndForget` calls. They remain sequential in declaration order (which affects nothing since both are non-blocking).

**disputes.ts** (lines 159-178): Currently has `if (resendApiKey)` guard around the send, and an inner try/catch. After refactor: `if (resendApiKey)` guard is preserved but the inner try/catch becomes `fireAndForget(context, sendDisputeConfirmationEmail(...))`.

### Recommended Project Structure Changes

```
src/lib/
├── runtime.ts        # ADD: fireAndForget() below getEnv()
├── logger.ts         # NO CHANGE — existing logError() is compatible
src/middleware.ts     # ADD: 2-3 line inline comment near top (before auth try block)
CLAUDE.md             # ADD: CSRF subsection inside Security Checklist
.planning/
└── audits/
    └── csrf-2026-04.md   # NEW: first file in this new directory
```

### Anti-Patterns to Avoid

- **Do not `await fireAndForget(...)`:** The function returns `void`. TypeScript will error if you try to await it, which is by design.
- **Do not omit the `.catch()` inside the helper:** A bare `ctx.waitUntil(promise)` without a catch will cause an unhandled rejection in production and crash the Worker.
- **Do not use `SubtleCrypto.digest` for recipient hashing:** It's async, complicates the catch callback, and the oslo sha256 is already in the project and synchronous.
- **Do not remove the `if (resendApiKey)` guard in disputes.ts without explicit approval:** That guard is a safety net for environments where RESEND_API_KEY may not be set. The CONTEXT.md does not say to remove it.
- **Do not change the DB-then-email ordering:** The verification token must be committed to the DB before `fireAndForget` schedules the email. Otherwise the email link could 404.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Hex encoding of sha256 bytes | Custom hex loop | `encodeHexLowerCase` from `@oslojs/encoding` | Already in project; correct, tested |
| sha256 computation | `crypto.subtle.digest` async chain | `sha256` from `@oslojs/crypto/sha2` | Synchronous, pure JS, works in Vitest without polyfill; already in project |
| waitUntil abstraction | Per-route null-guard inline | `fireAndForget()` in `runtime.ts` | DRY; single point for behavior change if ctx API changes |

---

## Common Pitfalls

### Pitfall 1: checkOrigin Doesn't Cover JSON Endpoints
**What goes wrong:** Audit claims "checkOrigin protects all POST endpoints." This is wrong.
**Why it happens:** Reading Astro docs without checking the implementation; docs say "POST" but the actual code only applies to form-like content types.
**How to avoid:** Audit must explicitly note that `disputes.ts` (application/json) is NOT covered by checkOrigin and document the actual protections (Turnstile + rate limiting + content-type guard).
**Warning signs:** Audit doc says "all POST endpoints" without caveat.

### Pitfall 2: Missing .catch() in waitUntil Crashes Workers
**What goes wrong:** `ctx.waitUntil(sendXxxEmail(...))` without `.catch()` — a Resend API failure becomes an unhandled rejection, which crashes the Cloudflare Worker isolate.
**Why it happens:** Developer assumes "fire and forget" means "ignore errors."
**How to avoid:** Always pass a promise with `.catch()` attached to `waitUntil`. The `fireAndForget` helper's internal `.catch(logError)` handles this.
**Warning signs:** Direct calls to `ctx.waitUntil(emailPromise)` without a `.catch`.

### Pitfall 3: resend-verification Behavior Change
**What goes wrong:** The refactored `resend-verification.ts` no longer returns 500 on email failure (it returns 200 always). Reviewers may flag this as a regression.
**Why it happens:** Current code: `if (!emailResult.success) { return 500 }`. After refactor: email result is ignored; always return 200.
**How to avoid:** Document the behavior change in the CONTEXT.md rationale. The CONTEXT.md already explains it: "silent email failure → user clicks resend → likely succeeds."
**Warning signs:** Test expecting 500 response when email fails for this endpoint.

### Pitfall 4: Unit Tests — runtime is undefined
**What goes wrong:** Unit test for `fireAndForget` calls it without setting `context.locals.runtime` → `context.locals.runtime?.ctx` is `undefined` → falls to `void wrapped` branch. Test passes but doesn't exercise the `waitUntil` path.
**Why it happens:** Vitest doesn't go through the `@astrojs/cloudflare` handler that sets up `locals.runtime`.
**How to avoid:** Write two test cases: (1) with `runtime: undefined` — verifies fallback branch and that promise resolves; (2) with a mocked `ctx.waitUntil` — verifies waitUntil is called and promise is registered. The helper's behavior is fully testable with simple object mocks.
**Warning signs:** Test only has one case and doesn't mock `ctx.waitUntil`.

### Pitfall 5: SameSite=Lax and the OAuth Callback
**What goes wrong:** Audit suggests switching to SameSite=Strict for "better security." This breaks the Google OAuth cross-site callback (Google redirects back to the app from a different origin).
**Why it happens:** SameSite=Strict prevents cookie transmission on cross-site navigations, including top-level redirects from OAuth providers.
**How to avoid:** Audit must document why Lax (not Strict) is the correct choice for this app. This is already in REQUIREMENTS.md Out of Scope and STATE.md decisions.
**Warning signs:** Audit recommends Strict.

### Pitfall 6: CONTEXT.md Fallback is void, not await
**What goes wrong:** Planner confuses `void wrapped` in the fallback with a no-op. `void wrapped` still schedules the promise; the promise runs but the caller doesn't await it.
**Why it happens:** `void expr` looks like "ignore this" but actually evaluates the expression (scheduling the microtask).
**How to avoid:** The distinction matters for test authors: in Vitest, the email send still fires in the microtask queue. If a test needs to verify the email send happened, it should mock the send function and use `await Promise.resolve()` to drain the queue.

---

## Code Examples

### fireAndForget Helper (Canonical Form)

```typescript
// src/lib/runtime.ts — add below getEnv()
// Source: CONTEXT.md decision + verified type from @cloudflare/workers-types ExecutionContext
import type { APIContext } from 'astro';
import { logError } from './logger';

export function fireAndForget(context: APIContext, promise: Promise<unknown>): void {
  const ctx = context.locals.runtime?.ctx;
  const wrapped = promise.catch((err) => logError('fireAndForget failed', {
    route: context.url.pathname,
    error: err instanceof Error ? err.message : String(err),
    stack: err instanceof Error ? err.stack : undefined,
  }));
  if (ctx?.waitUntil) {
    ctx.waitUntil(wrapped);
  } else {
    void wrapped;
  }
}
```

Note: The CONTEXT.md uses `err.message` and `err.stack` directly. Adding the `instanceof Error` guard makes this TypeScript-safe without changing behavior (errors in practice are always `Error` instances from the email lib).

### Recipient Hashing (for the logError call)

```typescript
// Source: verified @oslojs/crypto sha256.d.ts + @oslojs/encoding index.d.ts
import { sha256 } from '@oslojs/crypto/sha2';
import { encodeHexLowerCase } from '@oslojs/encoding';

function recipientHash(email: string): string {
  const bytes = sha256(new TextEncoder().encode(email.toLowerCase()));
  return encodeHexLowerCase(bytes).slice(0, 8);
}
```

This can live inline in the `logError` call inside `fireAndForget`, or extracted as a private helper in `runtime.ts`.

### Call Site — Replacing Existing await Blocks

```typescript
// BEFORE (signup.ts pattern):
try {
  const emailResult = await sendVerificationEmail(apiKey, siteUrl, email, token);
  if (!emailResult.success) { console.error(...); }
} catch (emailError) { console.error(...); }

// AFTER:
fireAndForget(context, sendVerificationEmail(getEnv(context).RESEND_API_KEY, siteUrl, email, token));
```

```typescript
// BEFORE (contact.ts pattern):
await sendContactConfirmationEmail(resendApiKey, email, name, safeCategory).catch((err) => {
  console.error('Failed to send contact confirmation email:', err);
});

// AFTER:
fireAndForget(context, sendContactConfirmationEmail(resendApiKey, email, name, safeCategory));
```

```typescript
// BEFORE (disputes.ts pattern):
if (resendApiKey) {
  try {
    await sendDisputeConfirmationEmail(resendApiKey, siteUrl, landlordEmail, { ... });
  } catch (emailError) { console.error(...); }
}

// AFTER:
if (resendApiKey) {
  fireAndForget(context, sendDisputeConfirmationEmail(resendApiKey, siteUrl, landlordEmail, { ... }));
}
```

### CSRF Audit Comment for middleware.ts

```typescript
// CSRF audit (2026-04-28): see .planning/audits/csrf-2026-04.md
// Verdict: SameSite=Lax session cookie + Cloudflare Turnstile + Astro checkOrigin sufficient.
// No token-based CSRF implementation required.
```

Place this before the `defineMiddleware(async (context, next) => {` call or immediately at the top of the `onRequest` function body.

---

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest 4.0.18 |
| Config file | `vitest.config.ts` (environment: happy-dom) |
| Quick run command | `npm test -- fireAndForget` (filter by name) |
| Full suite command | `npm test` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| PERF-01..04 | `fireAndForget` registers promise with `ctx.waitUntil` when ctx available | unit | `npm test -- fireAndForget` | ❌ Wave 0 |
| PERF-01..04 | `fireAndForget` uses void-fallback when runtime is undefined | unit | `npm test -- fireAndForget` | ❌ Wave 0 |
| PERF-01..04 | `fireAndForget` calls `logError` on promise rejection | unit | `npm test -- fireAndForget` | ❌ Wave 0 |
| PERF-01..04 | `recipientHash` produces 8-char hex string | unit | `npm test -- fireAndForget` | ❌ Wave 0 |
| SEC-06 | CSRF audit doc exists at `.planning/audits/csrf-2026-04.md` | manual-only | file existence check | ❌ Wave 0 (doc file) |
| SEC-06 | middleware.ts contains inline CSRF audit comment | manual-only | `grep` on file | N/A |

### Sampling Rate
- **Per task commit:** `npm test -- fireAndForget`
- **Per wave merge:** `npm test`
- **Phase gate:** Full suite (311 + new tests) green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `src/lib/__tests__/runtime.test.ts` — covers `fireAndForget` unit tests (waitUntil path, void fallback path, catch path, recipientHash)
- Framework install: none — Vitest already configured

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Blocking `await emailPromise` in API route | `ctx.waitUntil(emailPromise.catch(...))` — response returns immediately | This phase | P50 latency improvement proportional to Resend round-trip (~100-400ms) |
| `console.error` for email failures | `logError` structured JSON with recipient hash | This phase | Cloudflare logs become queryable/indexable; PII removed from logs |
| No CSRF audit doc | `.planning/audits/csrf-2026-04.md` establishes audit convention | This phase | Future engineers have documented rationale for "no CSRF tokens" decision |

---

## Open Questions

1. **resend-verification.ts behavior change — user-facing impact**
   - What we know: Current code returns 500 if `!emailResult.success`. After refactor it always returns 200.
   - What's unclear: Does any frontend code read the response body and show a specific error for email failure?
   - Recommendation: Check `src/` for any component that POSTs to `/api/auth/resend-verification` and handles a 500 specifically. If found, the component needs updating. If not found, the behavior change is safe. (This is a low-risk check — the CONTEXT.md explicitly sanctions the change.)

2. **disputes.ts RESEND_API_KEY guard**
   - What we know: Current code has `if (resendApiKey)` before the email send. CONTEXT.md doesn't explicitly address whether to keep or drop this guard.
   - What's unclear: Is this guard still meaningful after the type-safe `getEnv()` pattern from Phase 16 (RESEND_API_KEY is typed as string, not optional)?
   - Recommendation: Keep the guard. It's cheap, defensive, and removing it is out of scope.

---

## Sources

### Primary (HIGH confidence)
- `node_modules/astro/dist/core/app/middlewares.js` — read directly; `createOriginCheckMiddleware` exact logic
- `node_modules/astro/dist/core/config/schemas/base.js` line 48 — `checkOrigin: true` default confirmed
- `node_modules/@astrojs/cloudflare/dist/utils/handler.js` lines 24-36 — ctx.waitUntil wiring confirmed
- `node_modules/@astrojs/cloudflare/dist/utils/handler.d.ts` — `Runtime<T>` type: `ctx: ExecutionContext`
- `node_modules/@cloudflare/workers-types/index.d.ts` line 467-471 — `ExecutionContext.waitUntil(promise: Promise<any>): void`
- `src/env.d.ts` — `App.Platform.ctx: ExecutionContext` non-optional; `App.Locals.runtime: App.Platform` non-optional (but undefined at runtime in tests)
- `src/lib/logger.ts` — `logError(event: string, context: LogContext): void` with open index signature
- `src/lib/runtime.ts` — current `getEnv` implementation; will host `fireAndForget`
- `src/middleware.ts` — SameSite=Lax at lines 29, 40 confirmed
- `src/pages/api/auth/google.ts` — OAuth state cookie sameSite: 'lax' at line 21 confirmed
- `node_modules/@oslojs/crypto/dist/sha2/sha256.d.ts` — `sha256(data: Uint8Array): Uint8Array` synchronous
- `node_modules/@oslojs/encoding/dist/index.d.ts` — `encodeHexLowerCase` available
- `src/lib/__tests__/logger.test.ts` — confirms arbitrary context keys are spread into JSON output
- `vitest.config.ts` — environment: happy-dom; `@oslojs/crypto` works in this environment (311 tests pass)

### Secondary (MEDIUM confidence)
- Astro official docs (`docs.astro.build/en/reference/configuration-reference/#securitycheckorigin`) — confirms checkOrigin default true, applies to POST/PATCH/DELETE/PUT with form content types only

---

## Metadata

**Confidence breakdown:**
- ctx.waitUntil mechanism: HIGH — read directly from adapter source
- checkOrigin coverage: HIGH — read directly from Astro middleware source
- sha256 via oslo: HIGH — verified type signatures; confirmed works in test environment
- logError compatibility: HIGH — read source directly; open index signature accepts all payload keys
- runtime undefined in tests: HIGH — verified that no test currently sets locals.runtime; confirmed adapter is not invoked in Vitest

**Research date:** 2026-04-28
**Valid until:** Phase 18 complete (no third-party API changes involved; all findings are from local source files)
