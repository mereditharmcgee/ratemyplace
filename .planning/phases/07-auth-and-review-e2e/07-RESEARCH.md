# Phase 7: Auth and Review E2E - Research

**Researched:** 2026-02-28
**Domain:** Playwright E2E testing — auth flows, multi-step review form, concurrent submissions
**Confidence:** HIGH (all findings based on direct codebase inspection + existing Playwright infrastructure)

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Test user strategy**
- Signup test uses a unique timestamped email per run (e.g., `signup-1709123456@test.local`) — not a fixed email
- Signin/signout tests use seed users (`user@test.ratemyplace.local`) with known password — independent of signup test
- Review submission tests use the `authedPage` fixture (pre-authenticated seed user) — focuses test on the form, not re-testing auth
- Review submission targets a specific seed building (building-30 has 0 reviews in seed data) for deterministic assertions
- Password reset test uses a seed user — independent of signup test

**Review form testing depth**
- Happy-path test fills ALL fields (required + optional) and submits — proves the form handles everything
- Validation tests focus on required fields only — Claude's discretion on specific fields to test and approach
- Test step transitions: verify Next/Back buttons work, step indicators update, and data persists when navigating between steps
- After submission, Claude decides what to verify (success message, building page, or both)

**Password reset approach**
- Read reset token from local D1 via wrangler CLI: `npx wrangler d1 execute ratemyplace-db --local --command "SELECT token FROM password_resets..."`
- Full round-trip verification: request reset -> get token from D1 -> set new password -> sign in with new password
- Uses a seed user, not the freshly signed-up user

**Failure and edge cases**
- Concurrent duplicate review: two authenticated browser contexts, same building, submit near-simultaneously — verify at least one succeeds, no 500 errors
- Validation assertions: check that a specific error message appears near the invalid field (proves UI communicates the problem)
- Auth error states included: wrong password shows error, duplicate email on signup shows error, expired/invalid reset token shows error
- Boundary values: test scores at min (1) and max (5) boundaries only — mid-range covered by happy path

### Claude's Discretion
- Exact review form field selection for validation tests (representative samples vs. comprehensive)
- What to verify after review submission (success message, building page appearance, or both)
- Test file organization within e2e/ (one file per auth flow vs. grouped)
- Specific selectors and wait strategies for form interactions
- How to handle email verification in signup flow (may need D1 token read similar to password reset)

### Deferred Ideas (OUT OF SCOPE)

None — discussion stayed within phase scope
</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| E2E-01 | User can sign up with email/password through the full form flow | Signup form at `/auth/signup`, JS submits to `/api/auth/signup`, success redirects to `/` via `window.location.href = '/'` |
| E2E-02 | User can sign in, and sign out successfully | Signin at `/auth/signin`, JS submits to `/api/auth/signin`; signout is a `<form action="/api/auth/signout" method="POST">` button in Header.astro — must use Playwright `click()` on the submit button |
| E2E-03 | User can submit a complete 27-field review through the multi-step form | ReviewForm.tsx has 7 steps (address, unit-details, unit-rating, building-rating, landlord-rating, additional, confirm); building-30 (`45-melnea-cass-blvd` slug) is the target — navigate to `/review/new?building=building-30` to skip address step |
| E2E-04 | Review form validates required fields and rejects invalid input | API at `/api/reviews` returns 400 on missing `building_id`; client-side: signup form validates passwords client-side before submit, review form has no explicit client-side required-field blocking before API call |
| E2E-05 | User can request and complete password reset flow | Table is `password_reset_tokens` (not `password_resets`), column is `token`; reset page at `/auth/reset-password?token=TOKEN`; wrangler CLI pattern confirmed |
| E2E-06 | Concurrent duplicate review submissions are handled gracefully | D1 SQLite does not enforce one-review-per-user-per-building at DB level; concurrency test needs `Promise.all()` with two browser contexts; graceful = no 500, not necessarily a rejection |
</phase_requirements>

---

## Summary

Phase 7 writes E2E specs for all auth flows and the core review submission flow using the Playwright infrastructure established in Phase 6. All tooling is already in place: `@playwright/test` 1.58.2, `e2e/fixtures.ts` with `authedPage`/`adminPage` fixtures, `global.setup.ts` for session setup, and `playwright.config.ts` running against `http://localhost:8788`.

The auth flows are straightforward form interactions. Signup posts JSON via `fetch` to `/api/auth/signup` and redirects with `window.location.href = '/'` on success. Signin follows the same pattern. Signout is a native HTML form POST (not JavaScript) — `<form action="/api/auth/signout" method="POST">` — so Playwright must click the submit button inside that form rather than navigate directly. The password reset flow uses the `password_reset_tokens` table (confirmed from `tokens.ts`).

The review form is the most complex target. `ReviewForm.tsx` has 7 steps driven by React state: address, unit-details, unit-rating, building-rating, landlord-rating, additional, confirm. There are 27 survey fields across 3 rating steps (10 unit, 9 building, 8 landlord). Rating buttons are `<button type="button">` with text content `1`–`5`. The form can be entered at the `unit-details` step by navigating to `/review/new?building=building-30`, bypassing Google Maps autocomplete entirely. After submission, the API redirects to `/building/45-melnea-cass-blvd?submitted=true`.

**Primary recommendation:** Use `?building=building-30` query param to skip the address step for all review tests; read D1 tokens via wrangler CLI for password reset; use two browser contexts for the concurrent duplicate test.

---

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| @playwright/test | 1.58.2 | E2E test runner | Already installed, configured in playwright.config.ts |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| Node child_process / execSync | Node built-in | Run wrangler CLI to read D1 tokens | Password reset token extraction |
| @playwright/test browser.newContext() | 1.58.2 | Create isolated browser contexts | Concurrent duplicate review test (E2E-06) |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Wrangler CLI for token reads | Test API endpoint | Wrangler approach keeps tests infrastructure-free; no new API endpoint to build |
| Single context for concurrency | Two contexts | Two contexts simulate distinct users more accurately |

**Installation:** No new packages required.

---

## Architecture Patterns

### Recommended Project Structure

```
e2e/
├── fixtures.ts          # Existing — authedPage, adminPage fixtures
├── global.setup.ts      # Existing — creates user.json, admin.json auth files
├── navigation.spec.ts   # Existing Phase 6 test
├── pages.spec.ts        # Existing Phase 6 test
├── auth.spec.ts         # NEW — E2E-01, E2E-02, E2E-05 (signup, signin/signout, password reset)
├── review.spec.ts       # NEW — E2E-03, E2E-04, E2E-06 (happy path, validation, concurrent)
```

Two new spec files: `auth.spec.ts` covers all auth flows; `review.spec.ts` covers the review submission. This matches the existing pattern (one file per concern).

### Pattern 1: Import from fixtures, not @playwright/test

All existing specs use `import { test, expect } from './fixtures'`. New specs must follow the same convention.

```typescript
// Source: e2e/navigation.spec.ts, e2e/pages.spec.ts
import { test, expect } from './fixtures';
```

### Pattern 2: ESM-compatible __dirname

The project uses `"type": "module"` so `__dirname` is unavailable. Any file that needs paths must use:

```typescript
// Source: e2e/fixtures.ts, e2e/global.setup.ts
import { fileURLToPath } from 'url';
import path from 'path';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
```

### Pattern 3: Sign-in waits for URL change

The signin JS does `window.location.href = '/'` on success, so the wait pattern is:

```typescript
// Source: e2e/global.setup.ts
await page.goto('/auth/signin');
await page.fill('input[name="email"]', email);
await page.fill('input[name="password"]', password);
await page.click('button[type="submit"]');
await page.waitForURL('/');
```

### Pattern 4: Signout via form button click

Signout is a native HTML form POST inside Header.astro — NOT a link. The pattern is:

```typescript
// Signout form in src/components/layout/Header.astro line 40-47
// Desktop: form > button[type="submit"] with text "Sign Out"
await page.locator('form[action="/api/auth/signout"] button[type="submit"]').first().click();
await page.waitForURL('/');
// Verify session cleared: no "Sign Out" button, "Sign In" link visible
await expect(page.locator('header a[href="/auth/signin"]').first()).toBeVisible();
```

### Pattern 5: Review form — skip address step via query param

When `?building=building-30` is provided, `ReviewForm.tsx` starts at `unit-details` step, skipping Google Maps autocomplete:

```typescript
// Source: ReviewForm.tsx line 24
const [step, setStep] = useState<Step>(building ? 'unit-details' : 'address');
// Source: review/new.astro lines 11-21
const buildingId = Astro.url.searchParams.get('building');
// building is fetched from DB and passed to ReviewForm
await authedPage.goto('/review/new?building=building-30');
// First visible step is "Unit Details", not "Address"
```

### Pattern 6: Rating buttons — select by text content within step

Rating buttons are `<button type="button">` with numeric text. Since the same numbers appear across all 3 rating steps, scope to the visible step container or use the survey item's dimension label for uniqueness:

```typescript
// Source: RatingItem.tsx lines 26-43
// Each item renders buttons 1-5 with no data-* attributes
// Use locator chaining: find the item by dimension text, then click the rating button
await page.locator('text=Structural Integrity').locator('..').locator('..').locator('button', { hasText: '4' }).click();
// Simpler approach: click any "4" button visible in the step — ratings are not order-sensitive
// For happy path, iterate through all items and click a consistent score
```

**Simpler alternative for happy path:** Since all rating steps have buttons 1-5 and all fields are optional from the API perspective (only `building_id` is strictly required server-side), click the first available rating button for each item programmatically or use the `getByRole` approach:

```typescript
// Click score 4 on all visible rating buttons in the current step
const ratingButtons = page.locator('button[type="button"]').filter({ hasText: /^4$/ });
// This selects all "4" buttons in the current step — use count() to verify
```

### Pattern 7: Concurrent submission test with two contexts

```typescript
// Source: e2e/fixtures.ts — authedPage uses USER_AUTH_FILE storageState
// For concurrent test, create two contexts from the same auth file
const USER_AUTH_FILE = path.join(__dirname, '../playwright/.auth/user.json');

test('concurrent duplicate reviews handled gracefully', async ({ browser }) => {
  const [ctx1, ctx2] = await Promise.all([
    browser.newContext({ storageState: USER_AUTH_FILE }),
    browser.newContext({ storageState: USER_AUTH_FILE }),
  ]);
  const [page1, page2] = await Promise.all([ctx1.newPage(), ctx2.newPage()]);
  // Navigate both to the same review page, fill, submit simultaneously
  await Promise.all([
    submitReview(page1, 'building-30'),
    submitReview(page2, 'building-30'),
  ]);
  // Verify: at least one succeeded (no 500), no unhandled error in either page
});
```

### Pattern 8: Wrangler CLI for D1 token reads

The password reset token is stored in `password_reset_tokens` table with column `token`. The wrangler command is:

```typescript
import { execSync } from 'child_process';

function getPasswordResetToken(userEmail: string): string {
  const result = execSync(
    `npx wrangler d1 execute ratemyplace-db --local --command "SELECT pr.token FROM password_reset_tokens pr JOIN users u ON pr.user_id = u.id WHERE u.email = '${userEmail}' ORDER BY pr.expires_at DESC LIMIT 1"`,
    { encoding: 'utf8', cwd: process.cwd() }
  );
  // Parse wrangler JSON output — wrangler outputs a JSON array of result objects
  const parsed = JSON.parse(result);
  return parsed[0].results[0].token;
}
```

**CRITICAL:** The table name is `password_reset_tokens` (confirmed from `tokens.ts` lines 160, 169), not `password_resets`. The column is `token`.

### Pattern 9: Signup — email verification flow

After signup, `/api/auth/signup` calls `createVerificationToken()` and `sendVerificationEmail()`. The signup flow itself does NOT require email verification to succeed — it creates a session and returns `{ success: true }` regardless of whether the email sending worked (lines 106-114 in signup.ts). The client then does `window.location.href = '/'`.

**Therefore:** The signup test does NOT need to handle email verification. It only needs to:
1. Fill email, password, confirmPassword
2. Click submit
3. Assert `waitForURL('/')` succeeds
4. Assert some "signed in" state (e.g., Sign Out button appears)

For **duplicate email** error state: the error div is `#error-message` (initially hidden via `class="hidden"`). The error text comes from `result.error` in the fetch response.

### Anti-Patterns to Avoid

- **Using `page.goto('/api/auth/signout')` directly:** Signout is POST-only, GET returns nothing useful. Use the form button click.
- **Hardcoded timestamped email:** Generate at test runtime with `Date.now()` not at module level.
- **Querying D1 with the wrong table name:** The table is `password_reset_tokens`, not `password_resets`.
- **Clicking rating buttons by position:** The step navigation renders/unmounts React components — wait for step to be active before clicking.
- **Forgetting to check the privacy acknowledgment checkbox on ConfirmStep:** The Submit button is `disabled` until `privacyAcknowledged` is true (ConfirmStep.tsx line 137). Must check the checkbox before clicking Submit.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Auth state in tests | Manual cookie injection | `storageState` from fixture | Already implemented in fixtures.ts |
| D1 token reads | HTTP endpoint | `execSync('npx wrangler d1 ...')` | Infrastructure-free, consistent with project pattern from CONTEXT.md |
| Step-by-step form fill | Complex page objects | Sequential `page.click()` / `page.fill()` in-test | Form state is pure React, no complex DOM manipulation needed |

---

## Common Pitfalls

### Pitfall 1: Forgot Privacy Checkbox Blocks Submission

**What goes wrong:** Test clicks "Submit Review" and nothing happens — no network request, no error.
**Why it happens:** `ConfirmStep.tsx` line 137: `disabled={loading || !privacyAcknowledged}`. The checkbox must be checked first.
**How to avoid:** Before clicking Submit, check the privacy checkbox: `await page.locator('input[type="checkbox"]').check()`.
**Warning signs:** Submit button has `disabled` attribute in DOM.

### Pitfall 2: Rating Buttons Have No data-* Attributes

**What goes wrong:** `page.locator('[data-score="4"]')` returns nothing.
**Why it happens:** `RatingItem.tsx` renders plain `<button type="button">` with text `{rating}`. No data attributes, no aria-labels for individual buttons.
**How to avoid:** Use `page.locator('button', { hasText: /^4$/ })` scoped within the step container. Or click the nth button: all rating steps render the same structure, so nth-match patterns work.
**Warning signs:** Zero locator matches.

### Pitfall 3: React Hydration — Form Is Client-Side

**What goes wrong:** Clicking rating buttons immediately after `goto('/review/new?building=building-30')` fails because React hasn't mounted yet.
**Why it happens:** `ReviewForm` uses `client:load` directive in `new.astro`. The page SSRs first, then React hydrates client-side.
**How to avoid:** Wait for a visible React element before interacting: `await page.locator('text=Unit Details').first().waitFor()` or use `await page.waitForLoadState('networkidle')` if needed.
**Warning signs:** `TimeoutError` clicking elements that appear immediately in the DOM but aren't interactive.

### Pitfall 4: Sign-in Error Uses `#error-message` div (Initially Hidden)

**What goes wrong:** Test asserts `expect(page.locator('#error-message')).toBeVisible()` for wrong-password scenario — this passes even when hidden because the element exists.
**Why it happens:** The error div always exists in the DOM with `class="hidden"`. JS removes the hidden class on error.
**How to avoid:** Use `toBeVisible()` — Playwright checks visibility (display, opacity, etc.) correctly. The `hidden` class applies `display: none` via Tailwind, which Playwright treats as not visible.

### Pitfall 5: Concurrent Test — Same User, One Session File

**What goes wrong:** Two contexts share the same storageState file. If one context invalidates the session (e.g., signout), the other context breaks.
**Why it happens:** storageState is read at context creation time, so as long as neither context signs out, the session remains valid in both.
**How to avoid:** Only submit reviews in the concurrent test, do not sign out. The server creates a new session for each request using the cookie, not per-context state.

### Pitfall 6: Password Reset — Wrangler Output Format

**What goes wrong:** `JSON.parse(result)` fails or returns unexpected structure.
**Why it happens:** Wrangler CLI output format varies by version (1.x vs 3.x vs 4.x). With wrangler 4.x, `--command` output is a JSON array.
**How to avoid:** Log the raw output first in a diagnostic step, then parse. Add a fallback: `const rows = parsed[0]?.results ?? parsed?.results ?? []`.

### Pitfall 7: Password Minimum Length Mismatch

**What goes wrong:** Password reset requires 8 characters minimum (reset-password.ts line 24), but signup only requires 6 (signup.ts line 31). A 6-char password accepted at signup would fail at password reset.
**How to avoid:** Use `TestPassword123!` (15 chars) for all test passwords, satisfying both minimums.

### Pitfall 8: Review Submission Target — Building-30 Needs Slug Verification

**What goes wrong:** After review submission, the test asserts navigation to `/building/45-melnea-cass-blvd?submitted=true` but the URL doesn't match.
**Why it happens:** The `handleSubmit` function in `ReviewForm.tsx` line 184 redirects to `/building/${result.buildingSlug}?submitted=true`. The slug for building-30 is `45-melnea-cass-blvd` (confirmed from db-seed.ts line 796).
**How to avoid:** Assert `await page.waitForURL(/\/building\/45-melnea-cass-blvd/)` after submit.

---

## Code Examples

### Signup Test Pattern

```typescript
// Source: Direct inspection of src/pages/auth/signup.astro and src/pages/api/auth/signup.ts
test('user can sign up with email and password', async ({ page }) => {
  const email = `signup-${Date.now()}@test.local`;
  await page.goto('/auth/signup');
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', 'TestPassword123!');
  await page.fill('input[name="confirmPassword"]', 'TestPassword123!');
  await page.click('button[type="submit"]');
  await page.waitForURL('/');
  // Sign Out button visible confirms session was created
  await expect(page.locator('form[action="/api/auth/signout"]').first()).toBeVisible();
});
```

### Signout Test Pattern

```typescript
// Source: src/components/layout/Header.astro lines 40-47
test('user can sign out', async ({ authedPage }) => {
  await authedPage.goto('/');
  await authedPage.locator('form[action="/api/auth/signout"] button[type="submit"]').first().click();
  await authedPage.waitForURL('/');
  // Session cleared: Sign In link reappears
  await expect(authedPage.locator('header a[href="/auth/signin"]').first()).toBeVisible();
});
```

### Review Form — Skip Address Step

```typescript
// Source: src/pages/review/new.astro lines 11-21 + ReviewForm.tsx line 24
// Building-30 slug: '45-melnea-cass-blvd' (db-seed.ts line 796)
await authedPage.goto('/review/new?building=building-30');
await authedPage.waitForLoadState('networkidle');
// Verify we're on unit-details step (address step skipped)
await expect(authedPage.locator('text=Unit Details').first()).toBeVisible();
```

### Rating Step Interaction

```typescript
// Source: RatingItem.tsx — buttons are plain <button type="button"> with text 1-5
// Click score 4 on all required unit items (10 items × 1 click each)
// Pattern: click ALL visible buttons with text "4" in the current step
const allFourButtons = authedPage.locator('button[type="button"]', { hasText: /^4$/ });
const count = await allFourButtons.count();
for (let i = 0; i < count; i++) {
  await allFourButtons.nth(i).click();
}
```

### Privacy Checkbox + Submit

```typescript
// Source: ConfirmStep.tsx lines 56-76, 137
// Must check privacy checkbox BEFORE clicking Submit
await authedPage.locator('input[type="checkbox"]').check();
await expect(authedPage.locator('button', { hasText: 'Submit Review' })).toBeEnabled();
await authedPage.locator('button', { hasText: 'Submit Review' }).click();
await authedPage.waitForURL(/\/building\/45-melnea-cass-blvd/);
```

### Password Reset Token Extraction

```typescript
// Source: src/lib/tokens.ts — table: password_reset_tokens, column: token
import { execSync } from 'child_process';

function getPasswordResetToken(email: string): string {
  const raw = execSync(
    `npx wrangler d1 execute ratemyplace-db --local --command "SELECT pr.token FROM password_reset_tokens pr JOIN users u ON pr.user_id = u.id WHERE u.email = '${email}' ORDER BY pr.expires_at DESC LIMIT 1"`,
    { encoding: 'utf8', cwd: process.cwd() }
  );
  const parsed = JSON.parse(raw);
  // Wrangler 4.x output: array of query result objects
  const rows = parsed[0]?.results ?? parsed?.results ?? [];
  if (!rows.length) throw new Error('No password reset token found for ' + email);
  return rows[0].token;
}
```

### Concurrent Review Submission

```typescript
// Source: e2e/fixtures.ts — USER_AUTH_FILE path pattern
import path from 'path';
import { fileURLToPath } from 'url';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const USER_AUTH_FILE = path.join(__dirname, '../playwright/.auth/user.json');

test('concurrent duplicate reviews handled gracefully', async ({ browser }) => {
  const [ctx1, ctx2] = await Promise.all([
    browser.newContext({ storageState: USER_AUTH_FILE }),
    browser.newContext({ storageState: USER_AUTH_FILE }),
  ]);
  const [p1, p2] = [await ctx1.newPage(), await ctx2.newPage()];

  // Fill both reviews (not yet submitted)
  await fillReview(p1);
  await fillReview(p2);

  // Submit simultaneously
  const [r1, r2] = await Promise.all([
    p1.locator('button', { hasText: 'Submit Review' }).click().then(() =>
      p1.waitForURL(/\/building\/45-melnea-cass-blvd|\/review\/new/).catch(() => null)
    ),
    p2.locator('button', { hasText: 'Submit Review' }).click().then(() =>
      p2.waitForURL(/\/building\/45-melnea-cass-blvd|\/review\/new/).catch(() => null)
    ),
  ]);

  // Neither page should show a 500 error
  const body1 = await p1.textContent('body');
  const body2 = await p2.textContent('body');
  expect(body1).not.toContain('Internal Server Error');
  expect(body2).not.toContain('Internal Server Error');

  await ctx1.close();
  await ctx2.close();
});
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Phase 6 existing specs: `page` fixture (unauthenticated) | Phase 7 review specs: `authedPage` fixture (pre-authed seed user) | Phase 6 established fixture | Enables focused form testing without auth re-testing |
| Full address step with Google Maps | `?building=building-30` query param | Existing app feature (new.astro lines 11-21) | Bypasses autocomplete entirely — no Google API calls in tests |

---

## Open Questions

1. **Email verification — does signup land on `/` immediately or on a "verify email" page?**
   - What we know: `signup.ts` calls `createVerificationToken()` and `sendVerificationEmail()` then creates a session regardless of email result. JS does `window.location.href = '/'` on `response.ok`.
   - What's unclear: Whether there is a separate "please verify your email" interstitial — nothing in `signup.astro` shows one, and the client-side JS redirects to `/` immediately. Session is valid before verification.
   - Recommendation: Test assumes redirect to `/` (no interstitial). If test fails at `waitForURL('/')`, there may be a middleware check for `email_verified`. Check `src/middleware.ts` if this issue arises.

2. **Does the review form have client-side required-field enforcement that would prevent "missing required fields" testing via UI?**
   - What we know: `RatingStep.tsx` has a Continue button with `onClick={() => setStep(...)}` — no validation before advancing. `ConfirmStep.tsx` Submit button is only blocked by `privacyAcknowledged`, not by missing scores.
   - What's unclear: Whether the API at `/api/reviews` returns a useful error for missing score fields, or just accepts nulls (which it does — `scores[field] = value ? parseInt(value) : null`).
   - Recommendation: Validation testing for the review form should focus on auth validation (submit without session = 401) and the `building_id` missing check (400). The "missing scores" case may not produce a user-visible error from the API. For E2E-04, test signup and signin error states instead (those have clear error messages).

3. **Wrangler output format for `--command` flag with local D1**
   - What we know: Project STATE.md confirms wrangler 4.50 is in use. Pattern used successfully in Phase 4/5 for migrations.
   - What's unclear: Exact JSON output structure for `SELECT` queries via `--command`.
   - Recommendation: Write a diagnostic helper that logs raw output first, or test the wrangler command manually before embedding in the spec. If JSON parse fails, try `--json` flag or check wrangler 4.x docs.

---

## Validation Architecture

> `workflow.nyquist_validation` is not set in `.planning/config.json` — this section is omitted per instructions.

---

## Key Selectors Reference

Based on actual HTML/TSX source:

| Element | Selector |
|---------|----------|
| Signup email input | `input[name="email"]` |
| Signup password input | `input[name="password"]` |
| Signup confirm password | `input[name="confirmPassword"]` |
| Signup submit | `button[type="submit"]` |
| Signup error div | `#error-message` |
| Signin email | `input[name="email"]` |
| Signin password | `input[name="password"]` |
| Signin submit | `button[type="submit"]` |
| Signout button | `form[action="/api/auth/signout"] button[type="submit"]` |
| Forgot password email | `input[name="email"]` (on `/auth/forgot-password`) |
| Forgot password submit | `button[type="submit"]` |
| Forgot password success | `#success-message` |
| Reset password new password | `input[name="password"]` (on `/auth/reset-password?token=...`) |
| Reset password confirm | `input[name="confirmPassword"]` |
| Reset password success container | `#success-container` |
| Review form step indicator | Numbers 1-7 in `div.rounded-full` |
| Review rating buttons | `button[type="button"]` with text `1`, `2`, `3`, `4`, `5` |
| Review privacy checkbox | `input[type="checkbox"]` (on confirm step) |
| Review submit button | `button` with text `Submit Review` |
| Review error (on confirm step) | `div.bg-red-50.border-red-200` |
| Post-submit URL | `/building/45-melnea-cass-blvd?submitted=true` |

---

## Sources

### Primary (HIGH confidence)
- `e2e/fixtures.ts` — authedPage, adminPage fixture implementation
- `e2e/global.setup.ts` — existing sign-in pattern with waitForURL
- `playwright.config.ts` — Playwright 1.58.2, baseURL http://localhost:8788, workers: 1
- `src/pages/auth/signup.astro` — form field names, error div ID, JS submit + redirect
- `src/pages/auth/signin.astro` — form field names, error div ID, JS submit + redirect
- `src/pages/auth/forgot-password.astro` — form field, success/error divs
- `src/pages/auth/reset-password.astro` — token query param, form fields, success container
- `src/pages/api/auth/signup.ts` — API behavior, error messages, email non-blocking
- `src/pages/api/auth/signin.ts` — API behavior, error messages
- `src/pages/api/auth/signout.ts` — POST-only, redirects to /
- `src/pages/api/auth/forgot-password.ts` — always returns success (user enumeration prevention)
- `src/pages/api/auth/reset-password.ts` — token validation, 8-char minimum
- `src/pages/api/reviews.ts` — building_id required, all scores optional (null-ok), redirects to slug
- `src/components/layout/Header.astro` — signout form selector
- `src/components/reviews/ReviewForm.tsx` — step flow, building query param, handleSubmit URL
- `src/components/reviews/form-steps/RatingItem.tsx` — button selectors, no data attributes
- `src/components/reviews/form-steps/ConfirmStep.tsx` — privacy checkbox, disabled submit
- `src/components/reviews/form-steps/types.ts` — Step type, STEPS array (7 steps)
- `src/lib/surveyItems.ts` — 27 fields: 10 unit, 9 building, 8 landlord
- `src/lib/tokens.ts` — table name `password_reset_tokens`, column `token`
- `scripts/db-seed.ts` — building-30 id, slug `45-melnea-cass-blvd`, 0 reviews confirmed
- `package.json` — @playwright/test 1.58.2, e2e script command

### Secondary (MEDIUM confidence)
- `.planning/STATE.md` — wrangler 4.50 in use, workers: 1 confirmed decision

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — no new packages, existing infrastructure confirmed
- Architecture: HIGH — all selectors and flow verified from source files
- Pitfalls: HIGH — identified from actual code patterns (no speculative pitfalls)

**Research date:** 2026-02-28
**Valid until:** 2026-03-28 (stable — no fast-moving dependencies)
