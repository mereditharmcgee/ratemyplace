# Codebase Concerns

**Analysis Date:** 2026-02-26

## Tech Debt

**Widespread `as any` Type Assertions:**
- Issue: 53 instances of `as any` casting throughout codebase. This bypasses TypeScript's type safety system and hides potential runtime errors.
- Files: `src/lib/db.ts`, `src/lib/rateLimit.ts`, `src/lib/auth.ts`, `src/pages/api/admin/reviews/[id].ts`, `src/pages/api/reviews.ts`, `src/pages/api/verification/upload.ts`, and 40+ other files
- Impact: Type safety is compromised. Runtime errors in Cloudflare runtime context may not be caught during development. Future refactoring becomes risky.
- Fix approach: Create proper TypeScript interfaces for Cloudflare context types. Define `Context extends APIContext` with typed `locals` property. This requires updating middleware (`src/middleware.ts`) and creating a context type file.

**Rate Limiting Degradation on Database Failure:**
- Issue: `src/lib/rateLimit.ts` line 67-74 silently allows all requests if rate limit check fails (e.g., table doesn't exist). This is a security vulnerability masquerading as failover.
- Files: `src/lib/rateLimit.ts` (lines 67-74)
- Impact: If database migrations fail or `rate_limits` table is missing, all rate limiting is silently bypassed. Attackers can brute force auth endpoints (signin/signup) without limits.
- Fix approach: Distinguish between temporary database errors and permanent configuration issues. Log explicitly when rate limiting is unavailable. For auth endpoints, either: (1) fail requests hard instead of silently passing, or (2) implement in-memory fallback rate limiting.

**Large Form Component (ReviewForm.tsx - 916 lines):**
- Issue: `src/components/reviews/ReviewForm.tsx` is 916 lines in a single file. Contains state management, form rendering, API calls, validation, and multi-step wizard logic.
- Files: `src/components/reviews/ReviewForm.tsx`
- Impact: Difficult to test individual pieces. High cognitive load. Changes to one feature (e.g., unit details) require scrolling through entire file. Reusability of steps is limited.
- Fix approach: Extract step components (`AddressStep.tsx`, `UnitDetailsStep.tsx`, `RatingStep.tsx`), move state management to a custom hook (`useReviewForm.ts`), move API calls to helper module (`reviewService.ts`).

**Legacy Review Score Field Mapping:**
- Issue: `src/lib/scoring.ts` contains multiple legacy functions (`calculateBuildingAverages`, `calculateLandlordAverages`) that map old field names to new 27-item survey. Schema has moved from 12 legacy fields to 27 weighted fields, but backward compatibility code remains intertwined with current logic.
- Files: `src/lib/scoring.ts` (lines 292-342)
- Impact: Code is confusing - unclear which functions are "current" vs "legacy". Maintenance burden when updating scoring logic. Risk of accidentally using wrong field in new code.
- Fix approach: Create separate `legacyScoring.ts` file for backward compatibility only. Mark legacy functions clearly. Update all new code to use `calculateDomainScores` and `calculateAggregatedScores` exclusively.

**Inconsistent Error Response Patterns in API Endpoints:**
- Issue: Across 25+ API files, error responses are inconsistent. Some use `{ error: 'message' }`, some use `{ error: message, field: 'fieldName' }`, some use `{ success: false, error: 'message' }`. No single error schema.
- Files: `src/pages/api/reviews.ts`, `src/pages/api/reviews/[id].ts`, `src/pages/api/auth/signin.ts`, `src/pages/api/verification/upload.ts`, `src/pages/api/admin/reviews/[id].ts`, and all other API endpoints
- Impact: Client-side error handling must anticipate multiple response shapes. Documentation of error contracts is missing. Breaking changes if response format changes.
- Fix approach: Create standardized error response interface in `src/lib/api.ts`. All endpoints must use `errorResponse()` helper with consistent structure. Update all 25+ endpoints to conform.

## Known Bugs

**SQL Query Vulnerability in Dynamic UPDATE Statement:**
- Issue: `src/pages/api/admin/reviews/[id].ts` lines 52-73 build UPDATE query by concatenating field names into SQL string, then binding values separately. While parameter binding is correct, field names are not validated.
- Files: `src/pages/api/admin/reviews/[id].ts` (lines 52-73)
- Trigger: Admin submits PATCH request with unexpected field names in JSON body. Example: `{ "status": "approved", "DROP TABLE users": true }`
- Workaround: Currently only `status` and `moderation_notes` fields are allowed (whitelist check at line 33), but code is fragile.
- Fix approach: Move from dynamic query building to hardcoded UPDATE statement with explicit field handling. Use prepared statement placeholders for all field names, not just values.

**IP Detection Fallback Order May Fail Behind Proxies:**
- Issue: `src/lib/rateLimit.ts` lines 81-95 check headers in order: CF-Connecting-IP → X-Forwarded-For → X-Real-IP → 'unknown'. On Cloudflare Workers, CF-Connecting-IP is injected automatically, but if request bypasses Cloudflare or headers are spoofed, fallback logic may use wrong IP.
- Files: `src/lib/rateLimit.ts` (lines 81-95)
- Trigger: Attacker spoofs X-Forwarded-For header when CF-Connecting-IP is not present (e.g., direct access to Cloudflare IP, or misconfigured proxy).
- Workaround: Cloudflare proxy is enforced in production, so CF-Connecting-IP should always be present.
- Fix approach: Validate that CF-Connecting-IP is always present (throw error if not in production). Remove fallbacks or log warnings when used. Consider restricting rate limiting to Cloudflare-verified headers only.

**Review Status Field Inconsistency:**
- Issue: Codebase uses both `status` (DB column) and `review_status` (in some type references). Function `calculateAggregatedScores` at line 249 expects a `scores` object but receives full review records, leading to type coercion.
- Files: `src/pages/api/reviews.ts` (line 249), `src/lib/scoring.ts` (line 249)
- Trigger: When calculating aggregated scores across reviews, function attempts to read `scores` property directly from review record, which doesn't exist at top level.
- Workaround: Works due to optional chaining and null checks, but fragile.
- Fix approach: Refactor `calculateAggregatedScores` to take array of structured review objects with explicit score fields. Update callers to extract scores before passing.

## Security Considerations

**Password Migration Path for Legacy Hashes:**
- Risk: `src/lib/password.ts` lines 52-56 accept both PBKDF2 and legacy SHA-256 hashes for backward compatibility. Legacy hashes are weaker and should be migrated immediately on first sign-in.
- Files: `src/lib/password.ts`, `src/pages/api/auth/signin.ts`
- Current mitigation: Legacy hashes are only used for comparison; no new hashes are created with legacy algorithm. Database still contains legacy hashes until password reset.
- Recommendations: (1) Force password reset for legacy hash users on first sign-in. (2) Add admin command to identify and tag accounts with legacy hashes. (3) Set 90-day deadline for migration before disabling login.

**Rate Limiting Without User Context:**
- Risk: Rate limiting is based solely on IP address in `src/lib/rateLimit.ts` lines 36-38. In shared networks (offices, dorms), legitimate users may hit rate limits due to others' brute force attempts.
- Files: `src/lib/rateLimit.ts`, `src/pages/api/auth/signin.ts` (line 38)
- Current mitigation: Rate limits are generous (5 attempts per 15 minutes for signin). Error message clearly states time remaining.
- Recommendations: (1) Consider session-based rate limiting for authenticated users (separate from IP limits). (2) Add admin whitelist for known IPs (e.g., development, support team). (3) Monitor false positive rate and adjust limits if needed.

**R2 Storage Access Control:**
- Risk: Verification images uploaded to R2 at `src/lib/storage.ts` line 58 use predictable path `users/{userId}/verifications/{reviewId}/{timestamp}.{ext}`. If bucket is misconfigured, images may be publicly readable.
- Files: `src/lib/storage.ts` (line 55), `src/pages/api/verification/upload.ts`
- Current mitigation: Images require review before access is granted. No public endpoint exposes images.
- Recommendations: (1) Verify R2 bucket ACL is private in production. (2) Add explicit access control check when serving images to admin. (3) Consider encrypting sensitive image metadata with KMS.

**Validation Regex Gaps:**
- Risk: `src/lib/validation.ts` line 98 uses regex `/(<[^>]*>)/g` to strip HTML tags, but this is insufficient protection against DOM-based XSS. Sanitization-only approach is fragile.
- Files: `src/lib/validation.ts` (line 98)
- Current mitigation: Astro uses auto-escaping; React components also escape by default. However, sanitized text is stored in database and re-rendered, creating multiple escape opportunities.
- Recommendations: (1) Use a robust HTML sanitization library (e.g., `DOMPurify`) instead of regex. (2) Validate that review text contains only safe markup. (3) Store sanitized HTML only in database.

**Admin Action Audit Trail Missing:**
- Risk: Admin endpoints like `PATCH /api/admin/reviews/[id]` at `src/pages/api/admin/reviews/[id].ts` lines 69-73 modify review status and moderation notes, but do not log who made the change or when.
- Files: `src/pages/api/admin/reviews/[id].ts`, `src/pages/api/admin/buildings/[id].ts`, `src/pages/api/admin/users/[id].ts`
- Current mitigation: Database has `updated_at` timestamp, but no `updated_by` field.
- Recommendations: (1) Add `updated_by` and `updated_at` fields to all modifiable tables. (2) Create audit log table tracking admin actions. (3) Display audit history in admin dashboard.

## Performance Bottlenecks

**Unindexed Building and Review Searches:**
- Problem: `src/pages/api/buildings.ts` line 40-46 uses LIKE queries on `address` and `neighborhood` fields without database indexes.
- Files: `src/pages/api/buildings.ts` (lines 40-46)
- Cause: SELECT query with two LIKE wildcards; database must scan entire buildings table on each search.
- Improvement path: (1) Add database indexes on `buildings.address` and `buildings.neighborhood`. (2) Consider full-text search if data grows beyond 10k buildings. (3) Add query limit (already set to 10) and pagination.

**Review Aggregation Queries on Large Datasets:**
- Problem: Building and landlord profile pages load all reviews to calculate aggregated scores. `calculateAggregatedScores` at `src/lib/scoring.ts` line 209 is O(n) in review count.
- Files: `src/lib/scoring.ts` (lines 209-286), review fetch queries in page components
- Cause: No materialized view or cached aggregates; every page load recalculates for all reviews.
- Improvement path: (1) Create materialized `building_aggregates` and `landlord_aggregates` tables. (2) Update aggregates incrementally when new review is approved. (3) Cache building/landlord pages for 1 hour. (4) Consider pagination for buildings with 100+ reviews.

**Form State Management Causes Re-renders:**
- Problem: `src/components/reviews/ReviewForm.tsx` manages 70+ state variables (scores, unit details, tenancy, etc.). Each state change triggers full component re-render.
- Files: `src/components/reviews/ReviewForm.tsx`
- Cause: No memoization; complex form with many input fields will re-render entire form on each keystroke.
- Improvement path: (1) Use `useCallback` for input handlers to prevent child re-renders. (2) Split form into smaller components with `React.memo`. (3) Use form library (React Hook Form) to manage state more efficiently.

## Fragile Areas

**Database Schema Assumptions in API Endpoints:**
- Files: All API endpoints in `src/pages/api/` (26 files)
- Why fragile: Each endpoint assumes specific column names in database (e.g., `move_out_year_new`, `unit_structural`). If schema changes, many endpoints break simultaneously.
- Safe modification: (1) Create data access layer (`src/lib/queries/`) with helper functions for common database operations. (2) Update schema → update helpers → endpoints automatically benefit. (3) Add TypeScript interfaces matching database schema and validate at import time.
- Test coverage: No integration tests verify API contracts match schema.

**Survey Item Configuration Scattered:**
- Files: `src/lib/surveyItems.ts` (561 lines), `src/lib/scoring.ts` (361 lines), `src/lib/formOptions.ts`
- Why fragile: Survey item definitions, response options, and scoring weights are split across three files with no central source of truth. Adding a new survey item requires updates to all three files.
- Safe modification: Create single `src/lib/surveyConfig.ts` with centralized item definitions. Export item lists, weights, and response options from this single source.
- Test coverage: `src/lib/__tests__/scoring.test.ts` has 422 lines but does not test that all items in `surveyItems` are weighted in `scoring`.

**Authentication Context Access Pattern:**
- Files: 53+ instances of `(context.locals as any).runtime` across API endpoints
- Why fragile: Every endpoint must remember the exact pattern to access database context. Typo in one endpoint silently fails.
- Safe modification: Create `src/lib/context.ts` with typed helper:
  ```typescript
  export function getRuntime(context: APIContext): Runtime {
    const runtime = (context.locals as any).runtime;
    if (!runtime?.env?.DB) throw new Error('DB not configured');
    return runtime;
  }
  ```
  All endpoints call `getRuntime(context)` once.
- Test coverage: No unit tests for context access patterns.

**Validation Logic Duplication:**
- Files: `src/lib/validation.ts`, `src/components/reviews/ReviewForm.tsx` (client-side validation), API endpoints (server-side validation)
- Why fragile: Move-in year validation, unit type validation, score range checks appear in multiple places. Changes to business rules must be propagated to all locations.
- Safe modification: Consolidate all validation to single source. Export validation functions from `src/lib/validation.ts`. Client imports same functions for instant feedback. Servers always validate before insert.
- Test coverage: `src/lib/__tests__/validation.test.ts` tests only `validateReviewForm`, not client-side validation or API endpoint validation.

## Scaling Limits

**D1 Database Scalability Ceiling:**
- Current capacity: Cloudflare D1 is SQLite-based, suitable for <50GB databases.
- Limit: At ~2KB per review record, D1 can hold approximately 25 million reviews before approaching size limits. With 100 buildings each averaging 10,000 reviews, platform reaches this limit at ~125 buildings in Boston alone.
- Scaling path: (1) Implement data archival: move reviews older than 2 years to long-term storage. (2) Consider migration to PostgreSQL via Cloudflare Hyperdrive if growth continues. (3) Shard by city/neighborhood before outgrowing D1.

**R2 Storage for Verification Images:**
- Current capacity: R2 can handle unlimited files. Current usage is minimal (only verification images).
- Limit: With 10MB max file size and 1 image per review average, R2 can store >1 million verification images. Not a bottleneck in foreseeable future.
- Scaling path: No action needed short-term. When reaching 10TB+ consider lifecycle policies to archive old images.

**Page Load Time with Large Result Sets:**
- Current capacity: Building profile pages query all reviews for aggregation. With 10k reviews, this is a few hundred milliseconds.
- Limit: Beyond 50k reviews per building, full aggregation on page load becomes slow (>2 seconds).
- Scaling path: Implement caching layer (Cloudflare Cache API) with 1-hour TTL for aggregates. Update aggregates asynchronously after new review approval.

## Dependencies at Risk

**Lucia Auth Library Maintenance:**
- Risk: Lucia (v3.2.2) is a smaller auth library with limited community compared to Auth0/NextAuth. Future breaking changes in Lucia's API require codebase-wide updates.
- Impact: `src/lib/auth.ts` and `src/middleware.ts` depend heavily on Lucia's APIs. Session management relies on Lucia's adapter.
- Migration plan: If Lucia becomes unmaintained, migrate to standard session management using crypto module from `@oslojs/crypto` (already a dependency). Lucia is primarily a convenience wrapper; low-level logic can be ported to custom code within 1 week.

**@oslojs/crypto Dependency Chain:**
- Risk: `@oslojs/crypto` and `@oslojs/encoding` are very new packages (v1.0.1, v1.1.0). Limited adoption, potential for bugs and breaking changes.
- Impact: Password hashing (`src/lib/password.ts`) and encoding use these packages. If packages are abandoned, password verification fails.
- Migration plan: Both packages are wrappers around standard Web Crypto API. Code can be updated to use `crypto.subtle` directly (requires updating `src/lib/password.ts` lines 21-44 and 70-89).

**Google OAuth Integration Dependency:**
- Risk: Google auth is implemented via `src/pages/api/auth/google.ts` and `src/pages/api/auth/google/callback.ts` using manual OAuth flow. No SDK library; entirely custom implementation. If Google changes OAuth 2.0 spec, custom code breaks.
- Impact: Users with Google accounts cannot sign in if implementation breaks.
- Migration plan: Consider adopting Auth0 or Clerk for OAuth management instead of custom implementation. Alternatively, write integration tests against Google OAuth endpoints to detect breaking changes early.

## Missing Critical Features

**Email Verification for Account Recovery:**
- Problem: Users can sign up with any email address. If email is mistyped, account is inaccessible. No password reset mechanism exists.
- Blocks: Users cannot recover account if password is lost. Multi-user household scenarios are fragile (shared email = shared login).
- Recommendation: Implement email verification flow: (1) Send verification link on signup. (2) Require email verification before account is active. (3) Add password reset endpoint that emails reset link. (4) Store and validate email verification tokens with expiry.

**Two-Factor Authentication for Admins:**
- Problem: Admin accounts are protected only by password. High-value target for attackers (access to moderation, user deletion, etc.).
- Blocks: Cannot safely onboard remote admin team; no audit trail of admin logins.
- Recommendation: Implement TOTP-based 2FA for admin accounts. Use standard library (e.g., `speakeasy`, `authenticator.ts`). Store secret in database, require code on admin login.

**Content Moderation Automation:**
- Problem: `src/pages/api/admin/pending-verifications.ts` and review moderation require manual admin review of all pending items. No automated filtering for spam/abuse.
- Blocks: As platform scales, manual review becomes bottleneck.
- Recommendation: Implement simple heuristics: (1) Flag reviews with all-1-star scores as potential spam. (2) Flag reviews mentioning competitor names. (3) Implement user reputation score to auto-approve reviews from trusted users. (4) Add webhook to external moderation service if needed.

**Review Edit History / Version Control:**
- Problem: `src/pages/api/reviews/[id].ts` allows users to edit reviews, but old versions are lost. Users could edit review to change meaning after fact.
- Blocks: No audit trail; moderators cannot verify if review content changed after approval.
- Recommendation: Store review edit history: (1) Add `review_versions` table with full review content + edit timestamp. (2) Display "Edited [date]" label on reviews with edit history. (3) Allow moderators to view revision diff in admin dashboard.

## Test Coverage Gaps

**API Endpoint Integration Tests Missing:**
- What's not tested: 26 API endpoints in `src/pages/api/` have minimal test coverage. No tests verify:
  - Correct database queries are executed
  - Error responses match expected schema
  - Authorization checks prevent unauthorized access
  - Request validation rejects invalid input
- Files: `src/pages/api/auth/signin.ts`, `src/pages/api/reviews.ts`, `src/pages/api/admin/*` (and 20+ others)
- Risk: Regression in auth flow, data corruption from invalid requests, or privilege escalation could go undetected.
- Priority: **High** - Auth and data modification endpoints are most critical.

**Component Integration Tests Missing:**
- What's not tested: React components in `src/components/` have limited test coverage. No tests verify:
  - ReviewForm multi-step flow works end-to-end
  - Form state persists when navigating between steps
  - Address autocomplete fetches correct building data
  - Map component renders buildings correctly
- Files: `src/components/reviews/ReviewForm.tsx` (916 lines, zero tests), `src/components/BuildingMap.tsx`, `src/components/AddressAutocomplete.tsx`
- Risk: UI regressions, broken form flows, and bad user experience go undetected.
- Priority: **Medium** - Important for user experience but less critical than backend tests.

**Scoring Logic Edge Cases:**
- What's not tested: `src/lib/scoring.ts` has tests in `src/lib/__tests__/scoring.test.ts` (422 lines) but missing edge cases:
  - What if all scores are null? (Returns null aggregate - is this correct?)
  - What if only 1 review exists with partial scores?
  - Recency weighting at exactly 2, 3, 4, 5 year boundaries
  - Mixing reviews with old vs new score schemas
  - Division by zero when total weight is 0
- Files: `src/lib/scoring.ts`, `src/lib/__tests__/scoring.test.ts`
- Risk: Incorrect aggregates displayed on building pages; misleading scores to users.
- Priority: **High** - Scoring is core to platform value.

**Database Schema Migrations Not Tested:**
- What's not tested: `migrations/` directory contains SQL files but no tests verify:
  - Schema is applied correctly
  - Migrations are idempotent
  - New columns have correct default values
  - Foreign key constraints are enforced
  - Backward compatibility with old schema
- Files: All files in `migrations/` directory
- Risk: Production migration could corrupt data or lock database.
- Priority: **High** - Database integrity is critical.

**Error Handling Edge Cases:**
- What's not tested: Rate limiting, validation, and storage errors are not tested:
  - What happens if R2 bucket is unreachable?
  - What if database transaction is interrupted mid-insert?
  - What if validation regex fails to parse input?
- Files: `src/lib/rateLimit.ts`, `src/lib/validation.ts`, `src/lib/storage.ts`, `src/pages/api/verification/upload.ts`
- Risk: Unexpected crashes, failed uploads without proper error message, degraded functionality.
- Priority: **Medium** - Important for reliability but less critical than core flow tests.

---

*Concerns audit: 2026-02-26*
