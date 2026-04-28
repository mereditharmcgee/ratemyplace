---
phase: 17-public-endpoint-security
plan: "02"
subsystem: api
tags: [security, rate-limiting, validation, content-type, typescript, sql-like-escape]

requires:
  - phase: 17-01
    provides: validateBugReport, validateContactForm, validateDisputeForm, validateSearch, escapeLikePattern (8 new exports in validation.ts)
  - phase: 17-00
    provides: wave-0-test-scaffolding (10 E2E tests RED, 51 unit tests RED)

provides:
  - content-type guards on all three POST endpoints (bug-reports, contact, disputes)
  - 5/hr rate limit on /api/bug-reports with Retry-After header (SEC-04)
  - 60/min rate limit on /api/search/results with Retry-After header (SEC-05)
  - 120/min rate limit on /api/search/autocomplete with Retry-After header (SEC-05)
  - validateBugReport integration on /api/bug-reports
  - validateContactForm integration on /api/contact (check order resequenced)
  - validateDisputeForm integration on /api/disputes (replaces inline 'Missing required fields')
  - validateSearch integration on both search endpoints
  - escapeLikePattern + ESCAPE '\\' clause on all LIKE queries in both search endpoints
  - All 10 Wave 0 Phase 17 E2E tests GREEN

affects: [18-csrf-and-perf, 21-rate-limit-headers]

tech-stack:
  added: []
  patterns:
    - Canonical endpoint check order: content-type → rate limit → Turnstile → validator → DB write
    - Content-type guard placed BEFORE try/catch so wrong type returns 415 (not 500)
    - escapeLikePattern applied to user input before LIKE binding; ESCAPE '\\' appended to every LIKE clause
    - validateX() returning details: ValidationError[] shape consumed by both frontend and E2E tests

key-files:
  created: []
  modified:
    - src/pages/api/bug-reports.ts
    - src/pages/api/contact.ts
    - src/pages/api/disputes.ts
    - src/pages/api/search/results.ts
    - src/pages/api/search/autocomplete.ts

key-decisions:
  - "contact.ts intentionally omits Retry-After on 429 — deferred to Phase 21 SEC-07 per CONTEXT.md"
  - "disputes.ts content-type guard placed before const { request } = context to avoid TypeScript flow issues"
  - "getClientIP({request}) in disputes.ts updated to canonical getClientIP(context) for consistency"
  - "E2E Phase 17 tests run with --no-deps --project=chromium because global setup fails (Turnstile blocks browser sign-in); the 10 Phase 17 tests use only { request } fixture and pass 10/10"
  - "Pre-existing E2E failures (Privilege Escalation, Rate Limiting SEC-06, SQL Injection, XSS tests) require auth state from global setup — not caused by this plan"

patterns-established:
  - "Content-type guard: const contentType = request.headers.get('content-type') || ''; check includes() before try/catch"
  - "Rate-limit key naming: verb-noun ('bug-report', 'search-results', 'search-autocomplete')"
  - "LIKE escape: escapeLikePattern(query) → pattern = '%${escaped}%' → LIKE ? ESCAPE '\\\\' (JS source: two backslashes)"

requirements-completed: [SEC-04, SEC-05, VAL-01, VAL-02, VAL-03, VAL-04]

duration: 16min
completed: "2026-04-28"
---

# Phase 17 Plan 02: Public Endpoint Hardening Summary

**Five public endpoints hardened with content-type guards, rate limits (Retry-After on 429), structured validation returning `details: ValidationError[]`, and SQL LIKE wildcard escaping — turning all 10 Wave 0 Phase 17 E2E tests GREEN**

## Performance

- **Duration:** ~16 min
- **Started:** 2026-04-28T16:46:31Z
- **Completed:** 2026-04-28T17:02:00Z
- **Tasks:** 5 (4 code + 1 verification)
- **Files modified:** 5

## Accomplishments

- All 5 public endpoints now follow the canonical check order: content-type → rate limit → Turnstile → validate → DB write
- 3 POST endpoints now return 415 on wrong Content-Type (bug-reports, contact, disputes)
- 3 endpoints now have per-IP rate limits with Retry-After: bug-reports (5/hr), search/results (60/min), search/autocomplete (120/min)
- All LIKE queries in search endpoints now escape user input via `escapeLikePattern()` + `ESCAPE '\\'` — literal `%` and `_` in queries no longer act as wildcards
- 311/311 unit tests GREEN throughout; 10/10 Phase 17 E2E tests GREEN

## Task Commits

Each task was committed atomically:

1. **Task 1: Harden /api/bug-reports** - `7bdf020` (feat)
2. **Task 2: Harden /api/contact** - `e9200b3` (feat)
3. **Task 3: Harden /api/disputes** - `8e2fee0` (feat)
4. **Task 4: Harden /api/search/results and /api/search/autocomplete** - `ae34713` (feat)
5. **Task 5: E2E verification** - (no code commit — verification gate only)

## Files Created/Modified

| File | Changes |
|------|---------|
| `src/pages/api/bug-reports.ts` | Content-type guard, 5/hr rate limit (key 'bug-report'), Retry-After header, validateBugReport() |
| `src/pages/api/contact.ts` | Content-type guard, resequenced checks (content-type → rate-limit → Turnstile → validate), validateContactForm() |
| `src/pages/api/disputes.ts` | Content-type guard (application/json), validateDisputeForm() replacing inline check, getClientIP(context) fix |
| `src/pages/api/search/results.ts` | 60/min rate limit (key 'search-results'), Retry-After, validateSearch(), escapeLikePattern() + ESCAPE clauses |
| `src/pages/api/search/autocomplete.ts` | 120/min rate limit (key 'search-autocomplete'), Retry-After, validateSearch(), escapeLikePattern() + ESCAPE clauses |

## Rate-Limit Key Verification

| Endpoint | Key | Max | Window | Retry-After |
|----------|-----|-----|--------|-------------|
| /api/bug-reports | `bug-report` | 5 | 3600s | YES |
| /api/contact | `contact` | 3 | 3600s | NO (Phase 21 SEC-07) |
| /api/disputes | `dispute` | 3 | 3600s | YES (pre-existing) |
| /api/search/results | `search-results` | 60 | 60s | YES |
| /api/search/autocomplete | `search-autocomplete` | 120 | 60s | YES |

## E2E Test Results

**Phase 17 block: 10/10 passed** (run with `--no-deps --project=chromium`)

| Test | Requirement | Status |
|------|-------------|--------|
| 6th /api/bug-reports POST in 1hr returns 429 with Retry-After | SEC-04 | GREEN |
| 61st /api/search/results GET in 1min returns 429 with Retry-After | SEC-05 | GREEN |
| 121st /api/search/autocomplete GET in 1min returns 429 | SEC-05 | GREEN |
| POST /api/disputes with text/plain returns 415 | VAL-01 | GREEN |
| POST /api/disputes with landlordEmail "notanemail" returns 400 with field error | VAL-01 | GREEN |
| POST /api/disputes with disputeExplanation > 5000 chars returns 400 | VAL-01 | GREEN |
| POST /api/bug-reports with application/json returns 415 | VAL-02 | GREEN |
| POST /api/contact with application/json returns 415 | VAL-03 | GREEN |
| GET /api/search/results?q=<201 chars> returns 400 | VAL-04 | GREEN |
| GET /api/search/autocomplete?q=5%25 escapes % literal (does not error) | VAL-04 | GREEN |

**Pre-existing E2E failures (not caused by this plan):** 11 tests in Privilege Escalation, Rate Limiting (SEC-06), SQL Injection, and XSS blocks require authenticated browser sessions via global.setup.ts, which fails in this environment because the sign-in page uses a Turnstile widget that blocks automated auth. These tests were already failing before plan 17-02.

## Phase 17 Success Criteria

- [x] 6th bug-report POST in 1hr → 429 with `Retry-After`
- [x] 61st search/results GET / 121st autocomplete GET in 1min → 429 with `Retry-After`
- [x] dispute landlordEmail='notanemail' → 400 with `details` containing `landlordEmail`
- [x] dispute disputeExplanation > 5000 chars → 400 with `details` containing `disputeExplanation`
- [x] search/results query > 200 chars → 400 with `details` containing `q`

## Decisions Made

- **contact.ts intentionally omits Retry-After on 429** — per CONTEXT.md and plan spec, deferred to Phase 21 SEC-07 so Phase 21 only needs to add headers, not refactor call sites
- **getClientIP updated to canonical form** — disputes.ts used `getClientIP({ request })` (non-canonical); updated to `getClientIP(context)` for consistency with all other endpoints
- **E2E run strategy** — Phase 17 tests use `{ request }` fixture only (no browser auth), run successfully with `--no-deps --project=chromium` which skips global.setup.ts

## Deviations from Plan

None — plan executed exactly as written. All code in the plan spec was applied without modification.

## Issues Encountered

**E2E global setup failure:** `global.setup.ts` browser-based sign-in fails because the sign-in form requires a Turnstile widget that doesn't validate in test environments. This is a pre-existing condition — the existing auth state files in `playwright/.auth/` are from March 9. The Phase 17 tests don't need browser auth and ran successfully with `--no-deps`.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- All 5 public endpoints hardened per Phase 17 requirements
- SEC-04, SEC-05, VAL-01, VAL-02, VAL-03, VAL-04 complete
- Phase 18 (CSRF and perf) can proceed: PERF-03 (waitUntil for contact.ts) and PERF-04 (waitUntil for disputes.ts) are unblocked
- Phase 21 SEC-07 has a clean hook point: contact.ts 429 response is already structured; Phase 21 only adds the Retry-After header

## Self-Check

- [x] `src/pages/api/bug-reports.ts` has content-type guard, rate limit, validateBugReport import
- [x] `src/pages/api/contact.ts` has content-type guard, validateContactForm import, no Retry-After on 429
- [x] `src/pages/api/disputes.ts` has content-type guard, validateDisputeForm import
- [x] `src/pages/api/search/results.ts` has checkRateLimit, validateSearch, escapeLikePattern, ESCAPE clauses
- [x] `src/pages/api/search/autocomplete.ts` has checkRateLimit, validateSearch, escapeLikePattern, ESCAPE clauses
- [x] Commit `7bdf020` exists (bug-reports)
- [x] Commit `e9200b3` exists (contact)
- [x] Commit `8e2fee0` exists (disputes)
- [x] Commit `ae34713` exists (search endpoints)
- [x] 311/311 unit tests pass
- [x] Build exits 0
- [x] 10/10 Phase 17 E2E tests GREEN

---
*Phase: 17-public-endpoint-security*
*Completed: 2026-04-28*
