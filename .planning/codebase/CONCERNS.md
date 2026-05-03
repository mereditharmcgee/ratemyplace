# Codebase Concerns

**Analysis Date:** 2026-05-02

## Tech Debt

### DEBT-01: Large Component Files (>700 LOC)

**Area:** React Components

**Issue:** Three components exceed 700 lines and contain mixed concerns (form logic, state management, API calls, display). These files are difficult to test in isolation, slow to navigate, and at high risk of introducing bugs during modification.

**Files:**
- `src/components/reviews/ReviewEditForm.tsx` (910 LOC) — Form validation, state synchronization with existing review data, multi-step transitions
- `src/components/admin/BuildingsTable.tsx` (844 LOC) — Table rendering, inline editing, search filtering, admin actions
- `src/components/admin/ReviewsTable.tsx` (733 LOC) — Table rendering, moderation queue, review detail expansion, approval/rejection workflow

**Impact:**
- Increased cognitive load during code review and modification
- Higher defect likelihood when adding features (e.g., new form field additions span multiple state sections)
- Slow development velocity for small changes
- Hard to unit test (components bundled with API calls and validation)

**Fix approach:**
- Extract form step components into separate files (ReviewEditForm → ReviewEditFormBasics, ReviewEditFormRatings, ReviewEditFormConfirm, etc.)
- Extract table columns into separate components (BuildingsTable → BuildingAddressCell, BuildingActionsCell, etc.)
- Move complex state logic into custom hooks (useReviewEditState, useBuildingsTableState)
- Extract validation and API calls into pure functions in `src/lib/`
- Carry over to v1.6.0 planning with detailed component split specs

**Priority:** Medium (deferred from v1.5.0, affects code maintainability but not functionality)

---

### DEBT-02: Legacy Pest-Issue Fallback Columns

**Area:** Database Schema

**Issue:** Two database columns represent the same semantic concept: `had_pests` (v1.0 name) and `had_pest_issues` (v1.1+ name). The scoring logic contains a fallback to handle both columns:

```typescript
// src/lib/scoring.ts:307
if (review.had_pest_issues || review.had_pests) pestCount++;
```

This works but adds unnecessary type narrowing complexity and makes the schema harder to understand.

**Files:** `src/lib/scoring.ts` (line 307)

**Impact:**
- Schema documentation confusion (why two columns for one concept?)
- Type casting burden in ReviewEditForm (16 `as any` casts in ReviewEditForm.tsx are partly due to optional/legacy fields)
- Slight performance penalty on pest-issue scoring (two column reads)

**Fix approach:**
- Verify all existing reviews have been migrated to use `had_pest_issues`
- Run a cleanup migration to drop `had_pests` column (can use db-reset script to verify against live data first)
- Remove fallback logic in scoring.ts
- Update ReviewEditForm.tsx type casting when form field extraction is refactored

**Priority:** Low (cosmetic; zero functional risk, backward-compatible fallback ensures data integrity)

---

### DEBT-03: Type Casting Debt (`as any`)

**Area:** Type Safety

**Issue:** 42 instances of `as any` type casts exist across the codebase, primarily in `ReviewEditForm.tsx` (16 instances) and scattered error handlers. While none are security-critical, they indicate missing or incomplete type definitions. ReviewEditForm casts are largely due to DEBT-02 (legacy column handling).

**Files:**
- `src/components/reviews/ReviewEditForm.tsx` (16 casts) — accessing optional review fields that may not exist in ReviewDetail type
- `src/components/profile/ProfileDashboard.tsx` (2 casts) — error response type narrowing
- `src/components/reviews/form-steps/UnitDetailsStep.tsx` (1 cast) — enum narrowing
- Various API handlers (scattered) — error response handling

**Impact:**
- Potential for silent type errors at runtime if field shapes change
- IDE autocomplete less helpful (once cast to `any`, type info is lost)
- Reduces confidence during refactoring (cannot rely on TS strict mode to catch breaking changes)

**Fix approach:**
- Extract detailed ReviewDetail type from `src/pages/api/reviews/[id].ts` into `src/lib/api-types.ts` for reuse
- Add optional field types to ReviewDetail for legacy columns and survey responses
- Create error response types (ApiError interface) and use instead of `any` in error handlers
- Replace enum casts with type guards or zod validation
- Run `npm test` after each fix to ensure no regression

**Priority:** Low-to-Medium (improves code safety and DX but does not fix bugs)

---

## Known Issues & Blocked Work Items

### ISSUE-01: Admin Review Rejection Email Still Uses `await`

**Area:** Email sending

**Issue:** Two admin endpoints still use `await` for email sends instead of the `fireAndForget` pattern established in v1.5.0:

1. `/api/admin/reviews/[id].ts` line 120 — `await sendReviewRejectedEmail(...)` when rejecting a review
2. `/api/disputes/[id].ts` line 138 — `await sendDisputeResolutionEmail(...)` when resolving a dispute

This means if Resend is slow or fails, the admin's action is delayed or blocked. The pattern should be non-blocking (fire-and-forget with `context.waitUntil`).

**Files:**
- `src/pages/api/admin/reviews/[id].ts` (lines 114-134)
- `src/pages/api/disputes/[id].ts` (lines 131-152)

**Impact:**
- Admin operations (review approval/rejection, dispute resolution) are slower than they need to be
- Poor UX if Resend is experiencing latency (admin sees a delay in their action completing)
- Inconsistent with v1.5.0 pattern (other endpoints use fireAndForget, these don't)

**Fix approach:**
- Import `fireAndForget` helper from `src/lib/email.ts`
- Wrap email send in `fireAndForget(context, sendXxxEmail(...))`
- Wrap email error handler in try/catch inside the promise (not outside, since now non-blocking)
- Verify in e2e tests that admin endpoint returns immediately (not waiting for email)
- Add to v1.6.0 planning as quick fix (1-2 plans)

**Priority:** Medium (inconsistent pattern, poor UX for admins, but not a correctness issue)

---

### ISSUE-02: Signup Email Validation Inconsistency

**Area:** Input Validation

**Issue:** The `signup.ts` endpoint performs its own email validation:

```typescript
// src/pages/api/auth/signup.ts (roughly)
if (!email || !email.includes('@')) { ... error ... }
```

But `src/lib/validation.ts` exports an `isValidEmail` helper (VAL-05, introduced in v1.5.0) that should be used instead:

```typescript
// src/lib/validation.ts
export function isValidEmail(email: string): boolean { ... }
```

**Files:**
- `src/pages/api/auth/signup.ts` — uses inline validation
- `src/lib/validation.ts` — contains canonical validator

**Impact:**
- Two sources of truth for email validation (if one is updated, the other may fall out of sync)
- Inconsistent error messages across signup and other endpoints
- Harder to test validation in one place (must test both endpoints)

**Fix approach:**
- Import `isValidEmail` in signup.ts
- Replace inline validation with `isValidEmail(email)` call
- Add unit test to verify signup uses the same validator as other endpoints
- Carry forward to v1.6.0 as consistency follow-up

**Priority:** Low (low-risk consistency issue, inline validation is adequate but not canonical)

---

## Security Considerations

### SEC-01: CSRF Protection on JSON Endpoints

**Area:** Cross-Site Request Forgery

**Risk:** `/api/disputes` accepts `application/json` requests. Astro's `checkOrigin` middleware does NOT apply to JSON content-type (by design), so the endpoint is NOT protected by that layer. Instead, protection comes from:

1. **Cloudflare Turnstile** on the frontend form
2. **Per-IP rate limits** (5 per hour per IP)
3. **Content-Type guard** (rejects non-JSON requests)

If an attacker bypasses Turnstile, they could submit disputes from a different origin.

**Files:**
- `src/pages/api/disputes.ts` (lines 1-80, request validation)
- `.planning/audits/csrf-2026-04.md` (full audit rationale)

**Current mitigation:**
- Turnstile: Human-interactive challenge prevents automated attacks
- Rate limit: Caps damage to 5 requests/hour/attacker-IP
- Content-type guard: Prevents form-based attack vector

**Recommendations:**
- **No action needed** — current mitigation is sufficient per audit ratified in v1.5.0
- If Turnstile were to be replaced, re-audit this endpoint (audit trigger: "new auth method")
- Document the JSON content-type gap in CLAUDE.md alongside CSRF checklist (already done)

**Priority:** Closed (audited and ratified 2026-04-28)

---

### SEC-02: Sensitive Field Leakage Vectors

**Area:** Information Disclosure

**Risk:** Database field names are sometimes exposed in API responses or frontend HTML. Examples:
- API error messages may return database column names (e.g., `Column hashed_password not found`)
- Admin table components display database field names in headers (e.g., "moderation_notes" instead of "Admin Notes")

**Files:** Various API handlers and admin components

**Current state:**
- Field names are not leaking in recent code (v1.5.0+ review responses use camelCase mappings)
- Admin components use descriptive labels (not raw column names)
- Error messages are generic ("Failed to update review" not "UPDATE query failed")

**Recommendations:**
- Continue to use generic error messages in API responses (current practice)
- Keep admin table headers as user-friendly labels (current practice)
- Add pre-commit lint rule to catch raw database column names in error messages (future improvement)

**Priority:** Low (no active leakage detected; preventive measure)

---

## Performance Bottlenecks

### PERF-01: Slow Admin Table Loads (Large Building/Review Lists)

**Area:** Query Performance

**Issue:** Large admin tables (`BuildingsTable`, `ReviewsTable`, `LandlordsTable`) load all matching records at once without pagination. A landlord with 1000+ buildings or hundreds of reviews would cause:

1. Large JSON response payload
2. Long rendering time in React
3. Possible browser unresponsiveness during large DOM insertions

**Files:**
- `src/pages/api/admin/buildings/index.ts` — no pagination
- `src/pages/api/admin/reviews/index.ts` — no pagination  
- `src/pages/api/admin/landlords/index.ts` — no pagination

**Current capacity:** Works smoothly up to ~100-200 records per table. Beyond that, noticeable lag.

**Scaling path:**
1. Add `offset` and `limit` query parameters to admin API endpoints
2. Implement cursor-based pagination in admin table components
3. Query EXPLAIN PLAN to verify indexes are being used (especially composite indexes on (building_id, status))
4. Consider materialized counts for "total records" badges

**Priority:** Medium (not an immediate issue, but important before dataset grows >500 records per table)

---

### PERF-02: Search Query Performance on Address Field

**Area:** Database Indexing

**Issue:** Search endpoint queries the `address` field with a LIKE pattern. Current indexes exist on `address` column but may not support fuzzy matching efficiently (e.g., searching "mass ave" should find "Massachusetts Avenue").

**Files:**
- `src/pages/api/search.ts` — uses `WHERE address LIKE ?` with ESCAPE
- `migrations/0024_perf_indexes.sql` — index audit notes which indexes were added

**Current performance:** Acceptable up to ~100 buildings. Beyond that, searches may show latency.

**Improvement path:**
- Benchmark current query with EXPLAIN QUERY PLAN
- Consider prefix index on address (if searching by zipcode or street prefix)
- Consider full-text search extension (SQLite FTS5) if dataset grows large
- Add search result count capping to prevent runaway queries

**Priority:** Low (current performance is acceptable; defer until dataset scales)

---

## Fragile Areas

### FRAG-01: Review Scoring Logic (Complex, Minimal Unit Tests)

**Area:** Scoring Algorithm

**Files:**
- `src/lib/scoring.ts` (355 LOC) — contains all scoring weight definitions and calculation logic
- `src/lib/__tests__/scoring.test.ts` (390 LOC) — unit tests, but coverage is basic

**Why fragile:**
- Scoring weights are used to compute building and landlord aggregate scores
- Any change to weights requires updating BOTH the weight definition AND the methodology documentation page
- The calculation spans three domain arrays (UNIT_FIELDS, BUILDING_FIELDS, LANDLORD_FIELDS) — a field added to one must be reflected in the corresponding form and survey items
- Test coverage is high, but tests use synthetic data that may not catch edge cases in the live dataset

**Safe modification:**
1. All weight changes MUST include academic citation in code comments
2. Update `src/pages/methodology.astro` in the same PR
3. Run all tests: `npm test -- scoring`
4. Run `/qa` checklist focusing on score consistency across search / detail / profile pages
5. Spot-check 3 live buildings to verify scores are mathematically correct after change

**Test coverage gaps:**
- No test for fallback behavior (when legacy `had_pests` column is used)
- No test for edge case: a review with ALL survey items answered (should still produce valid 1-5 score)
- No test for boundary: reviews with ONLY unit items answered (BUILDING and LANDLORD_FIELDS empty)

**Priority:** Medium (core logic, but not actively changing; revisit when adding new survey items)

---

### FRAG-02: Email Template Synchronization

**Area:** Email Communication

**Issue:** Email templates are HTML strings embedded in `src/lib/email.ts` (566 LOC). If branding colors, URLs, or copy is updated in one template, the other templates may become inconsistent.

**Files:**
- `src/lib/email.ts` — 5 email templates (signup verification, password reset, dispute confirmation, dispute resolution, review rejected)

**Why fragile:**
- All templates are in one large file (hard to see all at once)
- No single source of truth for brand colors, footer copy, or unsubscribe link
- Audit CG1 discovered that dismissed disputes had silent failure (no email) — templates should always confirm action to the user

**Safe modification:**
- When changing a template, verify the updated template renders correctly by testing in a real email client (Gmail, Outlook) not just in browser
- Update ALL templates if changing brand colors or footer copy
- Add comment above each template summarizing its use case and triggers
- Consider extracting brand colors and footer into shared constants

**Priority:** Low (templates are working; fragile mainly in future-maintenance sense)

---

## Missing Critical Features

### FEATURE-01: Email Unsubscribe Management

**Area:** Email Communication / Compliance

**Issue:** The system now sends multiple types of emails (verification, password reset, dispute notifications, review rejection, dispute resolution). There is no way for users to unsubscribe from non-critical emails.

**What's missing:**
- Unsubscribe links in email templates (except verification emails, which are transactional)
- User preference table or column to opt-out of notification emails
- Admin UI to manage user notification preferences
- Logic to skip sending emails if user has opted out

**Problem:** As the email volume scales (e.g., daily digest of review disputes), users may mark emails as spam if they can't unsubscribe. This damages sender reputation and reduces email deliverability.

**Files affected:**
- `src/lib/email.ts` — would need unsubscribe link injection
- `src/pages/api/profile/settings.ts` — would need notification preferences endpoint
- `src/pages/admin/account-settings.astro` or `src/components/profile/SettingsTab.tsx` — user-facing UI for preferences

**Fix approach:**
- Add `notification_preferences` column to users table (JSON: {disputes: bool, reviews: bool, marketing: bool})
- Add unsubscribe link to all non-transactional emails (`${SITE_URL}/api/auth/unsubscribe?token=<signed-token>`)
- Implement `/api/auth/unsubscribe` endpoint (token-based, no auth required)
- Add notification preference checkboxes to SettingsTab.tsx
- Update sendXxxEmail functions to check preferences before sending

**Blocking:** Not explicitly blocking any feature, but should be implemented before scaling email volume (v1.6.0 or v1.7.0)

**Priority:** Low (deferred from v1.5.0, low risk but good practice before scaling)

---

## Test Coverage Gaps

### TEST-01: End-to-End Coverage for Admin Review Actions

**Area:** Testing

**What's not tested:** The full flow of an admin rejecting a review and the tenant receiving the rejection email is not covered by E2E tests with assertions on both sides. Current tests verify the database is updated but don't assert that the email was sent (Resend is mocked in test env).

**Files:**
- `e2e/admin-actions.spec.ts` — tests admin approval/rejection but doesn't capture email state
- `src/pages/api/admin/reviews/[id].ts` — the endpoint itself lacks integration testing with Resend

**Risk:** If email sending logic is broken, E2E tests would not catch it. A tenant's review could be rejected but they might not receive the notification.

**Improvement:**
- Add E2E test that calls the admin endpoint, then queries a mock-Resend log to verify email was sent
- Or capture email in a test database table that E2E tests can query
- Current workaround: manual QA for rejection flow (documented in CLAUDE.md `/qa` checklist)

**Priority:** Medium (manual QA exists, but E2E coverage would be better)

---

### TEST-02: Scoring Edge Cases

**Area:** Testing

**What's not tested:**
- Review with zero responses (all fields null) — should still produce a valid score or graceful null
- Review with partial responses (only unit items filled, no building/landlord items)
- Review with boundary values (all scores = 1 or all = 5)
- Fallback logic when legacy `had_pests` is the only pest-related field set

**Files:**
- `src/lib/__tests__/scoring.test.ts` — tests happy path and some edge cases, but gaps remain

**Risk:** Score calculation could produce NaN or incorrect aggregates if dataset has reviews with unexpected null/partial data patterns.

**Improvement:**
- Add test cases for the above edge cases
- Run scoring tests with live production review data (subset) to ensure real-world compat
- Add property-based tests using test data generation (QuickCheck-style)

**Priority:** Low (scoring logic is well-tested for known patterns; edge cases are theoretical)

---

## Scaling Limits

### SCALE-01: D1 SQLite Single-Region Constraint

**Area:** Database

**Current capacity:**
- Single-region SQLite (Cloudflare D1) can handle up to ~10,000 concurrent connections but in practice Workers are stateless and each request gets a new connection
- Write concurrency is limited by SQLite's locking (one writer at a time)
- Read-heavy workloads scale well; write-heavy workloads will bottleneck

**Limit trigger:** When simultaneous review submissions exceed ~100/second (very high), SQLite lock contention will cause request queueing and increased latency.

**Scaling path:**
1. Monitor D1 query latencies in Cloudflare dashboard
2. If write latency > 1s, consider batching writes (e.g., queue review submissions, process in batches)
3. If read latency > 500ms with large result sets, add indexes and optimize queries
4. For multi-region deployment, would need to migrate to PostgreSQL (out of scope for now)

**Current state:** Well below scaling limits. Live site has ~30 buildings, ~100 reviews. No urgent concern.

**Priority:** Very Low (theoretical; revisit when approaching 1000+ reviews)

---

### SCALE-02: Rate Limiter Accuracy Degradation with High Traffic

**Area:** Rate Limiting

**Issue:** Rate limits are stored in a D1 table (`rate_limits`) with per-IP request counts and timestamps. During very high traffic, writes to this table could contend with other writes (SQLite lock), causing some rate-limit checks to be slightly inaccurate.

**Files:**
- `src/lib/rateLimit.ts` — implements rate limit checks
- `migrations/0010_rate_limits.sql` — creates rate_limits table

**Current behavior:** Fail-closed (on DB error, returns 503), so inaccuracy is safe.

**Scaling path:**
- Monitor rate-limit table write latency
- If > 500ms, consider using in-memory rate limiter with periodic sync to DB (higher complexity)
- Or switch to Cloudflare's native rate-limit support (Durable Objects or Workers KV)

**Priority:** Very Low (current setup handles ~10k requests/day easily; no immediate concern)

---

## Dependencies at Risk

### DEP-01: Cloudflare D1 Beta Status

**Area:** Database Platform

**Risk:** D1 is still in open beta (as of 2026). Features or behavior could change, and breaking changes are theoretically possible (though unlikely to be made without migration path).

**Impact:** If D1 breaking changes occur, the application would need migration to PostgreSQL or other SQL database.

**Mitigation:**
- Monitor Cloudflare announcements for D1 status updates
- Keep backups of database schema and test data
- Version-control all migrations (already done: `migrations/` directory)

**Migration plan:** If needed, export D1 data to CSV, ingest into PostgreSQL. Application code requires minimal changes (switch to different D1/postgres driver).

**Priority:** Low (Cloudflare has strong incentive to stabilize D1; risk is theoretical)

---

### DEP-02: Resend Email Service Availability

**Area:** Email Communication

**Risk:** All email sending depends on Resend API. If Resend becomes unavailable or changes pricing/features, signups and notifications could fail.

**Mitigation:**
- Emails are best-effort (failures don't block primary actions, per v1.5.0 pattern)
- Error handling logs failures for admin review

**Migration plan:** If needed, switch to SendGrid, AWS SES, or other email provider. Requires updating email templates and API calls in `src/lib/email.ts`.

**Priority:** Low (Resend is well-funded and stable; low switching cost if needed)

---

## Known Divergences & Workarounds

### DIVER-01: Search vs Detail Page Scoring Divergence (Acceptable)

**Area:** Data Consistency

**Issue:** Search results page displays aggregate scores calculated at query-time, while the property detail page sometimes recalculates scores from recent reviews. If a new review is submitted between search query and detail page load, the scores might differ slightly.

**Files:**
- `src/pages/api/search.ts` — queries pre-calculated aggregate scores from `building_scores` table
- `src/pages/buildings/[slug].astro` — recalculates scores from live reviews

**Status:** Documented in project memory as acceptable. Dataset is still small enough that exact consistency is not critical. As dataset grows, consider triggering immediate aggregate recalculation on review approval.

**Priority:** Very Low (known and acceptable divergence; revisit at 1000+ reviews)

---

## Recommendations Summary

| Area | Priority | Recommendation |
|------|----------|-----------------|
| Component size (DEBT-01) | Medium | Split ReviewEditForm, BuildingsTable, ReviewsTable in v1.6.0 |
| Email blocking on admin actions (ISSUE-01) | Medium | Convert admin email sends to fireAndForget pattern |
| Email unsubscribe (FEATURE-01) | Low | Implement before scaling notification emails (v1.6.0+) |
| Test coverage gaps (TEST-01, TEST-02) | Low | Add E2E tests for email flows and scoring edge cases |
| Validation consistency (ISSUE-02) | Low | Apply isValidEmail validator to signup.ts |
| Legacy column cleanup (DEBT-02) | Low | Drop `had_pests` column and fallback logic |
| Type safety (DEBT-03) | Low | Replace `as any` casts with proper type definitions |

---

*Concerns audit: 2026-05-02*
