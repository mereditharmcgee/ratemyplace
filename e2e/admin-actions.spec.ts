import { test, expect } from './fixtures';

// E2E-07: Review moderation — admin can approve and reject reviews via the admin UI.
// E2E-08: Dispute submission — public landlord dispute form submits and shows success.
// E2E-09: Dispute resolution — admin can resolve a pending dispute with outcome and notes.
// E2E-10: Audit log — admin moderation actions appear in the audit log with details.

// NOTE: workers: 1 guarantees sequential test execution.
// All seed reviews are 'approved' — Reset to Pending first, then Approve or Reject.
// Audit log starts empty; entries created by earlier moderation/resolution tests.

test.describe('Review Moderation (E2E-07)', () => {
  test('admin can approve a pending review', async ({ adminPage }) => {
    test.setTimeout(60000);

    // Navigate to reviews page and wait for React island to load
    await adminPage.goto('/admin/reviews');
    await adminPage.waitForLoadState('networkidle');

    // All seed reviews start as 'approved'. Click first review card to expand it.
    await adminPage.locator('.cursor-pointer').first().click();

    // Click "Reset to Pending" to make the Approve button appear
    await adminPage.locator('button', { hasText: 'Reset to Pending' }).first().click();

    // Wait for the status badge to update to 'pending'
    await expect(adminPage.locator('span.rounded-full').first()).toContainText('pending');

    // Now click Approve
    await adminPage.locator('button', { hasText: 'Approve' }).first().click();

    // Assert status badge updated to 'approved'
    await expect(adminPage.locator('span.rounded-full').first()).toContainText('approved');
  });

  test('admin can reject a pending review', async ({ adminPage }) => {
    test.setTimeout(60000);

    // Navigate to reviews page and wait for React island to load
    await adminPage.goto('/admin/reviews');
    await adminPage.waitForLoadState('networkidle');

    // Use the second review card to avoid any collision with the approve test card.
    // All seed reviews are 'approved' — expand the second card.
    const reviewCards = adminPage.locator('.cursor-pointer');
    const secondReviewHeader = reviewCards.nth(1);
    await secondReviewHeader.click();

    // Scope all subsequent actions to the expanded card containing that header.
    const secondCard = secondReviewHeader.locator('..');

    // Click "Reset to Pending" within the second card to expose the Reject button
    await secondCard.locator('button', { hasText: 'Reset to Pending' }).click();

    // Wait for the status badge within that card to update to 'pending'
    await expect(secondCard.locator('span.rounded-full')).toContainText('pending');

    // Click Reject within the same card
    await secondCard.locator('button', { hasText: 'Reject' }).first().click();

    // Assert status badge within the card updated to 'rejected'
    await expect(secondCard.locator('span.rounded-full')).toContainText('rejected');
  });
});

test.describe('Dispute Submission (E2E-08)', () => {
  test('landlord can submit a dispute through the public form', async ({ page }) => {
    // Dispute form is public — use unauthenticated page fixture
    await page.goto('/dispute');

    // Wait for React hydration — form fields become available
    await page.locator('#reviewUrl').waitFor();

    // Fill the review URL — must use localhost:8788 origin
    // review-001 is on building-01 (slug: 12-brighton-ave), no existing dispute for it
    await page.fill('#reviewUrl', 'http://localhost:8788/building/12-brighton-ave#review-review-001');

    // Fill landlord contact information
    await page.fill('#landlordName', 'E2E Test Landlord');
    await page.fill('#landlordEmail', 'e2e-test-landlord@example.com');
    await page.fill('#landlordPhone', '617-555-9999');

    // Check a dispute reason — use getByLabel to avoid CSS ID escaping issues with spaces
    await page.getByLabel('Factually incorrect information').check();

    // Fill optional explanation
    await page.fill('#disputeExplanation', 'This is an E2E test dispute submission.');

    // Submit the form
    await page.locator('button[type="submit"]').click();

    // Assert success message is visible
    await expect(page.locator('text=Dispute submitted successfully')).toBeVisible();
  });

  test('dispute form validates required fields', async ({ page }) => {
    // Navigate to the public dispute form
    await page.goto('/dispute');

    // Wait for React hydration
    await page.locator('#reviewUrl').waitFor();

    // Submit without filling any fields
    await page.locator('button[type="submit"]').click();

    // Assert validation error for required Review URL field
    await expect(page.locator('text=Review URL is required')).toBeVisible();

    // Assert success message is NOT visible — form was not submitted
    await expect(page.locator('text=Dispute submitted successfully')).not.toBeVisible();
  });
});

test.describe('Dispute Resolution (E2E-09)', () => {
  test('admin can view dispute side-by-side with review and resolve it', async ({ adminPage }) => {
    test.setTimeout(60000);

    // Navigate to disputes admin page — defaults to pending filter
    await adminPage.goto('/admin/disputes');
    await adminPage.waitForLoadState('networkidle');

    // Seed data has 7 pending disputes — expand the first one
    await adminPage.locator('.cursor-pointer').first().click();

    // Assert the side-by-side layout sections are visible
    await expect(adminPage.locator('h4', { hasText: 'Landlord Information' })).toBeVisible();
    await expect(adminPage.locator('h4', { hasText: 'Original Review' })).toBeVisible();
    await expect(adminPage.locator('h4', { hasText: 'Resolve Dispute' })).toBeVisible();

    // Fill resolution notes — button is disabled without notes
    await adminPage
      .locator('textarea[placeholder="Explain the resolution decision..."]')
      .fill('E2E test resolution - dispute dismissed after review.');

    // Outcome select defaults to 'dismiss' — no change needed

    // Click Resolve Dispute button
    await adminPage.locator('button', { hasText: 'Resolve Dispute' }).click();

    // After resolution, card collapses and dispute leaves pending filter.
    // Switch to Resolved filter to verify the resolved status badge.
    await adminPage.locator('button').filter({ hasText: /^Resolved/ }).click();
    await adminPage.waitForLoadState('networkidle');

    // Assert at least one resolved dispute is visible
    await expect(
      adminPage.locator('span.rounded-full', { hasText: 'resolved' }).first()
    ).toBeVisible();
  });
});

test.describe('Audit Log (E2E-10)', () => {
  test('admin actions appear in the audit log', async ({ adminPage }) => {
    // Moderation and resolution tests ran before this (workers: 1, same file).
    // Those tests created audit log entries for approve, reject, and resolve actions.
    await adminPage.goto('/admin/audit');
    await adminPage.waitForLoadState('networkidle');

    // Assert audit log table structure
    await expect(adminPage.locator('table thead')).toBeVisible();
    await expect(adminPage.locator('th', { hasText: 'Timestamp' })).toBeVisible();
    await expect(adminPage.locator('th', { hasText: 'Action' })).toBeVisible();
    await expect(adminPage.locator('th', { hasText: 'Entity' })).toBeVisible();

    // Assert at least one audit log row exists from prior tests
    await expect(adminPage.locator('table tbody tr').first()).toBeVisible();

    // Assert an action badge is present in the first row (review or dispute action)
    const firstRowAction = adminPage.locator('table tbody tr').first().locator('td').nth(2);
    await expect(firstRowAction).toBeVisible();
  });

  test('audit log row expansion shows old/new values', async ({ adminPage }) => {
    // Navigate to audit log page
    await adminPage.goto('/admin/audit');
    await adminPage.waitForLoadState('networkidle');

    // Wait for at least one audit log row to be present
    await adminPage.locator('table tbody tr').first().waitFor();

    // Click the first row to expand it
    await adminPage.locator('table tbody tr').first().click();

    // Assert expanded details show the "From:" label for old value
    await expect(adminPage.locator('text=From:').first()).toBeVisible();
  });
});
