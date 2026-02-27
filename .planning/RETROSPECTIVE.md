# Project Retrospective

*A living document updated after each milestone. Lessons feed forward into future planning.*

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

## Cross-Milestone Trends

### Process Evolution

| Milestone | Phases | Plans | Key Change |
|-----------|--------|-------|------------|
| v1.2.1 | 1 | 4 | First GSD milestone, established verification workflow |
| v1.2.2 | 2 | 6 | Added milestone audit, caught integration gaps |

### Top Lessons (Verified Across Milestones)

1. Always verify admin navigation when adding admin pages — missed in both milestones
2. Run milestone completion workflow before archiving artifacts
