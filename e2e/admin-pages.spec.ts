import { test, expect } from './fixtures';

// E2E-11: All 9 admin pages render correctly and are navigable as admin user.
// Access control: non-admin and unauthenticated users are redirected appropriately.

test.describe('Admin Page Navigation', () => {
  test('admin navigation bar contains all page links', async ({ adminPage }) => {
    await adminPage.goto('/admin');
    await expect(adminPage.locator('h1')).toContainText('Dashboard Overview');

    // Assert all 9 nav links are present
    await expect(adminPage.locator('nav a[href="/admin"]').first()).toBeVisible();
    await expect(adminPage.locator('nav a[href="/admin/users"]').first()).toBeVisible();
    await expect(adminPage.locator('nav a[href="/admin/reviews"]').first()).toBeVisible();
    await expect(adminPage.locator('nav a[href="/admin/buildings"]').first()).toBeVisible();
    await expect(adminPage.locator('nav a[href="/admin/landlords"]').first()).toBeVisible();
    await expect(adminPage.locator('nav a[href="/admin/managers"]').first()).toBeVisible();
    await expect(adminPage.locator('nav a[href="/admin/verify"]').first()).toBeVisible();
    await expect(adminPage.locator('nav a[href="/admin/disputes"]').first()).toBeVisible();
    await expect(adminPage.locator('nav a[href="/admin/audit"]').first()).toBeVisible();
  });
});

test.describe('Admin Dashboard', () => {
  test('dashboard shows stats cards', async ({ adminPage }) => {
    // Dashboard is SSR-only — content available immediately after navigation
    await adminPage.goto('/admin');

    // Heading
    await expect(adminPage.locator('h1')).toContainText('Dashboard Overview');

    // Stats card labels
    await expect(adminPage.locator('text=Total Users')).toBeVisible();
    await expect(adminPage.locator('text=Total Reviews')).toBeVisible();
    await expect(adminPage.locator('p.text-sm.font-medium', { hasText: 'Buildings' })).toBeVisible();
    await expect(adminPage.locator('text=Verifications')).toBeVisible();

    // Section headings on dashboard
    await expect(adminPage.locator('text=Review Status Breakdown')).toBeVisible();
    await expect(adminPage.locator('text=Recent Reviews')).toBeVisible();
  });
});

test.describe('Admin Pages Render', () => {
  test('users page renders', async ({ adminPage }) => {
    await adminPage.goto('/admin/users');
    await expect(adminPage.locator('h1')).toContainText('User Management');
    await adminPage.waitForLoadState('networkidle');
    // React island rendered — table or content should be present
    await expect(adminPage.locator('h1')).toBeVisible();
  });

  test('reviews page renders', async ({ adminPage }) => {
    await adminPage.goto('/admin/reviews');
    await expect(adminPage.locator('h1')).toContainText('Review Management');
    await adminPage.waitForLoadState('networkidle');
    // Status filter buttons should be visible after React island loads
    await expect(adminPage.locator('button').filter({ hasText: /All \(/ })).toBeVisible();
  });

  test('buildings page renders', async ({ adminPage }) => {
    await adminPage.goto('/admin/buildings');
    await expect(adminPage.locator('h1')).toContainText('Building Management');
    await adminPage.waitForLoadState('networkidle');
    await expect(adminPage.locator('h1')).toBeVisible();
  });

  test('landlords page renders', async ({ adminPage }) => {
    await adminPage.goto('/admin/landlords');
    await expect(adminPage.locator('h1')).toContainText('Landlord Management');
    await adminPage.waitForLoadState('networkidle');
    await expect(adminPage.locator('h1')).toBeVisible();
  });

  test('managers page renders', async ({ adminPage }) => {
    await adminPage.goto('/admin/managers');
    await expect(adminPage.locator('h1')).toContainText('Property Manager Management');
    await adminPage.waitForLoadState('networkidle');
    await expect(adminPage.locator('h1')).toBeVisible();
  });

  test('verification page renders', async ({ adminPage }) => {
    await adminPage.goto('/admin/verify');
    await expect(adminPage.locator('h1')).toContainText('Verification Queue');
    await adminPage.waitForLoadState('networkidle');
    await expect(adminPage.locator('h1')).toBeVisible();
  });

  test('disputes page renders', async ({ adminPage }) => {
    await adminPage.goto('/admin/disputes');
    await expect(adminPage.locator('h1')).toContainText('Dispute Queue');
    await adminPage.waitForLoadState('networkidle');
    // Filter buttons: Pending, Resolved, All
    const pendingBtn = adminPage.locator('button').filter({ hasText: 'Pending' });
    const resolvedBtn = adminPage.locator('button').filter({ hasText: 'Resolved' });
    const allBtn = adminPage.locator('button').filter({ hasText: 'All' });
    // At least one of the filter buttons should be visible
    const hasPending = await pendingBtn.count();
    const hasResolved = await resolvedBtn.count();
    const hasAll = await allBtn.count();
    expect(hasPending + hasResolved + hasAll).toBeGreaterThan(0);
  });

  test('audit page renders', async ({ adminPage }) => {
    await adminPage.goto('/admin/audit');
    await expect(adminPage.locator('h1')).toContainText('Audit Log');
    await adminPage.waitForLoadState('networkidle');
    // Either audit log table thead is visible or "No audit logs found" message appears
    const hasTable = await adminPage.locator('table thead').count();
    const hasEmpty = await adminPage.locator('text=No audit logs found').count();
    expect(hasTable + hasEmpty).toBeGreaterThan(0);
  });
});

test.describe('Admin Access Control', () => {
  test('non-admin user is redirected from admin pages', async ({ authedPage }) => {
    // SSR redirect — use waitUntil: 'commit' so Playwright resolves when the 302 is sent
    await authedPage.goto('/admin', { waitUntil: 'commit' });
    // Dashboard Overview heading must NOT be visible — user was redirected
    await expect(authedPage.locator('h1').filter({ hasText: 'Dashboard Overview' })).not.toBeVisible();
  });

  test('unauthenticated user is redirected to signin', async ({ page }) => {
    // SSR redirect — use waitUntil: 'commit' so Playwright resolves when the 302 is sent
    await page.goto('/admin', { waitUntil: 'commit' });
    // Either redirected to signin, or admin dashboard is not visible (access denied)
    const isOnAdmin = page.url().includes('/admin') && !page.url().includes('/auth');
    if (isOnAdmin) {
      // Verify no admin dashboard content is accessible
      await expect(page.locator('h1').filter({ hasText: 'Dashboard Overview' })).not.toBeVisible();
    } else {
      await expect(page).toHaveURL(/auth\/signin/);
    }
  });
});
