# Research Synthesis: v1.5.0 "Closed Loops"

**Milestone:** v1.5.0 Closed Loops — hardening pass for RateMyPlace Boston
**Source audit:** `.planning/codebase/CONCERNS.md` (2026-04-26)
**Research files:** STACK.md, FEATURES.md, ARCHITECTURE.md, PITFALLS.md
**Synthesis date:** 2026-04-27
**Overall confidence:** HIGH

---

## Executive Summary

v1.5.0 is a hardening milestone, not a feature milestone. The existing stack (Astro 5, Cloudflare D1, Lucia v3, Resend, Vitest, Playwright, Tailwind 4) is locked and validated — **no new npm packages are needed for any part of this milestone**. Every gap identified in the audit can be closed by extending existing modules: `src/lib/validation.ts` for input validation coverage, `src/lib/rateLimit.ts` call sites for rate limit gaps, `runtime.ctx.waitUntil()` for async email, and a PRAGMA-based migration for D1 index additions.

The anti-features list is explicit: **no Zod, no CSRF token library, no email queue worker, no Astro 6 upgrade**.

The critical sequencing constraint is that the **typed Cloudflare runtime wrapper must land first**. Adding `runtime: App.Platform` to `App.Locals` enables the type system to catch errors in all 71 subsequent edits. However, the wrapper has a strict prerequisite: `App.Platform.env` in `env.d.ts` currently omits Cloudflare Pages secrets (`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_MAPS_API_KEY`, `GOOGLE_PLACES_API_KEY`, `RESEND_API_KEY`, `SITE_URL`). These must be declared first or the typed migration re-introduces `as any` casts at every secret access site.

The CSRF finding will almost certainly close as **"already adequate"**. Astro 5 ships with `security.checkOrigin: true` by default, session cookies are `SameSite=Lax` (confirmed in `middleware.ts`), and all unauthenticated POST routes use Cloudflare Turnstile. The one firm constraint: session cookie `SameSite` must remain `Lax`, not `Strict` — Google OAuth requires a cross-site redirect back to the app, which `Strict` breaks. The CSRF audit conclusion should be documented in `middleware.ts` and CLAUDE.md, then the finding closed without implementing token-based CSRF.

---

## Stack Decisions

- **No new npm packages.** All work extends existing modules.
- `@astrojs/cloudflare` is **v12** — `runtime.ctx` is the correct `ExecutionContext` path. Do NOT use `cfContext` (that is v13/Astro 6).
- Astro 5.16.11 is patched for CVE-2024-56140; `security.checkOrigin` defaults to `true` but only covers form content-types, not `application/json`.
- Lucia v3 provides `verifyRequestOrigin()` as a utility but does NOT call it automatically — no built-in CSRF.
- `@cloudflare/workers-types` (already installed) provides the `ExecutionContext` type for `waitUntil`.

---

## Feature Categories

### Must Have (P1 — close CONCERNS.md gaps)

- Rate limiting on `/api/bug-reports` (5/hr), `/api/search/results` (60/min), `/api/search/autocomplete` (120/min)
- `Retry-After` header on all 429 responses — `contact.ts` currently missing it
- Input validation on `/api/disputes` (length limits on `disputeExplanation`, `landlordName`, `landlordPhone`; email format on `landlordEmail`)
- Async email via `waitUntil` in `signup.ts`, `forgot-password.ts`, `contact.ts`, `disputes.ts`
- CSRF audit + documentation of the SameSite=Lax coverage conclusion
- E2E: causal audit-log assertion (capture `reviewId` before approve action, assert specific entry after)
- E2E: cross-view score consistency (submit → approve → verify on search, building detail, profile)
- D1 composite index `reviews(building_id, status)`

### Should Have (P2 — after critical path)

- `X-RateLimit-Limit` and `X-RateLimit-Remaining` headers on rate-limited endpoints
- Centralized email/zip/text-length validators in `validation.ts`
- Additional D1 indexes: `buildings.city`, `buildings.building_type`
- Shared `<EmptyState>` React component for consistent empty-state messaging

### Code Health (P3 — optional in v1.5.0, defer-able to v1.6.0)

- Typed runtime wrapper (71-file mechanical refactor — zero user-facing impact, MEDIUM complexity)
- Component splits: `ReviewEditForm.tsx` (907 lines), `BuildingsTable.tsx` (844), `ReviewsTable.tsx` (733)

### Anti-Features (do NOT add)

- Zod or Valibot — `validation.ts` already has the right return shape; coverage gap, not capability gap
- Token-based CSRF system — SameSite=Lax + Turnstile + OAuth state cookie are sufficient
- Cloudflare Queues for email — `waitUntil` is the correct pattern at this scale
- Astro 6 upgrade — out of scope; v5.16.11 is patched
- Per-user rate limiting on public endpoints — these are unauthenticated; per-IP is correct
- Sentry / external observability — Cloudflare's built-in logs are sufficient through v1.5.0

---

## Architecture & Build Order

The build order is dependency-aware:

1. **Foundation: env.d.ts + typed runtime** — declare all Pages secrets in `App.Platform.env`, add `runtime: App.Platform` to `App.Locals`, update `db.ts` signature
2. **validation.ts new validators** — `validateBugReport`, `validateContact`, `validateDisputeForm`, `validateSearch`; reconcile v1 legacy / v2 field lists first
3. **(parallel) Rate limiting + async email + CSRF audit** — all additive, no shared files
4. **71 `any`-cast batch replacement** — single mechanical PR using find-and-replace; all-or-nothing
5. **(parallel) Component splits + EmptyState + new E2E specs**
6. **D1 index migration** — `EXPLAIN QUERY PLAN` verification first; off-peak apply for `rate_limits` index

Rate limiting stays in route handlers, not middleware. Per-request execution order:
IP extraction → DB → rate limit check → auth check → admin check → input validation → D1 query → `ctx.waitUntil(email)` → return response.

E2E tests use existing fixture architecture (`global.setup.ts` + `playwright/.auth/*.json`) — no new fixtures needed. `clearRateLimits()` helper should be moved to `fixtures.ts` for reuse across specs.

---

## Top Pitfalls

| # | Pitfall | Prevention |
|---|---------|-----------|
| 1 | **Typed wrapper prerequisite gap** — `env.d.ts` missing 6 secrets | Declare all secrets BEFORE writing wrapper code |
| 2 | **Partial 71-cast migration** — worse than none | All-or-nothing PR; find-and-replace, not hand-editing |
| 3 | **`waitUntil` null guard missing** — `runtime.ctx` undefined in local dev | Guard pattern: `if (runtime?.ctx?.waitUntil) { ... } else { await p }` |
| 4 | **`SameSite=Strict` change** — breaks Google OAuth cross-site callback | Keep `SameSite=Lax`; document in middleware.ts comment |
| 5 | **Validation field-list drift** — v1 legacy (12 fields) vs v2 (29 fields) | Reconcile field sources before adding validation calls |
| 6 | **D1 index lock contention** — `rate_limits` is write-heavy | Apply index migration during off-peak window |
| 7 | **Rate limit false positives** — could block legitimate users | Add logging to `allowed: false` path; monitor 24h before tightening |
| 8 | **Component split hydration boundary breaks** | Sub-components imported as React components, NOT separate `client:load` islands |

---

## Roadmap Implications

**Suggested phase shape: 6 active + 1 deferred (6 if deferred Phase 7)**

| # | Phase | Source category | Risk |
|---|-------|----------------|------|
| 16 | Foundation: Typed Runtime + env.d.ts secrets | P1 sequencing prereq | Low (mechanical) |
| 17 | Security Gaps: Rate Limiting + Input Validation | P1 must-have | Low (additive) |
| 18 | CSRF Audit + Async Email | P1 must-have | Low (audit closes; email guarded) |
| 19 | D1 Index Migration | P1 must-have | Medium (lock contention timing) |
| 20 | E2E Coverage Gaps | P1 must-have | Low (no new fixtures) |
| 21 | Quality Cleanup (EmptyState + headers + validators) | P2 should-have | Low |
| 22 | *(optional)* Component Splits | P3 code health | Higher (hydration boundary) — defer to v1.6.0 if bandwidth tight |

---

## Research Flags

- **Standard patterns** (no further research needed): Phases 16–21. All implementation patterns are in official docs and existing codebase; research files provide sufficient guidance.
- **Needs deeper research** (if scoped into v1.5.0): Phase 22 component splits. React island hydration boundary behavior under extraction is non-obvious; documented failure modes exist in PITFALLS.md.

---

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | Verified via official docs + direct source inspection |
| Features | HIGH | Direct codebase audit; each gap verified against source |
| Architecture | HIGH | Build order from explicit dependency graph |
| Pitfalls | HIGH | Retrofit risks verified against Cloudflare Workers + Lucia docs |
| D1 index necessity | MEDIUM | Inferred from query patterns; confirm with `EXPLAIN QUERY PLAN` before migration |
| `waitUntil` null guard local behavior | MEDIUM | Needs manual smoke test in Pages preview before phase close |

---

*Synthesized from STACK.md, FEATURES.md, ARCHITECTURE.md, PITFALLS.md by gsd-research-synthesizer (text return) and written by orchestrator.*
