# Project Retrospective

*A living document updated after each milestone. Lessons feed forward into future planning.*

## Milestone: v1.5.0 — Closed Loops

**Shipped:** 2026-04-29
**Phases:** 6 (16-21) | **Plans:** 15 | **Timeline:** 3 days (2026-04-27 → 2026-04-29)

### What Was Built

- Typed Cloudflare runtime — `App.Platform.env` declares all 6 Pages secrets; 89 unsafe `as any` runtime casts eliminated across 60 files
- Public endpoint hardening — rate limits + content-type guards + length-bounded validators on bug-reports/contact/disputes/search routes
- CSRF audit closed as no-token-required — SameSite=Lax + Turnstile + Astro `checkOrigin` ratified across audit doc, middleware comment, and CLAUDE.md
- Async email sends — all 5 blocking `await sendXxxEmail` calls converted to `fireAndForget` with `ctx.waitUntil`
- D1 hot-path index — `idx_reviews_building_status` composite confirmed via live production EXPLAIN; 3 unnecessary indexes documented as skipped with grep evidence
- Causal E2E coverage — admin moderation captures `review_id` then queries audit_logs by `entity_id` (not ordering-dependent); cross-view exact score equality across search/detail/profile
- Header consistency — `Retry-After` + `X-RateLimit-Limit` + `X-RateLimit-Remaining` across all 9 rate-limited endpoints via shared `buildRateLimitHeaders` helper
- Shared `<EmptyState>` component — `.astro` + `.tsx` byte-identical twins, 6 ad-hoc empty-state strings replaced

### What Worked

- Wave 0 RED scaffolding pattern (Phase 17, Phase 18) locked the API surface before implementation, eliminated drift between tests and production code
- Atomic batch retirement (16-01 + 16-02 shipped together) avoided the cascade-failure mode of partial cast migration
- Audit-doc-as-deliverable convention (`.planning/audits/csrf-2026-04.md`, `d1-indexes-2026-04-28.md`) — frees verification from re-deriving evidence; doubles as institutional memory
- Causal capture-then-query E2E pattern is dramatically more robust than badge-based approve confirmations (which raced with pending-filter view removal)
- 3 phases of parallel work after Phase 16 foundation (17/18/19 in parallel) — minimal coordination cost, maximal throughput
- Pure helper functions (`buildRateLimitHeaders`, `isValidEmail`, `escapeLikePattern`) trivial to unit test, easy to retrofit across endpoints

### What Was Inefficient

- SUMMARY.md `requirements-completed` frontmatter inconsistently filled — INFRA-01..03, SEC-06, SEC-07, SEC-08 missing despite implementations completed and verified. Same gap noted in v1.2.2 retrospective; still not fixed.
- Audit doc location convention (`.planning/audits/`) only emerged in Phase 18 — earlier phases mixed evidence into VERIFICATION.md or PLAN.md
- Phase 18 had to explicitly out-of-scope `disputes/[id].ts` admin endpoint to keep scope tight, leaving a known follow-up for v1.6.0 (admin endpoint blocking await)
- Phase 17's contact.ts intentionally deferred Retry-After to Phase 21 — clean separation but added dependency edge that could have been collapsed

### Patterns Established

- `fireAndForget(context, promise)` helper — standard pattern for non-blocking IO with `ctx.waitUntil` + null-guard fallback for local Wrangler dev
- `getEnv(context)` typed accessor — replaces `(context.locals as any).runtime.env` everywhere; throws on missing runtime
- `buildRateLimitHeaders(result, limit)` — pure function spread on both blocked and allowed paths
- `clearRateLimits()` extracted to `e2e/fixtures.ts` — reusable across spec files instead of duplicating
- `.astro` + `.tsx` byte-identical component twins for surfaces consumed by both SSR pages and React islands
- Migration-with-skip-evidence: `0024_perf_indexes.sql` block-comment header records what was skipped and why (with grep output)

### Key Lessons

1. SUMMARY.md frontmatter discipline still slips even when explicitly noted in prior retrospectives — automate the check (lint or pre-commit) rather than relying on memory
2. Audit doc convention should be defined in CLAUDE.md or a workflow template before the first phase that needs it, not retroactively
3. Cross-view consistency tests need exact equality (`.toBe`), not `.toBeCloseTo` — controlled single-review fixtures collapse all code paths into the same number
4. Atomic cast migration in one PR is the right pattern for cross-cutting refactors — partial migration is worse than none
5. `EXPLAIN QUERY PLAN` evidence belongs in the audit doc, not just the verification — future maintainers need the before/after to evaluate index churn

### Cost Observations

- 3-day milestone (vs 12 days for v1.3.0 of similar phase count) — narrower scope per phase, no new user-facing features
- 6 phases × ~2.5 plans average — tighter than v1.3.0's broader E2E sweeps
- Wave 0 RED tests added cost upfront but eliminated rework downstream
- Phase 19 audit docs (465 lines + 169 lines) — heavier doc-to-code ratio than typical; appropriate for performance work that needs evidence trails

---

## Milestone: v1.2.2 — Launch Ready

**Shipped:** 2026-02-27
**Phases:** 2 | **Plans:** 6

### What Was Built
- Landlord dispute form at /dispute with review URL parsing, contact info collection, and reason selection
- Admin disputes queue at /admin/disputes with side-by-side review comparison and resolution workflow
- Fail-closed rate limiting — DB errors return 503 with structured JSON logging
- Comprehensive audit trail — all admin actions logged with who, what, when, old/new values
- Admin audit log viewer at /admin/audit with filtering and pagination
- Dispute email notifications (confirmation on submit, notification on upheld resolution)

### What Worked
- Wave-based plan execution enabled parallel work within Phase 2 (plans 02 and 03 ran concurrently after foundation plan 01)
- Phase-level verification caught all requirements and wiring before milestone completion
- Best-effort patterns (email, audit logging) prevented cascading failures from breaking primary actions
- Reusing existing patterns (email templates, React islands, admin layout) kept implementation consistent

### What Was Inefficient
- AdminLayout.astro nav links were missed during both Phase 2 and Phase 3 execution — caught only at milestone audit
- Phase directories were archived before full milestone completion workflow ran, requiring audit to read from archive paths
- SUMMARY.md frontmatter inconsistency — most plans missing `requirements-completed` field, reducing cross-reference automation

### Patterns Established
- Fail-closed rate limiting: deny on error, return 503 with Retry-After header
- Best-effort audit logging: try/catch wrapper, never blocks primary action
- Structured JSON logging via `logError()` helper for Cloudflare Workers
- Dispute-specific action types (upheld/dismissed/partially_valid) for fine-grained audit filtering

### Key Lessons
1. Admin nav integration should be part of any plan that adds admin pages — add to plan templates or verification checklists
2. Milestone completion should run before archiving phase directories, not after
3. Always include `requirements-completed` in SUMMARY.md frontmatter for automated traceability

### Cost Observations
- Model mix: primarily sonnet for execution, opus for orchestration
- Phase 2 execution: ~713s total across 3 plans
- Phase 3 execution: ~375s total across 3 plans
- Notable: Phase 3 Plan 03 completed in 6s (mostly UI composition from existing patterns)

---

## Milestone: v1.2.1 — Email Verification

**Shipped:** 2026-02-26
**Phases:** 1 | **Plans:** 4

### What Was Built
- Cryptographically secure token generation with 64-char alphanumeric tokens and 24-hour expiration
- Green email verification badge on reviews
- Resend email service integration with branded HTML emails
- Complete verification flow: click-to-verify, resend, success page, profile UI

### What Worked
- Single-phase milestone kept scope tight and shippable
- Web Crypto API choice enabled cross-environment compatibility

### What Was Inefficient
- Email infrastructure marked "ready" but not fully end-to-end tested at milestone boundary

### Patterns Established
- Web Crypto API for token generation (cross-environment)
- Branded HTML email templates via Resend
- Rate limiting on sensitive endpoints (3/hour for verification emails)

### Key Lessons
1. "Infrastructure ready" is not the same as "complete" — requirements should reflect actual user-facing behavior

---

## Milestone: v1.4.0 — Open Doors

**Shipped:** 2026-03-22
**Phases:** 6 | **Plans:** 13

### What Was Built
- UGC disclaimers across all review-displaying pages, ToS safe harbor language, consent checkbox on submission
- Admin inline review expansion with full field visibility and approve/reject without leaving queue
- Move-in date season/year bug fix (Winter 2025 edge case)
- Section 8 / Housing Choice Voucher acceptance and "safely lit at night" survey fields with color-coded pills
- Contact form with D1 storage, Resend confirmation emails, admin contact management tab
- Multi-city enrichment adapter pattern (Boston Assessing API + New Haven CT CAMA) with NullAdapter fallback
- Tenant dashboard: review status with disputed badge, rejection reasons with edit/resubmit CTA
- Account settings tab: display name, notification preferences, password (OAuth-aware), email change
- In-app notifications with createNotification helper wired into all 4 review event types
- Header bell icon with SSR unread count badge
- Saved buildings with bookmark button, toast feedback, and dashboard tab
- Verification UX: post-submission prompt, verified badge with tooltip, dashboard nudge

### What Worked
- Wave-based parallel execution consistently delivered — Phase 13 ran 2 agents in parallel for Wave 2 without conflicts
- Milestone audit caught the review_disputed notification gap that phase-level verification missed — cross-phase integration checking is valuable
- Gap closure cycle (audit → plan-milestone-gaps → execute → re-audit) worked smoothly for a single-task fix
- Best-effort patterns (notifications, audit logging) continued to prevent cascading failures
- CityAdapter pattern made New Haven a clean addition without touching Boston logic

### What Was Inefficient
- SUMMARY.md frontmatter still inconsistent — `requirements-completed` field missing from most summaries, reducing 3-source cross-reference automation
- Phase 14 was already completed before Phase 13 ran in this session — ordering was fine but caused confusion during plan-phase invocation
- Nyquist validation files exist for phases 10-13 but all show `compliant: false` — validation strategy was created but never fully executed

### Patterns Established
- CityAdapter interface for multi-city enrichment with dispatcher pattern
- SSR notification badge in Header.astro (query D1, no client flash)
- Best-effort createNotification helper (same pattern as createAuditLog)
- OAuth-aware password flows (set vs change depending on hashed_password/google_id)
- Fire-and-forget mark-as-read on notification tab switch

### Key Lessons
1. Phase-level verification catches per-phase gaps, but milestone audit catches cross-phase integration gaps — both are needed
2. Gap closure phases are lightweight and effective for surgical fixes found by the audit
3. 19 human-verification items accumulated across 3 phases — need a UAT pass before calling production-ready

### Cost Observations
- Model mix: sonnet for execution/verification, opus for orchestration
- 6 phases executed across multiple sessions (phases 10-12 in prior sessions, 13-15 in this session)
- Phase 15 (gap closure): 1 plan, ~4 min execution — minimal overhead for a critical fix

---

## Cross-Milestone Trends

### Process Evolution

| Milestone | Phases | Plans | Key Change |
|-----------|--------|-------|------------|
| v1.2.1 | 1 | 4 | First GSD milestone, established verification workflow |
| v1.2.2 | 2 | 6 | Added milestone audit, caught integration gaps |
| v1.4.0 | 6 | 13 | Gap closure cycle validated, cross-phase integration checking proven essential |

### Top Lessons (Verified Across Milestones)

1. Always verify admin navigation when adding admin pages — missed in both early milestones
2. Run milestone completion workflow before archiving artifacts
3. Phase-level verification + milestone audit = comprehensive coverage (v1.4.0 confirmed)
4. SUMMARY.md `requirements-completed` frontmatter still not consistently populated — 3 milestones running
