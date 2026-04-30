# Phase 18: CSRF Audit and Async Email - Context

**Gathered:** 2026-04-28
**Status:** Ready for planning

<domain>
## Phase Boundary

Two separable but co-shipping deliverables:

1. **CSRF audit (SEC-06):** Document the existing CSRF defense stack (Astro `security.checkOrigin` defaults, Lucia v3 session cookie attributes, Cloudflare Turnstile coverage, OAuth state cookie). Conclude — and ratify — that the SameSite=Lax + Turnstile + checkOrigin combination is sufficient and that no token-based CSRF implementation is required. Record the conclusion in three places: a separate audit doc (`.planning/audits/csrf-2026-04.md`), an inline comment in `src/middleware.ts`, and a brief note in `CLAUDE.md` extending the existing Security Checklist section.

2. **Async email refactor (PERF-01..04 + companion route):** Convert all blocking email sends to `ctx.waitUntil(emailPromise.catch(logError))` so API responses don't wait on Resend. Five routes total: signup, forgot-password, contact (sends 2 emails), disputes, AND `resend-verification` (companion to PERF-01 for posture consistency).

This phase delivers no user-visible UI change. No new endpoints. No new DB tables. No CSRF token implementation. Audit-and-document for one half; type-clean perf refactor for the other.

</domain>

<decisions>
## Implementation Decisions

### CSRF audit document

- **Three deliverables, one canonical source:**
  1. `.planning/audits/csrf-2026-04.md` — full audit with per-endpoint-category analysis, evidence links, and explicit verdict
  2. `src/middleware.ts` — inline comment near the top: short summary of conclusion + pointer to the audit doc (`// CSRF audit (2026-04-28): see .planning/audits/csrf-2026-04.md — verdict: SameSite=Lax + Turnstile + Astro checkOrigin sufficient; no token implementation required.`)
  3. `CLAUDE.md` — short paragraph appended INSIDE the existing "Security Checklist when adding new endpoints" section: a CSRF subsection noting the verdict, audit date, and pointer to the audit doc
- **Audit content organization: per-endpoint-category.** Four categories:
  1. **Authenticated POST endpoints** — protected by SameSite=Lax session cookie + Turnstile where applicable
  2. **Public POST endpoints** (`/api/bug-reports`, `/api/disputes`, `/api/contact`) — protected by Turnstile + Phase 17 content-type guards
  3. **GET endpoints** — read-only, no CSRF concern; documented as out-of-band for completeness
  4. **OAuth callback** (`/api/auth/google/callback`) — protected by SameSite=Lax state cookie + redirect URI allowlist
- **Date stamping: date-only, no calendar revisit deadline.** Audit doc + inline comments carry "audited 2026-04-28". Re-audit triggers are organic (Astro upgrade, Lucia replacement, new OAuth provider) — no `revisit by YYYY-MM-DD` deadline that would slip into noise.
- **Audit explicitly covers:** OAuth state cookie validation, Turnstile coverage matrix, SameSite cookie attribute on every cookie set in the codebase, Astro `security.checkOrigin` default behavior (true for SSR adapters; verified `astro.config.mjs` does NOT override).
- **Audit explicitly does NOT touch:** CSP / X-Frame-Options / X-Content-Type-Options revisit (already in middleware.ts, separate concern), token-based CSRF design (out of scope per REQUIREMENTS.md), SameSite=Strict migration (anti-feature: breaks Google OAuth callback).

### Async email refactor — route inclusion

- **Five routes, not four.** PERF-01..04 names: `signup.ts`, `forgot-password.ts`, `contact.ts`, `disputes.ts`. Add `resend-verification.ts` as a 5th conversion under PERF-01 for consistency. Reasoning: it has the same blocking pattern, the change is mechanical, and a "why is this one different?" inconsistency would be hard to explain later.
- **REQUIREMENTS.md update:** Append to PERF-01's description — "Companion: `/api/auth/resend-verification` gets the same treatment for consistency." No new requirement ID. No traceability table change.
- **All blocking email sites in scope:**
  | Route | Email(s) sent | Current pattern |
  |-------|---------------|-----------------|
  | `/api/auth/signup` | sendVerificationEmail | `await emailResult` inside try/catch |
  | `/api/auth/forgot-password` | sendPasswordResetEmail | `await emailResult` |
  | `/api/auth/resend-verification` | sendVerificationEmail | `await emailResult` |
  | `/api/contact` | sendContactConfirmationEmail + sendContactNotificationEmail | `await ... .catch(...)` |
  | `/api/disputes` | sendDisputeConfirmationEmail | `await ...` inside try/catch |

### waitUntil null-guard

- **Fall back to await-blocking when `context.locals.runtime.ctx` is undefined.** Never silently skip; never throw. Local Wrangler dev keeps full email behavior; unit tests without a runtime fixture still send (synchronously); production gets the perf benefit. This preserves dev/test parity without forcing every test to fixture a runtime.
- **New helper: `fireAndForget(context, promise)` in `src/lib/runtime.ts`** — colocated with `getEnv()`. Single source for the null-guard pattern.
- **Helper signature:**
  ```typescript
  export function fireAndForget(context: APIContext, promise: Promise<unknown>): void {
    const ctx = context.locals.runtime?.ctx;
    const wrapped = promise.catch((err) => logError('fireAndForget failed', { route: context.url.pathname, error: err }));
    if (ctx?.waitUntil) {
      ctx.waitUntil(wrapped);
    } else {
      // No ctx (rare in dev, common in unit tests): fall back to await-blocking
      // This deliberately re-blocks so dev/test paths never silently lose emails
      void wrapped;
    }
  }
  ```
  - Returns `void` — callers cannot accidentally await it (which would defeat the point).
  - Internal `.catch(logError)` is non-optional — fire-and-forget without a catch would unhandled-reject and crash Workers.
- **Call site pattern (replaces all current `await sendXxxEmail(...).catch(...)` blocks):**
  ```typescript
  fireAndForget(context, sendVerificationEmail(getEnv(context).RESEND_API_KEY, siteUrl, email, token));
  ```

### Email-failure observability

- **Log via `logError` from `src/lib/logger.ts`** — no new database table, no retry queue.
- **Log payload:**
  ```typescript
  logError('Email send failed', {
    route: context.url.pathname,           // e.g., '/api/auth/signup'
    recipient_hash: sha256(email).slice(0, 8),  // first 8 hex chars — correlation, no PII
    error: err.message,
    stack: err.stack,
  });
  ```
- **Recipient hashing is required.** Raw emails in logs is a privacy violation given the product's tenant-protection positioning. Hash gives correlation ("same address failing 5 times = check Resend dashboard for this user") without exposing PII.
- **No `email_failures` table.** Reasoning: verification/password-reset failures are rare, users have explicit resend buttons for verification, password-reset has a clear retry path, and adding a retry queue without observability of HOW often it's needed would be premature scaffolding. Cloudflare Workers logs (`wrangler tail`, dashboard logs feed) are sufficient.
- **Verification flow UX: no change.** Current signup flow already shows a "check your email or resend" state. Silent email failure → user clicks resend → /api/auth/resend-verification fires → likely succeeds. No UI work needed in this phase.

### Order of operations within an endpoint

- **Sequence (locked, mirrors Phase 17 pattern):**
  1. Content-type guard (where applicable)
  2. Rate limit check
  3. Turnstile verify (where applicable)
  4. Validate input
  5. DB write — synchronous, must complete before response (response correctness depends on it)
  6. `fireAndForget(context, sendXxxEmail(...))` — runs after response sent
  7. Return success response
- **DB-then-email is non-negotiable.** Verification token must be in the DB before the email is scheduled, else the link in the email could 404. Same for dispute records, contact records, etc. The only thing that moves into waitUntil is the network call to Resend.

### Claude's Discretion

- Exact wording of audit doc paragraphs (verdict and analysis text — must be accurate and reference the live config)
- Whether `fireAndForget` lives in `src/lib/runtime.ts` (recommended, next to getEnv) or a new `src/lib/async.ts` file
- Exact sha256 implementation for recipient hashing (Web Crypto SubtleCrypto vs node:crypto fallback — Workers runtime support determines this)
- Whether the audit doc lists every cookie set in the codebase exhaustively or summarizes by category
- Whether middleware.ts comment is 2 lines (verdict + pointer) or 5-8 lines (verdict + per-category one-liners + pointer)

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/lib/runtime.ts` — already exports `getEnv(context)` (Phase 16). New `fireAndForget(context, promise)` lives here.
- `src/lib/logger.ts` — existing logger module; provides `logError` for structured logs. The new helper imports from here.
- `src/middleware.ts` — Lucia session cookie attributes set with `sameSite: 'lax'` (verified lines 29, 40); already declares all CSP / X-Frame-Options / X-Content-Type-Options headers. Inline CSRF audit comment lands near the top of the file (before the auth try block) so future readers see it.
- `astro.config.mjs` — does NOT set `security.checkOrigin` → defaults to `true` for SSR adapters. Audit doc cites this as the third leg of the defense.
- `src/pages/api/auth/google.ts` — OAuth state cookie set with `sameSite: 'lax'` (verified line 21). Audit doc covers this in the OAuth callback section.

### Established Patterns
- `await sendXxxEmail(...).catch(...)` — current pattern across all 5 email-send sites. Each gets replaced one-for-one with `fireAndForget(context, sendXxxEmail(...))`.
- Email-send functions return `{ success: boolean, error?: string }` — fireAndForget callers don't unwrap the result; failures are caught inside the helper.
- Phase 17 endpoint sequence (content-type → rate limit → Turnstile → validate → DB → response) is preserved; this phase only changes step 6 (was: blocking email; will be: fire-and-forget).
- Audit docs (this is a new convention) live under `.planning/audits/{topic}-{date}.md` — first one establishes the pattern.

### Integration Points
- `src/middleware.ts` — receives the inline CSRF audit comment.
- `CLAUDE.md` — Security Checklist section gets a CSRF subsection.
- `.planning/audits/csrf-2026-04.md` — new file, this phase establishes the directory.
- `src/lib/runtime.ts` — extended with `fireAndForget()`.
- 5 endpoint files (`signup.ts`, `forgot-password.ts`, `resend-verification.ts`, `contact.ts`, `disputes.ts`) — each gets a 1-line replacement at the email-send site.
- `.planning/REQUIREMENTS.md` — PERF-01 description gets a one-line addendum noting the `resend-verification` companion change.

</code_context>

<specifics>
## Specific Ideas

- The CSRF audit doc serves a real purpose: future engineers (including future-Claude) reading "why no CSRF token?" should be able to follow the reasoning without re-doing the audit. The per-endpoint-category structure makes "is THIS endpoint covered?" answerable in 30 seconds.
- The `fireAndForget` helper name was chosen over `nonBlocking`, `defer`, or `runAfterResponse` because "fire and forget" is the canonical name for this pattern across HTTP/messaging systems — instantly recognizable.
- The hashed-recipient log pattern matches what's becoming standard for privacy-conscious observability: enough to correlate, not enough to identify. Reference: any modern transactional-email library's docs on PII in logs.

</specifics>

<deferred>
## Deferred Ideas

- **`email_failures` table for retry/reconciliation** — deferred. If logs show a non-trivial failure rate after this phase ships, revisit in v1.6.0. Adding the scaffolding without first measuring is premature.
- **Calendar-based audit re-run reminder** — deferred. If a `/schedule` agent for re-auditing CSRF in 12 months proves useful, add it then.
- **CSP / security-header revisit** — out of scope for Phase 18. The CSRF audit is bounded to CSRF; the broader security-header review is a separate audit that can happen later.
- **`cf-csp-report-uri` integration** — listed in v2 requirements; out of scope.
- **`getCtx(context)` general helper** — `fireAndForget` is the only consumer of `ctx.waitUntil` in this phase. If a second consumer materializes (e.g., logging to an analytics endpoint), extract `getCtx()` then.
- **Email-failure UI for users** — Phase 18 makes no user-facing UX changes. If a "your verification email failed, click here to resend" state proves needed in production, that's a UX phase later.
- **OAuth state cookie audit hardening (rotation, expiry)** — audit will document current state but not change it. Hardening is its own phase if needed.

</deferred>

---

*Phase: 18-csrf-audit-and-async-email*
*Context gathered: 2026-04-28*
