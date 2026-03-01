# Phase 8: Admin and Disputes E2E - Research

**Researched:** 2026-02-28
**Domain:** Playwright E2E testing — admin moderation, dispute submission, dispute resolution, audit logging, all 9 admin pages
**Confidence:** HIGH (all findings based on direct codebase inspection of admin pages, components, API routes, and Phase 6/7 Playwright infrastructure)

---

<user_constraints>
## User Constraints (from CONTEXT.md)

None explicitly provided for Phase 8. All design decisions are Claude's discretion based on the existing Phase 7 patterns and codebase conventions.
</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| E2E-07 | Admin can approve and reject pending reviews from the moderation queue | ReviewsTable.tsx at `/admin/reviews`; status update via `PATCH /api/admin/reviews/:id`; all seed reviews start `approved` — must "Reset to Pending" first |
| E2E-08 | Landlord can submit a dispute through the public /dispute form | `src/pages/dispute.astro` renders `DisputeForm` (client:load); posts JSON to `POST /api/disputes`; extracts review ID from URL hash pattern `#review-{id}` |
| E2E-09 | Admin can view and resolve disputes with outcome and notes | DisputesQueue.tsx at `/admin/disputes`; PATCH `/api/disputes/:id` with `{resolutionOutcome, resolutionNotes}`; resolution form only shows for pending disputes |
| E2E-10 | Admin actions create verifiable audit log entries | `createAuditLog()` in `src/lib/audit.ts` called from review PATCH and dispute PATCH APIs; seed data does NOT pre-populate audit_logs; entries only exist after E2E test actions |
| E2E-11 | All 9 admin pages render correctly and are navigable | All 9 pages confirmed: `/admin`, `/admin/users`, `/admin/reviews`, `/admin/buildings`, `/admin/landlords`, `/admin/managers`, `/admin/verify`, `/admin/disputes`, `/admin/audit` |
</phase_requirements>

---

## Summary

Phase 8 writes E2E specs covering admin moderation, dispute submission/resolution, audit logging, and all 9 admin page renders. The Playwright infrastructure is fully established from Phase 6: `adminPage` fixture (authenticated admin session), `authedPage` fixture (regular user), `page` fixture (unauthenticated), baseURL `http://localhost:8788`, `workers: 1`.

**Two spec files planned:**
- `e2e/admin-pages.spec.ts` — E2E-11: all 9 admin pages render, navigation bar works, access control enforced
- `e2e/admin-actions.spec.ts` — E2E-07/08/09/10: review moderation, dispute submission, dispute resolution, audit log verification

**Critical discovery:** Seed data does NOT pre-populate the `audit_logs` table. Audit log entries only exist after E2E test actions (approve, reject, resolve) are performed. The audit log test must run AFTER the moderation tests, which is guaranteed by `workers: 1` sequential execution.

**Critical discovery:** All 100+ seed reviews are seeded with `status = 'approved'`. To test approve/reject flows, the spec must first click "Reset to Pending" on a review before the Approve or Reject button appears.

**Critical discovery:** The dispute form submits to `POST /api/disputes` which calls `extractReviewIdFromUrl()`. This function validates that the URL origin matches the site origin. In E2E tests, the origin is `http://localhost:8788`, so the review URL must use that origin: `http://localhost:8788/building/12-brighton-ave#review-review-001`.

**Critical discovery:** The dispute API has a UNIQUE constraint — if a dispute for `review-001` already exists in seed data, submitting another dispute for `review-001` will return 409. Seed data already has `dispute-01` pointing at `review-005` (not `review-001`), so `review-001` is safe to use for E2E testing without collision.

---

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| @playwright/test | 1.58.2 | E2E test runner | Already installed, configured in playwright.config.ts |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| e2e/fixtures.ts | Project | adminPage, authedPage, page fixtures | All admin tests |
| e2e/global.setup.ts | Project | Creates admin.json session | Dependency via setup project |

**Installation:** No new packages required.

---

## Architecture Patterns

### Recommended Project Structure

```
e2e/
├── fixtures.ts           # Existing — authedPage, adminPage fixtures
├── global.setup.ts       # Existing — creates user.json, admin.json auth files
├── navigation.spec.ts    # Existing Phase 6 test
├── pages.spec.ts         # Existing Phase 6 test
├── auth.spec.ts          # Phase 7 test
├── review.spec.ts        # Phase 7 test
├── admin-pages.spec.ts   # NEW — E2E-11 (all 9 admin pages render)
├── admin-actions.spec.ts # NEW — E2E-07, E2E-08, E2E-09, E2E-10
```

### Pattern 1: Import convention

All existing Phase 6/7 specs use `import { test, expect } from './fixtures'`. Admin specs must follow:

```typescript
import { test, expect } from './fixtures';
```

### Pattern 2: ESM-compatible __dirname (only if file path lookups needed)

```typescript
// Source: e2e/fixtures.ts, e2e/auth.spec.ts
import { fileURLToPath } from 'url';
import path from 'path';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
```

### Pattern 3: Admin session via adminPage fixture

The `adminPage` fixture (from `e2e/fixtures.ts`) creates a browser context with `admin.json` storageState. The admin user email is `admin@test.ratemyplace.local`, password `TestPassword123!`, `is_admin = 1`. This session is created by `global.setup.ts` during the `setup` project.

```typescript
// Source: e2e/fixtures.ts
export const test = base.extend<CustomFixtures>({
  adminPage: async ({ browser }, use) => {
    const context = await browser.newContext({ storageState: ADMIN_AUTH_FILE });
    const page = await context.newPage();
    await use(page);
    await context.close();
  },
});
```

### Pattern 4: Admin page navigation with React island wait

Eight of nine admin pages use React islands with `client:load`. The loading spinner is `div.animate-spin.rounded-full.h-8.w-8.border-b-2.border-teal-600`. Use `waitForLoadState('networkidle')` after navigation or wait for specific content to appear.

```typescript
// Navigate and wait for React component to mount and fetch data
await adminPage.goto('/admin/reviews');
await adminPage.waitForLoadState('networkidle');
// Now the ReviewsTable is fully loaded
```

### Pattern 5: Review card expand-and-act (E2E-07)

ReviewsTable renders review cards. Action buttons (Approve, Reject, etc.) only appear in the EXPANDED view. Click the header div (`.cursor-pointer`) to expand, then click the action button.

```typescript
// Click the first review card header to expand
await adminPage.locator('.cursor-pointer').first().click();
// Wait for expanded section with action buttons
await adminPage.locator('text=Reset to Pending').first().waitFor();
await adminPage.locator('button', { hasText: 'Reset to Pending' }).first().click();
// Wait for status badge to update to 'pending'
await adminPage.locator('span.rounded-full', { hasText: 'pending' }).first().waitFor();
// Now Approve button is visible
await adminPage.locator('button', { hasText: 'Approve' }).first().click();
// Wait for status badge to update to 'approved'
await expect(adminPage.locator('span.rounded-full').first()).toContainText('approved');
```

**Note:** Action buttons have `e.stopPropagation()` — clicking them won't collapse the card.

### Pattern 6: Dispute form submission (E2E-08)

`/dispute` page is public — use `page` fixture (unauthenticated). The form uses controlled React state, not native form fields. Fill via Playwright `fill()` targeting `id` attributes.

```typescript
// Source: DisputeForm.tsx — all inputs have id attributes
await page.goto('/dispute');
await page.fill('#reviewUrl', 'http://localhost:8788/building/12-brighton-ave#review-review-001');
await page.fill('#landlordName', 'E2E Test Landlord');
await page.fill('#landlordEmail', 'e2e-test-landlord@example.com');
await page.fill('#landlordPhone', '617-555-9999');
// Checkbox: id="reason-{reason_string}" — spaces in the ID
await page.getByLabel('Factually incorrect information').check();
await page.fill('#disputeExplanation', 'E2E test dispute.');
await page.locator('button[type="submit"]').click();
// Success: green container with "Dispute submitted successfully" h3 text
await expect(page.locator('text=Dispute submitted successfully')).toBeVisible();
```

**CRITICAL:** The dispute URL must have origin `http://localhost:8788`. The `extractReviewIdFromUrl()` function in `src/lib/disputes.ts` validates origin matches. Using `https://` or any other origin returns null and the API returns 400 "Invalid review URL".

**CRITICAL:** `review-001` is on `building-01` (slug `12-brighton-ave`). Seed disputes use `review-005`, `review-011`, etc. — NOT `review-001`. So submitting a dispute for `review-001` via `http://localhost:8788/building/12-brighton-ave#review-review-001` avoids the UNIQUE constraint 409 error.

### Pattern 7: Dispute resolution (E2E-09)

DisputesQueue starts with `statusFilter = 'pending'` by default. The 7 seed pending disputes will be visible. Click a dispute card header to expand, set the resolution form, click "Resolve Dispute".

```typescript
// Source: DisputesQueue.tsx
await adminPage.goto('/admin/disputes');
await adminPage.waitForLoadState('networkidle');
// Filter is already 'pending' by default — pending disputes visible
const firstDispute = adminPage.locator('.cursor-pointer').first();
await firstDispute.click();
// Resolution form appears for pending disputes
await adminPage.locator('h4', { hasText: 'Resolve Dispute' }).waitFor();
// Fill resolution notes (required — button disabled without notes)
await adminPage.locator('textarea[placeholder="Explain the resolution decision..."]').fill('E2E test resolution.');
// Outcome defaults to 'dismiss' — no change needed
await adminPage.locator('button', { hasText: 'Resolve Dispute' }).click();
// After resolution, status badge changes to 'resolved'
await expect(adminPage.locator('span.rounded-full', { hasText: 'resolved' }).first()).toBeVisible();
```

**Note:** The "Resolve Dispute" button is `disabled` when `resolutionForm.notes.trim()` is empty. Must fill notes before clicking.

**Note:** After successful resolution, `setExpandedDispute(null)` and `setResolutionForm(null)` are called — the card collapses. The resolved dispute will no longer appear in the pending filter view. To verify resolution, either switch to "All" filter or "Resolved" filter.

### Pattern 8: Audit log verification (E2E-10)

Seed data does NOT populate `audit_logs`. Entries only exist after admin actions performed in E2E tests. Because `workers: 1` runs tests sequentially, if the review moderation and dispute resolution tests run before the audit log test, entries will exist.

```typescript
// Source: AuditLogTable.tsx
// Table columns: Timestamp, Admin, Action, Entity, Details
await adminPage.goto('/admin/audit');
await adminPage.waitForLoadState('networkidle');
// Table always renders; 'No audit logs found.' shown only when empty
await expect(adminPage.locator('table thead')).toBeVisible();
// Verify at least one row exists
await expect(adminPage.locator('table tbody tr').first()).toBeVisible();
// Action badge shows formatActionType(action_type) — underscores to spaces, title case
// 'review_approved' → 'Review Approved', 'dispute_dismissed' → 'Dispute Dismissed'
await expect(adminPage.locator('table tbody tr').first()).toContainText('Review');

// Row expansion shows "From:" and "To:" labels
await adminPage.locator('table tbody tr').first().click();
await expect(adminPage.locator('text=From:').first()).toBeVisible();
```

**Note:** `formatActionType()` in `AuditLogTable.tsx` converts `review_approved` → `"Review Approved"` by replacing underscores with spaces and capitalizing each word.

---

## Admin Pages Reference (E2E-11)

Source: `src/components/admin/AdminLayout.astro` and individual page files.

| URL | Page File | h1 Text | React Component | Render Strategy |
|-----|-----------|---------|-----------------|-----------------|
| `/admin` | `admin/index.astro` | "Dashboard Overview" | None | SSR-only (data in frontmatter) |
| `/admin/users` | `admin/users.astro` | "User Management" | UsersTable client:load | Needs networkidle wait |
| `/admin/reviews` | `admin/reviews.astro` | "Review Management" | ReviewsTable client:load | Needs networkidle wait |
| `/admin/buildings` | `admin/buildings.astro` | "Building Management" | BuildingsTable client:load | Needs networkidle wait |
| `/admin/landlords` | `admin/landlords.astro` | "Landlord Management" | LandlordsTable client:load | Needs networkidle wait |
| `/admin/managers` | `admin/managers.astro` | "Property Manager Management" | ManagersTable client:load | Needs networkidle wait |
| `/admin/verify` | `admin/verify.astro` | "Verification Queue" | VerificationQueue client:load | Needs networkidle wait |
| `/admin/disputes` | `admin/disputes.astro` | "Dispute Queue" | DisputesQueue client:load | Needs networkidle wait |
| `/admin/audit` | `admin/audit.astro` | "Audit Log" | AuditLogTable client:load | Needs networkidle wait |

Navigation bar links are in `AdminLayout.astro` `navItems` array:
- `a[href="/admin"]` text "Dashboard"
- `a[href="/admin/users"]` text "Users"
- `a[href="/admin/reviews"]` text "Reviews"
- `a[href="/admin/buildings"]` text "Buildings"
- `a[href="/admin/landlords"]` text "Landlords"
- `a[href="/admin/managers"]` text "Managers"
- `a[href="/admin/verify"]` text "Verification"
- `a[href="/admin/disputes"]` text "Disputes"
- `a[href="/admin/audit"]` text "Audit Log"

Access control in `AdminLayout.astro`:
- `if (!user)` → `redirect('/auth/signin')`
- `if (!user.isAdmin)` → `redirect('/')`

Dashboard stats cards (SSR, not React): "Total Users", "Total Reviews", "Buildings", "Verifications" (each is a `<p class="text-sm font-medium text-gray-500">` label).

---

## API Reference

### PATCH /api/admin/reviews/:id (E2E-07)

Source: `src/pages/api/admin/reviews/[id].ts`

- Method: `PATCH`
- Auth: admin required (401/403 otherwise)
- Body: `{ status: 'pending' | 'approved' | 'rejected' | 'flagged', moderation_notes?: string }`
- Creates audit log entry: `action_type = 'review_approved'` / `'review_rejected'` / `'review_pending'` / `'review_flagged'`
- Returns: `{ success: true }` on success

ReviewsTable.tsx calls `PATCH /api/admin/reviews/${reviewId}` with `{ status: newStatus }`.

### POST /api/disputes (E2E-08)

Source: `src/pages/api/disputes.ts`

- Method: `POST`
- Auth: public (no auth required)
- Body: `{ reviewUrl, landlordName, landlordEmail, landlordPhone, disputeReasons, disputeExplanation? }`
- `reviewUrl` must use `http://localhost:8788` origin in tests (validated by `extractReviewIdFromUrl`)
- Supported URL patterns: `http://localhost:8788/building/{slug}#review-{reviewId}` or `http://localhost:8788/review/edit/{reviewId}`
- Returns: `{ success: true, disputeId }` with status 201

### PATCH /api/disputes/:id (E2E-09)

Source: `src/pages/api/disputes/[id].ts`

- Method: `PATCH`
- Auth: admin required
- Body: `{ resolutionOutcome: 'uphold' | 'dismiss' | 'partially_valid', resolutionNotes: string }`
- `resolutionNotes` is required and must be non-empty string
- Creates audit log: `action_type = 'dispute_upheld'` / `'dispute_dismissed'` / `'dispute_partially_valid'`
- Returns: `{ success: true }` with status 200

### GET /api/admin/audit (E2E-10)

Source: `src/pages/api/admin/audit.ts`

- Method: `GET`
- Auth: admin required
- Returns: `{ logs: AuditLogEntry[], total, page, pages, filters }`
- `logs[].action_type` values: `review_approved`, `review_rejected`, `review_pending`, `review_flagged`, `review_deleted`, `dispute_upheld`, `dispute_dismissed`, `dispute_partially_valid`
- AuditLogTable.tsx fetches from `GET /api/admin/audit?action=all&admin=all&page=1`

---

## Seed Data Reference

Source: `scripts/db-seed.ts`

### Reviews

- 100+ reviews, ALL seeded with `status = 'approved'`
- No pending reviews in seed — must "Reset to Pending" via UI to test approve/reject

Key reviews for testing:
- `review-001`: on `building-01` (slug `12-brighton-ave`), by `user-test-01`
- `review-005`: on `building-01`, by `user-07` — this is the review for `dispute-01`

### Disputes

- 7 pending: `dispute-01` through `dispute-07`
- 3 resolved: `dispute-08`, `dispute-09`, `dispute-10` (resolved by `user-admin-01`)
- `dispute-01`: `review_id='review-005'`, `landlord_name='John Smith'`
- NO dispute uses `review-001` — safe to submit E2E dispute against `review-001`

### Audit Logs

- NONE seeded — table starts empty
- Entries only created by E2E test admin actions
- Test ordering: review moderation tests → dispute resolution test → audit log test (guaranteed by workers: 1)

### Test Users

| Email | Password | is_admin |
|-------|----------|----------|
| `user@test.ratemyplace.local` | `TestPassword123!` | 0 |
| `admin@test.ratemyplace.local` | `TestPassword123!` | 1 |

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Admin auth in tests | Manual cookie injection or fresh signin | `adminPage` fixture | Already implemented in fixtures.ts |
| Dispute form submission | Direct API call | UI form fill and submit | E2E-08 requires UI flow proof |
| Pending review setup | Pre-seeding pending reviews | "Reset to Pending" button in UI | All seeds are approved; using the UI button proves the reset flow too |
| Audit log pre-population | Seed data modification | Run moderation tests first | workers=1 guarantees ordering; seed modification adds complexity |

---

## Common Pitfalls

### Pitfall 1: Dispute URL Origin Must Match localhost:8788

**What goes wrong:** Submitting `https://ratemyplace.org/building/12-brighton-ave#review-review-001` returns 400 "Invalid review URL".
**Why it happens:** `extractReviewIdFromUrl()` in `src/lib/disputes.ts` validates `url.origin !== expectedOrigin`. The API derives `siteUrl` from `new URL(request.url).origin` which is `http://localhost:8788` in local dev.
**How to avoid:** Use `http://localhost:8788/building/12-brighton-ave#review-review-001` exactly — no HTTPS, no trailing slash issues.

### Pitfall 2: All Seed Reviews Are 'approved' — Approve Button Hidden

**What goes wrong:** Test navigates to `/admin/reviews`, expands a card, and cannot find the "Approve" button.
**Why it happens:** ReviewsTable.tsx renders `{review.status !== 'approved' && <button>Approve</button>}`. Since all seed reviews start approved, the approve button is conditionally hidden.
**How to avoid:** Click "Reset to Pending" first. This sets the review to pending status, which causes the Approve button to appear.

### Pitfall 3: Dispute Form Checkbox ID Has Spaces

**What goes wrong:** `page.locator('#reason-Factually incorrect information')` fails with CSS selector error.
**Why it happens:** HTML `id="reason-Factually incorrect information"` — spaces in an ID are technically invalid HTML but browsers handle them; Playwright CSS selectors do not.
**How to avoid:** Use label-based selection: `page.getByLabel('Factually incorrect information').check()`. This matches the `<label htmlFor="reason-Factually incorrect information">` element and clicks the associated checkbox.

### Pitfall 4: Audit Log Table Empty If Tests Run in Wrong Order

**What goes wrong:** Audit log test navigates to `/admin/audit` and sees "No audit logs found."
**Why it happens:** Seed data has no audit_log entries. If moderation/resolution tests haven't run yet, the table is empty.
**How to avoid:** Playwright with `workers: 1` runs tests sequentially in file order. The audit log test should be in the same spec file (or a later file) as the moderation tests. The test should assert `>= 1 row` (not a specific action type) to be robust against execution context.

**Alternative approach:** If test isolation is preferred, navigate to `/admin/reviews`, perform a "Reset to Pending" + "Approve" action WITHIN the audit log test itself before navigating to `/admin/audit`. This makes the test self-contained.

### Pitfall 5: React Island Components Have Loading Spinner

**What goes wrong:** Test asserts content immediately after navigation but the spinner is showing.
**Why it happens:** ReviewsTable, DisputesQueue, AuditLogTable all do `const [loading, setLoading] = useState(true)` and fetch data on mount. The spinner (`div.animate-spin.rounded-full.h-8.w-8.border-b-2.border-teal-600`) shows until fetch completes.
**How to avoid:** Use `await adminPage.waitForLoadState('networkidle')` after navigation. This waits for all network requests (including the API fetch) to complete before assertions.

### Pitfall 6: DisputeForm Is Client:Load React Component — Not Immediately Interactive

**What goes wrong:** `page.fill('#reviewUrl', ...)` fails immediately after `page.goto('/dispute')`.
**Why it happens:** DisputeForm uses `client:load` in `dispute.astro`. React hydration has a brief delay.
**How to avoid:** After `page.goto('/dispute')`, wait for a visible element: `await page.locator('#reviewUrl').waitFor()` or use `waitForLoadState('networkidle')`.

### Pitfall 7: Dispute Resolution Card Collapses After Success

**What goes wrong:** After clicking "Resolve Dispute", test tries to assert the status badge on the collapsed card and fails.
**Why it happens:** `resolveDispute()` in DisputesQueue.tsx calls `setExpandedDispute(null)` on success — card collapses. The resolved dispute disappears from the default "pending" filter view.
**How to avoid:** After clicking "Resolve Dispute" and waiting for the action to complete, switch to the "All" or "Resolved" filter to find the now-resolved dispute and assert its status badge. OR assert on the count decrease: the "Pending (N)" button count should decrease.

### Pitfall 8: Non-Admin Access Control — Redirect Behavior

**What goes wrong:** `authedPage.goto('/admin')` and test expects redirect but `waitForURL` timeout.
**Why it happens:** AdminLayout.astro redirects non-admin users to `/` — the page redirects server-side. The redirect is near-instant.
**How to avoid:** Use `page.waitForURL('/')` after navigating as non-admin, then assert heading is NOT visible. Alternatively, check `page.url()` does not contain `/admin`.

---

## Code Examples

### Admin Pages Render Test (E2E-11)

```typescript
// Source: AdminLayout.astro — all pages use this layout
test('dashboard renders', async ({ adminPage }) => {
  await adminPage.goto('/admin');
  await expect(adminPage.locator('h1')).toHaveText('Dashboard Overview');
  // SSR — no networkidle wait needed for dashboard
  await expect(adminPage.locator('text=Total Users')).toBeVisible();
  await expect(adminPage.locator('text=Total Reviews')).toBeVisible();
  await expect(adminPage.locator('text=Buildings')).toBeVisible();
  await expect(adminPage.locator('text=Verifications')).toBeVisible();
});

test('reviews page renders', async ({ adminPage }) => {
  await adminPage.goto('/admin/reviews');
  await expect(adminPage.locator('h1')).toHaveText('Review Management');
  await adminPage.waitForLoadState('networkidle');
  // Status filter buttons confirm ReviewsTable is loaded
  await expect(adminPage.locator('button', { hasText: /All \(/ })).toBeVisible();
});
```

### Navigation Bar Test (E2E-11)

```typescript
// Source: AdminLayout.astro navItems array
test('admin navigation bar contains all page links', async ({ adminPage }) => {
  await adminPage.goto('/admin');
  await expect(adminPage.locator('h1')).toHaveText('Dashboard Overview');

  // Verify all 9 nav links exist
  await expect(adminPage.locator('nav a[href="/admin"]')).toBeVisible();
  await expect(adminPage.locator('nav a[href="/admin/users"]')).toBeVisible();
  await expect(adminPage.locator('nav a[href="/admin/reviews"]')).toBeVisible();
  await expect(adminPage.locator('nav a[href="/admin/buildings"]')).toBeVisible();
  await expect(adminPage.locator('nav a[href="/admin/landlords"]')).toBeVisible();
  await expect(adminPage.locator('nav a[href="/admin/managers"]')).toBeVisible();
  await expect(adminPage.locator('nav a[href="/admin/verify"]')).toBeVisible();
  await expect(adminPage.locator('nav a[href="/admin/disputes"]')).toBeVisible();
  await expect(adminPage.locator('nav a[href="/admin/audit"]')).toBeVisible();
});
```

### Review Approve Flow (E2E-07)

```typescript
// Source: ReviewsTable.tsx — action buttons in expanded section
test('admin can approve a pending review', async ({ adminPage }) => {
  test.setTimeout(60000);
  await adminPage.goto('/admin/reviews');
  await adminPage.waitForLoadState('networkidle');

  // Click first review card header to expand
  await adminPage.locator('.cursor-pointer').first().click();

  // All seeds are approved — Reset to Pending to get the Approve button
  await adminPage.locator('button', { hasText: 'Reset to Pending' }).first().click();

  // Wait for status badge to update (React state update)
  await expect(adminPage.locator('span.rounded-full').first()).toContainText('pending');

  // Now Approve button is visible
  await adminPage.locator('button', { hasText: 'Approve' }).first().click();

  // Verify status badge updates to 'approved'
  await expect(adminPage.locator('span.rounded-full').first()).toContainText('approved');
});
```

### Dispute Submission (E2E-08)

```typescript
// Source: DisputeForm.tsx + src/pages/api/disputes.ts
// Uses unauthenticated page fixture — /dispute is public
test('landlord can submit a dispute', async ({ page }) => {
  await page.goto('/dispute');
  await page.locator('#reviewUrl').waitFor();  // Wait for React hydration

  // Use review-001 on building-01 (no existing dispute for this review in seed data)
  await page.fill('#reviewUrl', 'http://localhost:8788/building/12-brighton-ave#review-review-001');
  await page.fill('#landlordName', 'E2E Test Landlord');
  await page.fill('#landlordEmail', 'e2e-test-landlord@example.com');
  await page.fill('#landlordPhone', '617-555-9999');

  // Use label-based selection to handle spaces in checkbox ID
  await page.getByLabel('Factually incorrect information').check();
  await page.fill('#disputeExplanation', 'This is an E2E test dispute submission.');

  await page.locator('button[type="submit"]').click();

  // Success: green container with "Dispute submitted successfully"
  await expect(page.locator('text=Dispute submitted successfully')).toBeVisible();
});
```

### Dispute Resolution (E2E-09)

```typescript
// Source: DisputesQueue.tsx — 7 pending disputes in seed data
test('admin can resolve a pending dispute', async ({ adminPage }) => {
  test.setTimeout(60000);
  await adminPage.goto('/admin/disputes');
  await adminPage.waitForLoadState('networkidle');

  // Default filter is 'pending' — pending disputes are visible
  // Click first pending dispute to expand
  await adminPage.locator('.cursor-pointer').first().click();

  // Assert side-by-side view loaded
  await expect(adminPage.locator('h4', { hasText: 'Landlord Information' })).toBeVisible();
  await expect(adminPage.locator('h4', { hasText: 'Original Review' })).toBeVisible();
  await expect(adminPage.locator('h4', { hasText: 'Resolve Dispute' })).toBeVisible();

  // Fill resolution notes (required — button disabled without it)
  await adminPage.locator('textarea[placeholder="Explain the resolution decision..."]').fill(
    'E2E test resolution — dispute dismissed after review.'
  );

  // Outcome dropdown defaults to 'dismiss' — no change needed
  await adminPage.locator('button', { hasText: 'Resolve Dispute' }).click();

  // After resolution, switch to 'Resolved' filter and verify entry appears
  await adminPage.locator('button', { hasText: /Resolved/ }).click();
  await expect(adminPage.locator('span.rounded-full', { hasText: 'resolved' }).first()).toBeVisible();
});
```

### Audit Log Verification (E2E-10)

```typescript
// Source: AuditLogTable.tsx — table with 5 columns
// MUST run after moderation/resolution tests that create log entries
test('audit log shows entries from admin actions', async ({ adminPage }) => {
  await adminPage.goto('/admin/audit');
  await adminPage.waitForLoadState('networkidle');

  // Table header confirms component loaded
  await expect(adminPage.locator('table thead')).toBeVisible();
  await expect(adminPage.locator('th', { hasText: 'Timestamp' })).toBeVisible();
  await expect(adminPage.locator('th', { hasText: 'Action' })).toBeVisible();

  // At least one audit entry exists (created by earlier tests in this suite)
  await expect(adminPage.locator('table tbody tr').first()).toBeVisible();

  // Action badge shows formatted action type
  // 'review_approved' → 'Review Approved', etc.
  // At least one badge contains 'Review' or 'Dispute'
  const firstBadge = adminPage.locator('table tbody tr').first().locator('span');
  await expect(firstBadge).toBeVisible();
});

test('audit log row expansion shows old/new values', async ({ adminPage }) => {
  await adminPage.goto('/admin/audit');
  await adminPage.waitForLoadState('networkidle');
  await adminPage.locator('table tbody tr').first().waitFor();

  // Click first row to expand details
  await adminPage.locator('table tbody tr').first().click();
  // Details column shows "From:" and/or "To:" labels
  await expect(adminPage.locator('text=From:').first()).toBeVisible();
});
```

### Access Control Tests (E2E-11)

```typescript
// Source: AdminLayout.astro — redirects non-admin to '/', unauthed to '/auth/signin'
test('non-admin user is redirected from admin pages', async ({ authedPage }) => {
  await authedPage.goto('/admin');
  // Should redirect to / (not /admin)
  await authedPage.waitForURL('/');
  await expect(authedPage.locator('h1', { hasText: 'Dashboard Overview' })).not.toBeVisible();
});

test('unauthenticated user is redirected to signin', async ({ page }) => {
  await page.goto('/admin');
  await page.waitForURL(/auth\/signin/);
  expect(page.url()).toContain('/auth/signin');
});
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Phase 6: `page` fixture (no auth) for page render tests | Phase 8: `adminPage` fixture for all admin page tests | Phase 6 established adminPage | Admin pages require admin auth — unauthenticated page redirects to signin |
| Phase 7: single spec file per concern | Phase 8: two spec files (pages + actions) | Same pattern, extended | Keeps E2E-11 (page renders) separate from E2E-07/08/09/10 (actions) |

---

## Open Questions

1. **Does the dispute form show a client-side validation error when submitted empty, or does it prevent submission silently?**
   - What we know: `validateForm()` in DisputeForm.tsx sets `fieldErrors` state and returns `false` without submitting. Error messages like "Review URL is required" appear as `<p class="mt-1 text-sm text-red-600">`.
   - What's unclear: Whether Playwright can reliably detect these field-level errors vs. asserting the success state doesn't appear.
   - Recommendation: After empty form submit, assert a specific field error: `expect(page.locator('text=Review URL is required')).toBeVisible()`.

2. **Does the resolved dispute disappear from the pending filter immediately after resolution?**
   - What we know: `resolveDispute()` updates local React state (`setDisputes(prev => ...)`) to `status: 'resolved'` and calls `setExpandedDispute(null)`. The `filteredDisputes` computed value then excludes it from the pending filter.
   - What's unclear: Whether the UI update is synchronous enough for immediate Playwright assertion.
   - Recommendation: After clicking "Resolve Dispute", wait for the card to disappear from view, then switch to "Resolved" filter and assert the resolved dispute appears.

3. **Will the audit log test be reliable given it depends on prior test execution?**
   - What we know: `workers: 1` guarantees sequential execution; tests in earlier spec files run before later spec files.
   - What's unclear: Playwright test execution order across files — is it alphabetical? Does `admin-actions.spec.ts` always run before an audit assertion?
   - Recommendation: Include a moderation action WITHIN the audit log test itself (or at the top of the audit describe block) to create a guaranteed audit entry, making the test self-contained. This adds robustness at the cost of a few extra UI interactions.

---

## Key Selectors Reference

Based on direct source inspection:

### AdminLayout (all admin pages)

| Element | Selector |
|---------|----------|
| Admin nav container | `nav` (inside `div.bg-white.border-b`) |
| Nav link to dashboard | `nav a[href="/admin"]` |
| Nav link to users | `nav a[href="/admin/users"]` |
| Nav link to reviews | `nav a[href="/admin/reviews"]` |
| Nav link to buildings | `nav a[href="/admin/buildings"]` |
| Nav link to landlords | `nav a[href="/admin/landlords"]` |
| Nav link to managers | `nav a[href="/admin/managers"]` |
| Nav link to verification | `nav a[href="/admin/verify"]` |
| Nav link to disputes | `nav a[href="/admin/disputes"]` |
| Nav link to audit log | `nav a[href="/admin/audit"]` |
| Loading spinner | `div.animate-spin.rounded-full.h-8.w-8.border-b-2.border-teal-600` |

### Admin Dashboard (SSR, no spinner)

| Element | Selector |
|---------|----------|
| Page heading | `h1` with text "Dashboard Overview" |
| Total Users label | `p.text-sm.font-medium.text-gray-500` with text "Total Users" |
| Total Reviews label | `p.text-sm.font-medium.text-gray-500` with text "Total Reviews" |
| Buildings label | `p.text-sm.font-medium.text-gray-500` with text "Buildings" |
| Verifications label | `p.text-sm.font-medium.text-gray-500` with text "Verifications" |
| Review Status Breakdown heading | `h2` with text "Review Status Breakdown" |
| Recent Reviews heading | `h2` with text "Recent Reviews" |

### ReviewsTable (admin/reviews)

| Element | Selector |
|---------|----------|
| Page heading | `h1` with text "Review Management" |
| Status filter buttons | `button` matching `/All \(/`, `/Pending \(/`, `/Approved \(/`, `/Rejected \(/`, `/Flagged \(/` |
| Review card header | `div.cursor-pointer` (expandable) |
| Status badge in card | `span.rounded-full` with status text |
| Approve button | `button` with text "Approve" (bg-green-600, only when status !== 'approved') |
| Reject button | `button` with text "Reject" (bg-red-600, only when status !== 'rejected') |
| Reset to Pending button | `button` with text "Reset to Pending" (only when status !== 'pending') |

### DisputeForm (public /dispute page)

| Element | Selector |
|---------|----------|
| Page heading | `h1` with text "Submit a Dispute" |
| Review URL input | `#reviewUrl` |
| Landlord name input | `#landlordName` |
| Landlord email input | `#landlordEmail` |
| Landlord phone input | `#landlordPhone` |
| Reason checkbox | `page.getByLabel('Factually incorrect information')` |
| Explanation textarea | `#disputeExplanation` |
| Submit button | `button[type="submit"]` with text "Submit Dispute" |
| Success heading | `h3` with text "Dispute submitted successfully" |
| Field error | `p.text-sm.text-red-600` with field-specific message |

### DisputesQueue (admin/disputes)

| Element | Selector |
|---------|----------|
| Page heading | `h1` with text "Dispute Queue" |
| Status filter buttons | `button` matching `/Pending \(/`, `/Resolved \(/`, `/All \(/` |
| Dispute card header | `div.cursor-pointer` (expandable) |
| Dispute status badge | `span.rounded-full` with status text |
| Landlord Information heading | `h4` with text "Landlord Information" |
| Original Review heading | `h4` with text "Original Review" |
| Resolve Dispute heading | `h4` with text "Resolve Dispute" |
| Outcome select | `select` (inside resolve form) |
| Notes textarea | `textarea[placeholder="Explain the resolution decision..."]` |
| Resolve button | `button` with text "Resolve Dispute" |

### AuditLogTable (admin/audit)

| Element | Selector |
|---------|----------|
| Page heading | `h1` with text "Audit Log" |
| Table header | `table thead` |
| Timestamp column header | `th` with text "Timestamp" |
| Admin column header | `th` with text "Admin" |
| Action column header | `th` with text "Action" |
| Entity column header | `th` with text "Entity" |
| Details column header | `th` with text "Details" |
| Table body rows | `table tbody tr` |
| Action badge | `span` with class pattern `px-2 py-1 text-xs font-medium rounded` |
| Empty state | `text=No audit logs found.` |
| Expanded "From:" label | `text=From:` |
| Expanded "To:" label | `text=To:` |

---

## Sources

### Primary (HIGH confidence)

- `e2e/fixtures.ts` — authedPage, adminPage fixture implementation confirmed
- `e2e/global.setup.ts` — admin.json creation pattern confirmed
- `playwright.config.ts` — Playwright 1.58.2, baseURL http://localhost:8788, workers: 1, setup project
- `src/pages/admin/index.astro` — Dashboard SSR rendering, stats card labels, heading text
- `src/pages/admin/reviews.astro` — Heading "Review Management", ReviewsTable client:load
- `src/pages/admin/disputes.astro` — Heading "Dispute Queue", DisputesQueue client:load
- `src/pages/admin/audit.astro` — Heading "Audit Log", AuditLogTable client:load
- `src/pages/admin/users.astro` — Heading confirmed as "User Management"
- `src/components/admin/AdminLayout.astro` — navItems array (all 9 links), auth redirect logic
- `src/components/admin/ReviewsTable.tsx` — Status badges, action buttons, expand/collapse, PATCH API call
- `src/components/admin/DisputesQueue.tsx` — Status filters, expand/collapse, resolution form, PATCH API call
- `src/components/admin/AuditLogTable.tsx` — Table columns, formatActionType(), row expansion
- `src/components/disputes/DisputeForm.tsx` — Form field IDs, checkbox IDs, success state text
- `src/pages/dispute.astro` — Public page, h1 "Submit a Dispute", DisputeForm client:load
- `src/pages/api/admin/reviews/[id].ts` — PATCH method, body `{status, moderation_notes}`, audit log call
- `src/pages/api/admin/reviews/index.ts` — GET method returning all reviews
- `src/pages/api/admin/audit.ts` — GET method, pagination, filter params
- `src/pages/api/disputes.ts` — POST method, extractReviewIdFromUrl validation, 201 response
- `src/pages/api/disputes/[id].ts` — PATCH method, resolutionOutcome/resolutionNotes, audit log call
- `src/lib/disputes.ts` — DISPUTE_REASONS array, extractReviewIdFromUrl() origin validation logic
- `src/lib/audit.ts` — createAuditLog() function, AuditLogEntry interface
- `scripts/db-seed.ts` — building-01 slug `12-brighton-ave`, review-001 owner, dispute IDs and review_ids, NO audit_log rows seeded
- `e2e/auth.spec.ts` — Phase 7 pattern examples (import, fixture usage, waitForURL, waitForLoadState)

### Secondary (MEDIUM confidence)

- `.planning/STATE.md` — confirmed workers: 1 decision, Phase 8 not started
- `.planning/REQUIREMENTS.md` — E2E-07 through E2E-11 requirement text
- `.planning/phases/08-admin-and-disputes-e2e/08-01-PLAN.md` — Plan structure and truths (pre-written)
- `.planning/phases/08-admin-and-disputes-e2e/08-02-PLAN.md` — Plan structure and truths (pre-written)

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — no new packages, all infrastructure confirmed from Phase 6/7
- Architecture: HIGH — all selectors verified from actual TSX/Astro source files
- API behavior: HIGH — all route handlers read directly
- Pitfalls: HIGH — identified from actual code paths, not speculation

**Research date:** 2026-02-28
**Valid until:** 2026-03-28 (stable — no fast-moving dependencies)
