---
phase: 18-csrf-audit-and-async-email
plan: "03"
subsystem: security-documentation
tags: [csrf, security-audit, documentation, middleware]
dependency_graph:
  requires: []
  provides: [csrf-audit-doc, middleware-csrf-comment, claude-md-csrf-subsection]
  affects: [src/middleware.ts, CLAUDE.md, .planning/audits/]
tech_stack:
  added: []
  patterns: [audit-doc-convention (.planning/audits/), per-endpoint-category-csrf-analysis]
key_files:
  created:
    - .planning/audits/csrf-2026-04.md
  modified:
    - src/middleware.ts
    - CLAUDE.md
decisions:
  - SameSite=Lax + Turnstile + Astro checkOrigin sufficient; no CSRF token implementation required
  - checkOrigin does NOT cover application/json (disputes.ts gap); covered by Turnstile + rate limit + content-type guard
  - Organic re-audit triggers only (no calendar deadline): Astro major upgrade, Lucia replacement, new OAuth provider, new JSON endpoint
  - .planning/audits/ directory established as audit doc convention (this is the first)
metrics:
  duration_minutes: 3
  completed_date: "2026-04-28"
  tasks_completed: 3
  tasks_total: 3
  files_created: 1
  files_modified: 2
---

# Phase 18 Plan 03: CSRF Audit Documentation Summary

## One-Liner

CSRF posture documented in three interlocking artifacts: audit doc + middleware comment + CLAUDE.md subsection — verdict is SameSite=Lax + Turnstile + Astro checkOrigin sufficient, no token needed.

## What Was Built

Three documentation artifacts establishing the CSRF posture of ratemyplace.org:

1. **`.planning/audits/csrf-2026-04.md`** — 169-line standalone audit document with 8 required sections, establishing the `.planning/audits/` convention. Per-endpoint-category structure covering authenticated POST, public POST (including the JSON-endpoint caveat), GET, and OAuth callback. Explicit verdict, SameSite=Lax file/line citations, organic re-audit triggers.

2. **`src/middleware.ts`** — 4-line inline comment block at lines 6-9 (top of `onRequest`, before auth state setup). References the audit doc, states the verdict, calls out the JSON checkOrigin gap. Zero behavior change — comment-only diff confirmed.

3. **`CLAUDE.md`** — `### CSRF Protection` subsection appended at line 261, inside the existing `## Security Checklist` section, before `## Common Mistakes to Avoid`. Contains the three defense layers, the JSON caveat, and a pointer to the audit doc. No new H2 heading introduced (H2 count unchanged at 12).

## Artifact Details

### Audit Document
- **Path:** `.planning/audits/csrf-2026-04.md`
- **Lines:** 169 (within 100-200 target)
- **Sections:** 8 (Summary, Verdict, Defense Stack, Astro checkOrigin Exact Behavior, Per-Endpoint-Category Coverage [4 subcategories], Out of Scope, Re-audit Triggers, Sources)
- **Key finding documented:** `checkOrigin` does NOT cover `application/json` — disputes.ts relies on Turnstile + rate limit + content-type guard, NOT checkOrigin

### Middleware Comment
- **Placement:** Lines 6-9 of `src/middleware.ts`, at top of `onRequest` body, before `// Set default auth state`
- **Content:** 4 lines — audit date/path reference, verdict, no-token statement, JSON caveat
- **Diff:** `5 insertions(+), 0 deletions` — comment-only, zero existing lines modified

### CLAUDE.md Subsection
- **Heading:** `### CSRF Protection` (H3 — subsection of `## Security Checklist`)
- **Line:** 261
- **Placement confirmed:** Inside `## Security Checklist`, before `## Common Mistakes to Avoid`
- **Quick Reference table:** NOT modified
- **H2 count:** 12 (unchanged)

## Verification Results

| Check | Result |
|-------|--------|
| Audit doc exists with ≥80 lines | PASS (169 lines) |
| All 7 required section headings present | PASS (7/7) |
| `application/json` in audit doc | PASS (7 occurrences) |
| `disputes` in audit doc | PASS (6 occurrences) |
| `SameSite=Lax` in audit doc | PASS (16 occurrences) |
| Audit date 2026-04-28 | PASS (3 occurrences) |
| CSRF audit comment in middleware.ts | PASS (line 6) |
| Audit doc path in middleware.ts | PASS (line 6) |
| `application/json` in middleware.ts | PASS (line 9) |
| `npm run build` | PASS — clean |
| `### CSRF Protection` in CLAUDE.md | PASS (1 match, line 261) |
| Subsection inside Security Checklist | PASS (awk boundary check: 4 terms found) |
| No duplicate H3 CSRF heading | PASS (exactly 1) |
| No new H2 heading | PASS (H2 count 12, unchanged) |
| JSON caveat in all 3 artifacts | PASS |

## Build + Test Status

- **`npm run build`:** PASS — TypeScript clean, comment-only change does not affect output
- **`npm test`:** 311/322 tests pass. The 11 failing tests are in `src/lib/__tests__/runtime.test.ts` and test `fireAndForget` — a function being implemented by the parallel 18-00 plan. These failures pre-exist this plan's changes and are caused by tests written by 18-00 that import a function not yet implemented. My plan's changes (middleware.ts comment, CLAUDE.md update, audit doc) do not affect any test.

## Answer: Is checkOrigin Sufficient for JSON Endpoints?

**No.** `checkOrigin` does NOT protect `application/json` endpoints — the Astro middleware only checks origin for form-like content types (`application/x-www-form-urlencoded`, `multipart/form-data`, `text/plain`). JSON endpoints must rely on Turnstile + rate limiting + content-type guards for CSRF protection, as is the case for `/api/disputes`.

## Deviations from Plan

None — plan executed exactly as written. All three tasks completed in order. Zero code behavior change.

## Commits

| Task | Commit | Description |
|------|--------|-------------|
| Task 1 | `16e9e2a` | docs(18-03): write CSRF audit document at .planning/audits/csrf-2026-04.md |
| Task 2 | `4114efc` | docs(18-03): add inline CSRF audit comment to src/middleware.ts |
| Task 3 | `5e3915d` | docs(18-03): add CSRF subsection inside CLAUDE.md Security Checklist |
