# Feature Landscape: QA & Stress Testing (v1.3.0 "Battle Tested")

**Domain:** Comprehensive QA milestone for a production tenant housing review web app
**Researched:** 2026-02-27
**Stack context:** Astro 5 SSR + Cloudflare Pages/D1 (SQLite) + Lucia Auth + Playwright + Vitest

---

## Existing Test Infrastructure (Baseline)

Understanding what already exists is essential before scoping what to build.

**Already present and working:**
- Vitest unit tests: 10 test files covering scoring, validation, rateLimit, tokens, audit, disputes, logger, password, formOptions — this is good coverage of lib/ functions
- Playwright E2E: 2 spec files (pages.spec.ts, navigation.spec.ts) covering unauthenticated page loads, nav links, static page rendering, and auth redirects — surface-level only, no authenticated flows
- Smoke test script (scripts/smoke-test.ts): hits every public page, checks 200 status and expected content strings — runnable against staging/prod
- No: authenticated E2E flows (review submission, admin actions, dispute filing), no data seed scripts, no security probing tests, no responsive stress tests

**Gap:** All existing E2E tests are unauthenticated. The most critical user flows — submitting a review, moderation, disputes, admin actions — have zero E2E coverage.

---

## Table Stakes

Features users (or the dev team) expect. Missing any of these means the QA milestone is incomplete.

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Realistic seed data (buildings, landlords, reviews, disputes) | UI breaks without data; pagination, scoring, empty states untestable | Medium | Use `wrangler d1 execute --local --file=seed.sql`; target ~20 buildings, 15 landlords, 50-100 reviews, 5-10 disputes. This is the right D1 seeding pattern. |
| Authenticated E2E: full review submission flow | Core product value; zero coverage today | High | Requires Playwright storageState for session reuse. Must cover: login → search/find building → submit 27-item form → confirm review appears on building profile |
| Authenticated E2E: auth flows (signup, email verification, signin, signout, password reset) | Auth is the gate to all protected features | High | Email verification requires mocking Resend or using a test email address; password reset token lifecycle must be covered |
| Authenticated E2E: admin moderation actions | Admin dashboard has 9 sub-pages and 0 E2E coverage | High | Must cover: approve review, reject review, verify building, resolve dispute, view audit log. Requires separate admin storageState fixture. |
| Authenticated E2E: landlord dispute filing | Full dispute workflow built in v1.2.2 but untested E2E | Medium | Cover: find review → fill dispute form → submit → appears in admin queue → admin resolves |
| Edge case: long inputs and special characters | SQLite stores them but UI may truncate/break | Medium | Test 200-char title, 5000-char review body, emoji in text fields, Unicode in building names, apostrophes in landlord names |
| Edge case: form boundary values | Validation logic tested in unit tests but not through the full HTTP stack | Medium | Score = 0, score = 6 (both should 400), rent = -1, rent = 50001, move_in_year in the future, move_out before move_in |
| Security: auth bypass attempts | Most critical for public-facing site | High | Direct API calls without session cookie → must get 401; non-admin user hitting /api/admin/* → must get 403; accessing another user's data → must be blocked |
| Security: SQL injection via form fields | Parameterized queries should protect but must be verified | Medium | Test `'; DROP TABLE reviews; --` in text fields, `OR 1=1` in search params |
| Security: rate limiting enforcement | Fail-closed rate limiter was the focus of v1.2.2 | Medium | Verify that >5 rapid signin attempts returns 429 with correct headers; verify 503 on simulated DB error (unit test already covers this but E2E should confirm the HTTP surface) |
| UI stress: building profile with many reviews | Aggregate scoring, pagination, layout at 20+ reviews | Medium | Seed one building with 20+ reviews across score ranges; verify score display, color coding, and layout don't break |
| UI stress: empty state rendering | Many pages have "no results" branches that may have bugs | Low | Verify: search with no results, building with 0 reviews, landlord with 0 buildings, admin queue empty |
| UI stress: responsive layout at scale | Admin tables with many rows; search results with many buildings | Medium | Test admin reviews table with 50+ rows; search results with 20+ buildings; mobile viewport |

---

## Differentiators

Features beyond the minimum that meaningfully increase confidence before launch. Valuable but not blocking.

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Concurrent submission testing | D1 has no cross-request transactions; concurrent duplicate review submissions from same user could create inconsistencies | Medium | Use `Promise.all()` with multiple API calls at the same time; verify only one review is accepted |
| Admin audit log accuracy testing | Verify that admin actions actually write correct entries to audit_logs | Medium | Perform approve/reject/verify actions in E2E, then query audit log and assert correct action_type, entity_id, old_value, new_value |
| Score aggregation correctness at volume | calculateAggregatedScores is unit-tested but not validated against real D1 data | Medium | Seed building with known reviews at known scores, load profile page, assert displayed aggregate matches manual calculation |
| Token lifecycle edge cases | Email verification and password reset tokens can expire — these flows are untested E2E | High | Requires time manipulation or inserting expired tokens directly in D1; verify expired token shows correct error message, not a 500 |
| XSS probe via text fields | sanitizeText is unit-tested but server rendering of stored text needs validation | Medium | Submit review with `<script>alert(1)</script>` in review_text; verify the text appears escaped/stripped on the building profile page, not executed |
| Search edge cases | Search with query string injection, very long queries, queries with no results vs queries with many | Low | Tests cover behavior the smoke test does not |
| Rate limit header validation | Client-facing rate limit responses should include Retry-After header | Low | Unit test confirms fail-closed behavior; E2E can confirm 429 response structure |
| Dispute uniqueness constraint | UNIQUE constraint on disputes.review_id is enforced at DB level; test the error surface | Low | Attempt to file a second dispute for the same review; should return an appropriate error, not a 500 |

---

## Anti-Features

Features to explicitly NOT build for this QA milestone.

| Anti-Feature | Why Avoid | What to Do Instead |
|--------------|-----------|-------------------|
| Chaos engineering / fault injection | Way beyond scope for a pre-launch milestone on a solo-maintained project; tools like Chaos Monkey require infrastructure-level control | Stick to targeted edge-case and concurrent request tests |
| Visual regression testing (screenshot diffs) | High maintenance burden: needs baseline screenshots, breaks on any styling tweak, requires separate tooling (Percy, Chromatic) | Not justified before first real users; revisit post-launch if regressions become a problem |
| Fuzzing (automated input mutation) | Tools like AFL/libFuzzer or API fuzzing with Burp Suite are enterprise-grade; overkill when you control all inputs via validation.ts | Manual boundary testing of known input ranges is sufficient |
| Performance load testing (k6, Locust, Artillery) | Cloudflare Workers auto-scale; D1 bottleneck under real load is a post-launch concern | Instead, seed realistic data volume and observe SSR response times from smoke test ms readings |
| DAST scanning (OWASP ZAP, Burp Suite) | Heavy tooling requiring a running staging environment with specific configuration; produces many false positives; not calibrated to this app | Manual security spot-checks covering the OWASP Top 10 vectors most relevant to this app are sufficient |
| Mutation testing | Checks if tests detect code changes; useful for mature test suites; premature when E2E coverage gaps are this large | Fill the coverage gaps first |
| CI/CD pipeline integration | PROJECT.md does not mention CI setup; setting up GitHub Actions is a separate workstream | Out of scope for this milestone; worth doing post-launch |

---

## Feature Dependencies

```
Seed data (buildings, landlords, reviews, disputes)
  → Required before: UI stress tests, score aggregation tests, admin table tests, pagination tests

Playwright storageState: regular user session
  → Required before: review submission E2E, dispute filing E2E, profile page auth tests

Playwright storageState: admin session
  → Required before: all admin moderation E2E tests, audit log accuracy tests

Auth E2E (signup flow)
  → Required before: email verification token lifecycle tests

Rate limiting E2E
  → Required before: rate limit header validation test
```

---

## User Flows That Need E2E Coverage

Ordered from most critical to least critical. All of these currently have zero Playwright coverage.

**Critical (must cover):**

1. **Review submission** — Sign in → navigate to `/review/new` → select building via address autocomplete (or enter direct building ID) → fill 27-item form with valid scores → submit → redirected to building profile → review appears with correct scores
2. **Admin: review moderation** — Sign in as admin → go to `/admin/reviews` → approve a pending review → verify status changes → verify audit log entry created
3. **Admin: dispute resolution** — Sign in as admin → go to `/admin/disputes` → view dispute detail → mark as resolved → verify status updates
4. **Auth: signup + email verification** — Sign up with email → receive verification link (use test token inserted directly into D1 for local runs) → follow link → account marked verified → can submit reviews
5. **Auth: password reset** — Request reset for existing email → receive email (or use inserted token) → follow reset link → set new password → sign in with new password

**High priority:**

6. **Landlord dispute filing** — Unauthenticated user (or any user) → navigate to building profile → find a review → click "Dispute this review" → fill dispute form with valid reasons → submit → 200 response → dispute appears in admin queue
7. **Building profile rendering at scale** — Load building profile seeded with 20+ reviews → verify aggregate score displays correctly → verify all review cards render → no layout overflow on mobile
8. **Admin: building verification** — Admin marks building as verified → building profile shows verified badge (if applicable)

**Medium priority:**

9. **Search and discovery** — Search by address fragment → results appear → click building → profile loads correctly
10. **Profile page: user's own reviews** — Sign in → navigate to `/profile` → own submitted reviews are listed → edit review works (if edit is supported)

---

## Data Volumes That Reveal Real Issues

These numbers are calibrated for a pre-launch QA milestone — enough to surface real bugs, not so large they slow down local D1.

| Entity | Minimum Volume | What It Tests |
|--------|---------------|---------------|
| Buildings | 20-30 | Search pagination, admin buildings table with multiple rows, profile page rendering |
| Landlords | 10-15 | Landlord profile page, aggregate multi-building scoring |
| Reviews | 50-100 | Score aggregation accuracy, admin reviews table pagination, recency weighting with mixed years |
| Users | 10-15 | Admin users table, one-review-per-user policy testing, rate limit testing per IP |
| Disputes | 5-10 | Admin disputes queue, uniqueness constraint, resolution workflow |
| Audit log entries | 20-30 | Audit log pagination, viewer rendering, search/filter (if any) |

**Distribution guidance for reviews:**
- At least one building should have 20+ reviews (stress-tests aggregation and layout)
- At least one building should have 0 reviews (tests empty state)
- Reviews should span score range 1-5 with realistic distribution (not all 5s)
- Reviews should include both current tenants and former tenants (tests `is_current_tenant` branch)
- At least one review should have a long `review_text` (near 5000 chars) and at least one should have `NULL` text
- Mix `move_in_year` across 2019-2025 to exercise recency weighting
- Include reviews with `would_recommend_new` = 'yes', 'no', and 'maybe'

---

## MVP Recommendation

For a pre-launch milestone, prioritize in this order:

**Phase 1: Foundation (blockers for everything else)**
1. Seed script with realistic data at target volumes
2. Playwright storageState setup for regular user + admin sessions
3. Authenticated E2E: review submission (the core user flow)
4. Authenticated E2E: admin moderation (approve, reject reviews)

**Phase 2: Coverage expansion**
5. Auth flow E2E: signup, verification, password reset
6. Dispute flow E2E: filing and admin resolution
7. Security spot-checks: auth bypass, admin access control, SQL injection probe, XSS probe
8. Edge case: form boundary values through the HTTP stack

**Phase 3: Stress and polish**
9. UI stress: building profile at volume (20+ reviews)
10. UI stress: empty states across all pages
11. Responsive layout: admin tables with many rows at mobile viewport
12. Concurrent submission test: duplicate prevention

**Defer entirely:**
- Visual regression snapshots
- Chaos testing / fault injection
- Load testing / performance benchmarking
- CI/CD pipeline

---

## Implementation Notes

**Seed script approach:** Use `wrangler d1 execute ratemyplace-db --local --file=scripts/seed.sql` for local runs. Write a separate TypeScript generator (similar to existing `scripts/smoke-test.ts` pattern) that outputs SQL `INSERT` statements. This keeps the seed portable and reviewable. Passwords in seed users must use the same bcrypt/argon2 hash the app uses — generate via the app's own password hashing function, not hardcoded strings. Session tokens for storageState can bypass this by inserting directly into the `sessions` table with a known session ID.

**Playwright auth setup:** Use a `playwright/global-setup.ts` that performs UI login once per role and saves `storageState` to `playwright/.auth/user.json` and `playwright/.auth/admin.json`. Add these to `.gitignore`. Individual test files declare which role they need via `test.use({ storageState: ... })`. This is the official Playwright recommendation and avoids the 5-15s login penalty per test.

**Cloudflare Workers Vitest integration:** The `@cloudflare/vitest-pool-workers` package runs Vitest inside the Workers runtime with real D1 bindings. This is ideal for integration tests of API route handlers. However, the existing unit tests run in Node/happy-dom via standard Vitest — mixing both pools requires separate config files. For this milestone, it is not necessary to migrate unit tests; new API-level integration tests can use a separate `vitest.workers.config.ts` if needed. This is medium-complexity and should be deferred unless a specific API behavior cannot be tested otherwise.

**D1 + SQLite constraint:** D1 has no cross-request transactions. The UNIQUE constraint on `disputes.review_id` is enforced at the DB level, so a concurrent duplicate dispute submission may result in a 500 rather than a clean 409 — this is worth verifying and documenting as a known behavior if not worth fixing.

---

## Sources

- [Playwright Authentication Docs](https://playwright.dev/docs/auth) — storageState, global setup, multi-role patterns (HIGH confidence, official)
- [Cloudflare Workers Vitest Integration](https://developers.cloudflare.com/workers/testing/vitest-integration/) — @cloudflare/vitest-pool-workers, Workers runtime testing (HIGH confidence, official)
- [Cloudflare D1 Local Development](https://developers.cloudflare.com/d1/best-practices/local-development/) — wrangler d1 execute --local --file seeding pattern (HIGH confidence, official)
- [OWASP Top 10:2025 A05 Injection](https://owasp.org/Top10/2025/A05_2025-Injection/) — Injection testing methodology (HIGH confidence, official)
- [D1 SQLite: Schema, Migrations and Seeds - This Dot Labs](https://www.thisdot.co/blog/d1-sqlite-schema-migrations-and-seeds) — Practical D1 seeding patterns (MEDIUM confidence, verified against official D1 docs)
- Existing codebase inspection: `e2e/`, `src/lib/__tests__/`, `scripts/smoke-test.ts`, `package.json` — direct evidence of current test infrastructure (HIGH confidence, direct observation)
