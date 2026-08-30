import { test, expect } from './fixtures';
import { executeLocalD1, TURNSTILE_TEST_TOKEN } from './test-harness';

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
const TEST_BUILDING_SLUG = 'test-cross-view-consistency';

function cleanupPhase20Reviews(): void {
  // Find any reviews for the test building and delete their audit_logs first,
  // then the reviews themselves. Uses subquery to avoid needing IDs upfront.
  executeLocalD1(
    "DELETE FROM audit_logs WHERE entity_id IN (SELECT id FROM reviews WHERE building_id = 'building-e2e-01')"
  );
  executeLocalD1("DELETE FROM reviews WHERE building_id = 'building-e2e-01'");
}

/**
 * Count audit_logs rows matching a specific review_id and action_type.
 * Returns the integer count from the first row of the result set.
 * Used by TEST-01's causal assertion (capture-before-trigger).
 */
function countAuditLogEntries(reviewId: string, actionType: string): number {
  const sql = `SELECT COUNT(*) as c FROM audit_logs WHERE entity_id = '${reviewId}' AND action_type = '${actionType}'`;
  const raw = executeLocalD1(sql);
  const parsed = JSON.parse(raw);
  return parsed[0].results[0].c as number;
}

/**
 * Submit a review via POST /api/reviews using the authed user's session.
 * Returns the generated reviewId from the response body.
 * Posts minimal-but-valid form data: required building_id, all 27 score fields
 * set to 4, and Cloudflare's documented always-pass Turnstile test token.
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
    'cf-turnstile-response': TURNSTILE_TEST_TOKEN,
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

    // Select the review's semantic header, then scope actions to its parent card.
    const reviewHeader = adminPage.locator('.cursor-pointer', { hasText: TEST_BUILDING_ADDRESS }).first();
    await expect(reviewHeader).toBeVisible({ timeout: 10000 });
    const reviewCard = reviewHeader.locator('..');

    // Expand the card and load full review details.
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

  // ─── TEST-02: Cross-view data consistency ────────────────────────────────
  test('cross-view consistency: overall_score matches across search, building detail, and profile', async ({
    authedPage,
    adminPage,
  }) => {
    test.setTimeout(60000);

    // 1. Submit a single review against the test building. All 27 score fields
    //    are rated 4 in the helper, so the stored overall_score is deterministic.
    //    Single review + current-year submission collapses all three view code paths
    //    to the same rounded value: SQL ROUND(AVG(x),1) = JS Math.round(x*10)/10
    //    when x is itself the result of Math.round(...*10)/10 at submission time,
    //    and recency weight = 1.0 for a current-year review.
    const reviewId = await submitReviewAsAuthedUser(authedPage, TEST_BUILDING_ID);

    // 2. Approve via the admin UI. Uses the same waitForResponse pattern as TEST-01
    //    (not a UI badge assertion) because the pending-filtered view removes the card
    //    from the DOM once its status changes — the badge disappears before we can
    //    assert on it. The PATCH response confirms the approve completed before we
    //    read any of the three score views.
    const patchResponsePromise = adminPage.waitForResponse(
      (resp) => resp.url().includes('/api/admin/reviews/') && resp.request().method() === 'PATCH',
      { timeout: 15000 }
    );

    await adminPage.goto('/admin/reviews?status=pending');
    await adminPage.waitForLoadState('networkidle');

    const reviewHeader = adminPage.locator('.cursor-pointer', { hasText: TEST_BUILDING_ADDRESS }).first();
    await expect(reviewHeader).toBeVisible({ timeout: 10000 });
    const reviewCard = reviewHeader.locator('..');
    await reviewHeader.click();

    const approveButton = reviewCard.locator('button', { hasText: 'Approve' }).first();
    await expect(approveButton).toBeVisible({ timeout: 10000 });
    await approveButton.click();

    const patchResponse = await patchResponsePromise;
    expect(
      patchResponse.status(),
      `PATCH approve failed with status ${patchResponse.status()}`
    ).toBe(200);
    expect(patchResponse.url(), `PATCH was for wrong review`).toContain(reviewId);

    // 3. View 1: Search API. ROUND(AVG(overall_score), 1) for one approved review.
    //    Use authedPage.request.get — no page navigation needed for JSON response.
    //    The search endpoint matches on address/neighborhood/landlord name (not slug),
    //    so we query by TEST_BUILDING_ADDRESS to guarantee a hit on building-e2e-01.
    const searchRes = await authedPage.request.get(
      `/api/search/results?q=${encodeURIComponent(TEST_BUILDING_ADDRESS)}`
    );
    expect(searchRes.status(), 'Search API must return 200').toBe(200);
    const searchData = await searchRes.json();
    expect(
      searchData.results?.length,
      `Search must return at least one result for query "${TEST_BUILDING_ADDRESS}"`
    ).toBeGreaterThanOrEqual(1);
    // Defensive slug-match: the query may match other buildings if any other building
    // shares address tokens; filter to the specific slug to guarantee we read the right row.
    const searchRow = searchData.results.find(
      (r: { slug: string }) => r.slug === TEST_BUILDING_SLUG
    );
    expect(searchRow, `Search results must include slug=${TEST_BUILDING_SLUG}`).toBeDefined();
    const searchScore: number = searchRow.avg_overall;
    expect(typeof searchScore, 'avg_overall must be a number').toBe('number');

    // 4. View 2: Building detail page. The detail page reads building_scores, falls
    //    back to calculateBuildingAverages(reviews) when no row exists — which is
    //    the path for building-e2e-01 (no pre-seeded building_scores row).
    await authedPage.goto(`/building/${TEST_BUILDING_SLUG}`);
    await authedPage.waitForLoadState('networkidle');
    const detailReviewCount = authedPage.getByText(/\d+\s+reviews?/).first();
    await expect(detailReviewCount).toBeVisible({ timeout: 10000 });
    const detailScoreText = await detailReviewCount
      .locator('..')
      .locator(':scope > div')
      .first()
      .textContent();
    expect(detailScoreText, 'Detail page must render score').toBeTruthy();
    const detailScore: number = parseFloat(detailScoreText!.trim());
    expect(Number.isFinite(detailScore), `Detail score must be a finite number, got: "${detailScoreText}"`).toBe(true);

    // 5. View 3: Profile page (as the user who submitted). Profile lists per-review
    //    stored overall_score from the reviews table — different aggregation level
    //    than search/detail but identical value for a single review.
    await authedPage.goto('/profile');
    await authedPage.waitForLoadState('networkidle');
    // Wait for the review card containing the test address to render.
    const profileReviewCard = authedPage
      .locator('.bg-white.border.border-gray-200.rounded-\\[6px\\]')
      .filter({ hasText: TEST_BUILDING_ADDRESS });
    await expect(profileReviewCard).toBeVisible({ timeout: 10000 });
    // The score is inside a .bg-teal-50 badge as .font-medium.text-teal-700.
    // Scope to the review card first to avoid matching other .font-medium.text-teal-700
    // elements on the page (e.g. the "View building" link or autocomplete headers).
    const profileScoreText = await profileReviewCard
      .locator('.font-medium.text-teal-700')
      .first()
      .textContent();
    expect(profileScoreText, 'Profile must render review score').toBeTruthy();
    const profileScore: number = parseFloat(profileScoreText!.trim());
    expect(
      Number.isFinite(profileScore),
      `Profile score must be a finite number, got: "${profileScoreText}"`
    ).toBe(true);

    // 6. THE ASSERTION. Exact equality across all three views.
    //    Math justification: SQL ROUND(AVG(x), 1) on one row = JS Math.round(x*10)/10
    //    when x is the stored overall_score (itself produced by Math.round(...*10)/10
    //    at submission time). Recency weight = 1.0 for current-year review; single-row
    //    average = the value itself. Any failure here is a real divergence bug.
    //    Note: If a floating-point edge case ever surfaces, the RESEARCH.md fallback is
    //    toBeCloseTo(value, 1). Do NOT preemptively use toBeCloseTo — toBe catches
    //    divergence which is the actual bug class TEST-02 exists to detect.
    expect(
      searchScore,
      `Search vs detail divergence: search=${searchScore}, detail=${detailScore}`
    ).toBe(detailScore);
    expect(
      detailScore,
      `Detail vs profile divergence: detail=${detailScore}, profile=${profileScore}`
    ).toBe(profileScore);
  });
});
