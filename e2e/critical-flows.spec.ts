import { test, expect } from './fixtures';
import path from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '..');
const BASE_URL = process.env.BASE_URL || 'http://localhost:8788';

// ─── Phase 20 reservations ──────────────────────────────────────────────────
// Test-only building: building-e2e-01 (slug test-cross-view-consistency, addr "999 E2E Test Way").
// Reviews are submitted via the API (generated IDs from generateIdFromEntropySize).
// Cleanup: delete ALL reviews for building-e2e-01 and matching audit_logs.
//   - Scoped to building-e2e-01 so no seed reviews are accidentally deleted.
//   - Idempotent in beforeEach + afterEach (belt-and-suspenders).
// Note: review-090 and review-091 are used in seed data (building-10) — do NOT use
// those IDs as reserved Phase 20 IDs. The test building approach provides isolation.
// ─────────────────────────────────────────────────────────────────────────────

const TEST_BUILDING_ID = 'building-e2e-01';
const TEST_BUILDING_ADDRESS = '999 E2E Test Way';

function cleanupPhase20Reviews(): void {
  // Find any reviews for the test building and delete their audit_logs first,
  // then the reviews themselves. Uses subquery to avoid needing IDs upfront.
  execSync(
    `npx wrangler d1 execute ratemyplace-db --local --command "DELETE FROM audit_logs WHERE entity_id IN (SELECT id FROM reviews WHERE building_id = 'building-e2e-01')"`,
    { cwd: PROJECT_ROOT, stdio: 'pipe' }
  );
  execSync(
    `npx wrangler d1 execute ratemyplace-db --local --command "DELETE FROM reviews WHERE building_id = 'building-e2e-01'"`,
    { cwd: PROJECT_ROOT, stdio: 'pipe' }
  );
}

/**
 * Count audit_logs rows matching a specific review_id and action_type.
 * Returns the integer count from the first row of the result set.
 * Used by TEST-01's causal assertion (capture-before-trigger).
 */
function countAuditLogEntries(reviewId: string, actionType: string): number {
  const sql = `SELECT COUNT(*) as c FROM audit_logs WHERE entity_id = '${reviewId}' AND action_type = '${actionType}'`;
  const raw = execSync(
    `npx wrangler d1 execute ratemyplace-db --local --command "${sql}" --json`,
    { cwd: PROJECT_ROOT, encoding: 'utf8', stdio: 'pipe' }
  );
  const parsed = JSON.parse(raw);
  return parsed[0].results[0].c as number;
}

/**
 * Submit a review via POST /api/reviews using the authed user's session.
 * Returns the generated reviewId from the response body.
 * Posts minimal-but-valid form data: required building_id, all 27 score fields
 * set to 4, and the dummy Turnstile token (verify fails open in local dev).
 */
async function submitReviewAsAuthedUser(
  authedPage: import('@playwright/test').Page,
  buildingId: string
): Promise<string> {
  // Build form payload. All 27 score fields must be 1-5; we use 4 across the board
  // for predictable scoring and to keep the test focused on the audit-log assertion.
  const SCORE_FIELDS = [
    'unit_structural', 'unit_plumbing', 'unit_electrical', 'unit_climate',
    'unit_ventilation', 'unit_pests', 'unit_mold', 'unit_appliances',
    'unit_layout', 'unit_natural_light',
    'building_security', 'building_cleanliness', 'building_noise',
    'building_amenities', 'building_accessibility', 'building_condition',
    'landlord_responsiveness', 'landlord_maintenance', 'landlord_repair_quality',
    'landlord_communication', 'landlord_lease_fairness',
    'landlord_deposit_handling', 'landlord_renewal_process',
    'landlord_privacy_respect', 'landlord_eviction_practices',
    'landlord_fee_transparency', 'landlord_safety_response',
  ];
  const formFields: Record<string, string> = {
    'cf-turnstile-response': 'XXXX.DUMMY.TOKEN.XXXX',
    building_id: buildingId,
    bedrooms: '1',
    bathrooms: '1',
    tenure_months: '12',
    move_out_year: 'current',
    move_in_year: String(new Date().getFullYear()),
    move_in_month: '1',
    would_recommend: 'yes',
  };
  for (const f of SCORE_FIELDS) formFields[f] = '4';

  const res = await authedPage.request.post('/api/reviews', {
    multipart: formFields,
    headers: { Origin: BASE_URL },
  });
  expect(res.status(), `Review submit failed: ${await res.text()}`).toBe(200);
  const body = await res.json();
  expect(body.success).toBe(true);
  expect(typeof body.reviewId).toBe('string');
  return body.reviewId as string;
}

test.describe('Phase 20: Critical Flows', () => {
  test.beforeEach(() => cleanupPhase20Reviews());
  test.afterEach(() => cleanupPhase20Reviews());

  // ─── TEST-01: Causal audit-log assertion ────────────────────────────────
  test('audit log: admin approve writes audit_logs row keyed to the approved review_id', async ({
    authedPage,
    adminPage,
  }) => {
    test.setTimeout(60000);

    // 1. CAUSAL CAPTURE: submit a review and capture reviewId BEFORE any approve action.
    //    This is the load-bearing assertion mechanism — a test that just queried the
    //    "latest" audit_logs row could pass even if the SPECIFIC review's approval
    //    didn't get logged. Capture-before-trigger forces the causal chain.
    const reviewId = await submitReviewAsAuthedUser(authedPage, TEST_BUILDING_ID);

    // Sanity: no audit log for this review yet (we haven't approved).
    expect(countAuditLogEntries(reviewId, 'review_approved')).toBe(0);

    // 2. TRIGGER: navigate adminPage to /admin/reviews?status=pending so the
    //    fresh pending review is visible without scrolling past approved seed rows.
    // Listen for the PATCH response to confirm the approve request was sent and succeeded.
    const patchResponsePromise = adminPage.waitForResponse(
      (resp) => resp.url().includes('/api/admin/reviews/') && resp.request().method() === 'PATCH',
      { timeout: 15000 }
    );
    await adminPage.goto('/admin/reviews?status=pending');
    await adminPage.waitForLoadState('networkidle');

    // Scope to the outer card container (bg-white rounded-xl) which contains both
    // the header (cursor-pointer) and the expanded details panel with the Approve button.
    // Use .first() for strict mode safety if multiple test reviews exist (e.g., from
    // a previous run's afterEach failure). The beforeEach cleanup handles stale reviews,
    // but .first() prevents strict-mode errors if a race leaves extras.
    const reviewCard = adminPage.locator('.bg-white.rounded-xl', { hasText: TEST_BUILDING_ADDRESS }).first();
    await expect(reviewCard).toBeVisible({ timeout: 10000 });

    // Click the cursor-pointer header to expand the card and load full review details.
    const reviewHeader = reviewCard.locator('.cursor-pointer').first();
    await reviewHeader.click();

    // Wait for the Approve button to be visible inside the expanded card before clicking.
    // The card fetches review details asynchronously after expanding; the Approve button
    // only renders once reviewDetails[review.id] is populated.
    const approveButton = reviewCard.locator('button', { hasText: 'Approve' }).first();
    await expect(approveButton).toBeVisible({ timeout: 10000 });
    await approveButton.click();

    // Wait for the PATCH response to confirm the approve request succeeded.
    // Note: On a ?status=pending filtered view, the card disappears from the DOM after
    // approval (React removes it from the filtered list). We rely on the PATCH response
    // status (not a UI badge) to confirm the approve happened before querying audit_logs.
    const patchResponse = await patchResponsePromise;
    const patchUrl = patchResponse.url();
    expect(
      patchResponse.status(),
      `PATCH ${patchUrl} failed with status ${patchResponse.status()}`
    ).toBe(200);
    // Verify the PATCH was for the correct review ID (causal check)
    expect(patchUrl, `PATCH was for wrong review`).toContain(reviewId);

    // 3. ASSERT: query audit_logs for the captured reviewId. Pass condition is
    //    >= 1 row matching entity_id + action_type. NOT ordering-dependent (no LIMIT,
    //    no MAX, no LATEST). Other concurrent audit writes are irrelevant.
    const auditCount = countAuditLogEntries(reviewId, 'review_approved');
    expect(
      auditCount,
      `Expected an audit_logs row with entity_id='${reviewId}' AND action_type='review_approved'`
    ).toBeGreaterThanOrEqual(1);
  });
});
