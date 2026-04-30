# Codebase Concerns

**Analysis Date:** 2026-04-26

## Tech Debt

### Dual Legacy Pest Columns
- **Issue:** Two overlapping columns exist for pest reporting: `had_pests` (migration 0004) and `had_pest_issues` (migration 0001).
- **Files:** `migrations/0001_initial.sql`, `migrations/0004_survey_scores.sql`, `src/lib/types.ts` (line 75), `src/pages/api/reviews/[id].ts` (line 76)
- **Impact:** Code uses fallback logic to normalize the mismatch; no data loss but creates type/semantic confusion. Adds maintenance burden when displaying pest data across UI.
- **Fix approach:** 
  1. Migrate all `had_pests=1` rows to `had_pest_issues=1` 
  2. Drop `had_pests` column in new migration
  3. Update all code references to use `had_pest_issues` consistently
  4. Cost: Low (fallback pattern works, migration is straightforward)

### Legacy v1 Score Columns (12 columns)
- **Issue:** Redundant old scoring columns kept for backward compatibility: `score_building_quality`, `score_maintenance`, `score_pest_control`, `score_safety`, `score_noise`, `score_landlord_responsiveness`, `score_landlord_communication`, `score_landlord_fairness`, `score_lease_clarity`, `score_deposit_handling`, `score_rent_value`, `score_amenities`.
- **Files:** `migrations/0001_initial.sql` (lines 82-94), `src/lib/types.ts` (lines 57-68), `src/pages/api/reviews/[id].ts` (lines 59-71)
- **Impact:** New reviews use the 27-item rating instrument (v2); legacy columns are never written. No runtime impact but clutters schema and API responses. Database footprint cost is minimal.
- **Fix approach:** 
  1. Keep columns for backward-compatible data reads (safe for historical data)
  2. If ever removing: requires audit of any external consumers, then safe migration
  3. Current strategy (keep) is appropriate; migration to remove is deferred until dataset reaches significant scale
- **Priority:** Low (non-blocking, actively managed via code comments)

### Type Coercion Pattern: `(context.locals as any).runtime`
- **Issue:** 71 instances across API routes and library files cast `context.locals` to `any` to access Cloudflare runtime object due to incomplete Astro type definitions.
- **Files:** `src/pages/api/**/*.ts`, `src/lib/db.ts` (line 3), `src/lib/audit.ts` (line 22), `src/lib/rateLimit.ts` (line 23), `src/lib/notifications.ts` (line 37), and 67 more API routes
- **Impact:** Bypasses TypeScript type safety for Cloudflare-specific properties. Not a security risk (Cloudflare runtime is legitimate); but reduces IDE assistance and makes refactoring harder.
- **Fix approach:**
  1. Create a typed wrapper for Cloudflare runtime:
     ```typescript
     // src/lib/types.ts - add
     export interface CloudflareContext {
       runtime?: {
         env?: Record<string, string | D1Database>;
         context?: ExecutionContext;
       };
     }
     ```
  2. Replace `(context.locals as any).runtime` with typed access throughout
  3. Cost: Medium (repetitive but straightforward refactoring, can be done incrementally)
  4. Timeline: Acceptable as future tech debt cleanup

### Over-Permissive `any` Types in Scoring Functions
- **Issue:** Core scoring functions accept `any[]` for review data instead of typed `Review` objects.
- **Files:** `src/lib/scoring.ts` (lines 209, 295, 330) - `calculateAggregatedScores()`, `calculateBuildingAverages()`, `calculateLandlordAverages()`
- **Impact:** Type safety lost for critical business logic. Makes it harder to verify correctness of calculations. Not a bug (functions work correctly) but increases maintenance risk.
- **Fix approach:**
  1. Define `ReviewScoreData` interface with required score fields
  2. Update function signatures to accept `ReviewScoreData[]`
  3. Update call sites to pass properly typed data
  4. Cost: Low (functions are well-tested, isolated from other code)

## Scaling Limits

### Database Query Performance at Scale
- **Problem:** No query optimization for aggregate calculations. `building_scores` and `landlord_scores` are materialized tables but update strategy is not formalized.
- **Files:** `src/lib/scoring.ts` (aggregation functions), no dedicated update/invalidation trigger visible
- **Current capacity:** Works fine for current dataset (single city, < 1000 buildings); scaling concern only relevant if:
  - Expanding to 5+ cities
  - Each city has 100+ buildings with 50+ reviews each
- **Scaling path:**
  1. Implement background job to recalculate scores on schedule (daily vs real-time trade-off)
  2. Add indexes on `building_scores.updated_at` and `landlord_scores.updated_at`
  3. Consider database views instead of materialized tables if write frequency increases
  4. Timeline: Defer until load testing shows >1s response times

### Component Size Growing
- **Problem:** Two React components exceed 700 lines, making them harder to test and modify.
- **Files:** 
  - `src/components/reviews/ReviewEditForm.tsx` (907 lines)
  - `src/components/admin/BuildingsTable.tsx` (844 lines)
  - `src/components/admin/ReviewsTable.tsx` (733 lines)
- **Impact:** Difficult to reuse, test in isolation, or debug. Not broken, but increasing complexity debt.
- **Fix approach:**
  1. Extract form steps into separate components (ReviewEditForm already uses sub-steps pattern, could go further)
  2. Split admin tables into smaller components: `TableHeader`, `TableRow`, `TableFilters`, `TablePagination`
  3. Move filtering/sorting logic to custom hooks
  4. Cost: Medium (structured refactoring over 2-3 PRs)
  5. Timeline: Next "cleanup" phase

## Missing Critical Features

### Rate Limiting Coverage Gap
- **Problem:** Rate limiting only applies to `/api/auth/signin` endpoint. Public-facing endpoints lack protection.
- **Files:** `src/lib/rateLimit.ts` (implemented), `src/pages/api/**` (mostly not using it)
- **Unprotected endpoints:** `/api/search`, `/api/buildings/[id]`, `/api/reviews` (GET), `/api/contacts` (POST - especially needed)
- **Risk:** Brute-force attacks on search, contact form spam, DoS on building details
- **Recommendations:**
  1. Apply rate limiting to all public POST endpoints (contacts, bug reports, disputes)
  2. Apply moderate rate limiting to search (per-IP 100 req/min)
  3. Add rate limit headers to responses for client awareness
  4. Files to update: `src/pages/api/search.ts`, `src/pages/api/contacts.ts`, `src/pages/api/bug-reports.ts`, `src/pages/api/disputes.ts`

## Fragile Areas

### Survey Field Mapping Complexity
- **Files:** `src/lib/surveyItems.ts` (579 lines), `src/components/reviews/ReviewForm.tsx`, `src/components/reviews/ReviewEditForm.tsx`
- **Why fragile:** 27 survey fields spread across 3 domain arrays (UNIT_FIELDS, BUILDING_FIELDS, LANDLORD_FIELDS) in `src/lib/scoring.ts`. Adding a field requires coordinated changes in 4+ places:
  1. Migration to add column
  2. `surveyItems.ts` - add to correct domain array and question text
  3. `scoring.ts` - add to domain array AND set weight in ITEM_WEIGHTS
  4. ReviewForm component - add input step
  5. ReviewEditForm component - add input step
  6. ReviewCard - if displayed
- **Safe modification:**
  - Always verify field added to `ALL_SCORE_FIELDS` in scoring.ts before deployment
  - Add a compile-time check: ensure every field in UNIT_FIELDS/BUILDING_FIELDS/LANDLORD_FIELDS exists in ITEM_WEIGHTS
  - Create a pre-deploy checklist for survey field additions
- **Test coverage:** Scoring tests (421 lines) cover weights but not form UI coverage

### Auth Session Management
- **Files:** `src/pages/api/auth/signin.ts`, `src/pages/auth/logout.astro`, `src/lib/**` (Lucia auth)
- **Why fragile:** OAuth flow has known production issue (Google logins blocked by Cloudflare bot detection). Session invalidation on logout works but edge cases possible with:
  - Multiple browser tabs with stale sessions
  - Manual Lucia session table deletes (e.g., admin cleanup)
  - Clock skew between Cloudflare and browser
- **Safe modification:**
  - Always test session invalidation in headless browser (Playwright)
  - Verify OAuth redirect flow with production credentials before pushing
  - Add explicit session token validation on protected endpoints (currently relies on Lucia middleware)
- **Test coverage:** E2E tests in `e2e/` cover happy path; session edge cases not covered

## Test Coverage Gaps

### Admin Panel Actions
- **What's not tested:** Admin approval/rejection workflow, moderation notes, audit log entries
- **Files:** `src/pages/admin/reviews.astro`, `src/components/admin/ReviewsTable.tsx`, `src/pages/api/admin/reviews/[id].ts`
- **Risk:** Admin actions could silently fail (e.g., audit log create fails but approval succeeds)
- **Priority:** High (affects core moderation flow)

### Data Consistency Across Views
- **What's not tested:** Same review appears in multiple places (dashboard, search results, building detail page) — no automated check that scores match
- **Files:** `src/pages/search.astro`, `src/pages/buildings/[slug].astro`, `src/pages/profile.astro`, `src/components/profile/ProfileDashboard.tsx`
- **Risk:** Cache staleness or aggregation bugs could cause score mismatches visible to users
- **Priority:** High (data integrity concern)
- **Approach:** Add E2E test that creates review, checks score on all 3 views, then edits review and verifies all 3 views update

### Edge Cases in Scoring
- **What's not tested:** 
  - Review with all null scores
  - Review with mix of null and valid scores
  - Score calculation for building with 0 or 1 review (edge cases in averaging)
- **Files:** `src/lib/scoring.ts`, test file `src/lib/__tests__/scoring.test.ts` (422 lines)
- **Risk:** Aggregation functions could return NaN or Infinity
- **Priority:** Medium (low probability but high impact if occurs)

### Search & Autocomplete Reliability
- **What's not tested:** 
  - Search with special characters (quotes, SQL-like strings)
  - Autocomplete with building names > 100 chars
  - Pagination with filters applied
- **Files:** `src/pages/api/search.ts`, `src/components/AddressAutocomplete.tsx`, `e2e/`
- **Risk:** Search could fail silently or return incorrect results
- **Priority:** Medium (user-facing feature)

## Performance Bottlenecks

### Building Detail Page Rendering
- **Problem:** When a building has 20+ reviews, the page calculates scores in-component rather than using pre-calculated aggregate.
- **Files:** `src/pages/buildings/[slug].astro`, `src/components/reviews/ReviewCard.astro`
- **Cause:** `ReviewCard` component calculates category scores from raw item scores on every render
- **Impact:** Acceptable for current scale (< 100 reviews per building) but O(n) recalculation waste
- **Improvement path:**
  1. Fetch pre-calculated `building_scores` aggregate from API
  2. Use aggregate scores in ReviewCard instead of per-review calculation
  3. Cost: Low (aggregate already calculated, just need to pass it)

### Search Filtering Without Database Index
- **Problem:** Search filters on `neighborhood`, `city`, `building_type` but unclear if these columns are indexed
- **Files:** `migrations/0001_initial.sql` (lines 40-42 show some indexes), `src/pages/api/search.ts`
- **Impact:** Full table scans possible on large datasets
- **Verification needed:** Check production database index coverage on filter columns
- **Improvement:** Add missing indexes on frequently filtered columns

### Email Sending Synchronously in API Routes
- **Problem:** Email sends (verify, reset, notifications) block API response in `src/lib/email.ts` (458 lines)
- **Files:** `src/lib/email.ts`, `src/pages/api/auth/verify.ts`, `src/pages/api/auth/forgot-password.ts`
- **Impact:** API response time = email send time. Resend API latency (200-500ms) adds to every email route.
- **Improvement path:**
  1. Switch to fire-and-forget pattern with best-effort retry
  2. Log email failures separately; don't block user-facing response
  3. Cost: Medium (requires error handling strategy for failed emails)

## Known Bugs

### OAuth Redirect Issue in Production
- **Symptoms:** Google OAuth logins fail on ratemyplace.org; work locally
- **Files:** `src/pages/api/auth/google-callback.ts`, Cloudflare Workers middleware
- **Trigger:** User clicks "Sign in with Google" on production
- **Cause:** Cloudflare bot detection (BotManagement) blocks OAuth redirect verification
- **Current mitigation:** Workaround uses SITE_URL env var; not fully reliable
- **Recommendations:**
  1. Update Cloudflare WAF rules to whitelist OAuth callback paths
  2. Implement fallback to email-only auth path if OAuth fails
  3. Add explicit OAuth error logging to diagnose other similar issues
  4. Test OAuth with production credentials in staging environment before rolling out
- **Workaround:** Email signup/login works (63 lines in `src/pages/api/auth/signin.ts`)

### Empty State Handling Inconsistency
- **Problem:** Different empty state messages across pages (search returns "No results", building with 0 reviews shows "Be the first to review")
- **Files:** `src/pages/search.astro`, `src/pages/buildings/[slug].astro`
- **Impact:** Minor UX inconsistency, not a bug
- **Fix:** Create shared empty state component `src/components/EmptyState.tsx` with consistent messaging

## Security Considerations

### API Response Data Leakage
- **Risk:** Admin-only fields in API responses could expose information if authorization checks are incomplete
- **Files:** `src/pages/api/reviews/[id].ts`, `src/pages/api/admin/**/*.ts`
- **Current mitigation:** All API routes check `context.locals.user` before returning data; admin routes check `context.locals.user?.isAdmin`
- **Verification:** Code review shows all checks in place (lines 94-98 in [id].ts); no leakage detected
- **Recommendations:**
  1. Audit all admin endpoints on next security review
  2. Add explicit allowlist of fields returned in public vs admin responses
  3. Document which fields are admin-only (inline comments in API routes)

### SQL Injection Prevention
- **Current status:** All queries use parameterized bindings (`.bind()` pattern)
- **Files:** Every file in `src/pages/api/` uses D1 parameterized API
- **Verification:** No string interpolation in SQL queries found; pattern is consistent
- **Recommendation:** Maintain this pattern (documented in CLAUDE.md)

### CSRF Protection
- **Current status:** No explicit CSRF token implementation visible
- **Files:** `src/pages/api/**/*.ts`
- **Risk:** Form submissions (review create, edit, delete) could be vulnerable to CSRF if user is logged in elsewhere
- **Verification needed:** Check if Astro or Lucia includes built-in CSRF protection
- **Recommendation:**
  1. Audit CSRF protection status (may be built into Lucia/Astro)
  2. If not present, add CSRF token generation/validation to all state-changing endpoints
  3. Use SameSite cookie attribute (Lucia may already do this)

### Input Validation Coverage
- **Risk:** Some endpoints may accept invalid input
- **Files:** `src/lib/validation.ts` (imported but extent of coverage unknown), `src/pages/api/**/*.ts`
- **Verification:** Need comprehensive audit of all endpoints for:
  - Missing length limits (e.g., review text could be >1MB)
  - Missing type checks (e.g., rent_amount accepts non-numeric)
  - Missing format validation (e.g., email, zip code)
- **Recommendation:**
  1. Create validation test suite
  2. Add max length constraints on all text fields
  3. Validate rent_amount/laundry_cost as integers only
  4. Validate emails with regex or library

---

*Concerns audit: 2026-04-26*
