import { test as base, expect } from '@playwright/test';
import path from 'path';
import { fileURLToPath } from 'url';
import { executeLocalD1, installTurnstileStub } from './test-harness';
import { REVIEW_DAILY_WINDOW_SECONDS } from '../src/lib/reviewLimits';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const USER_AUTH_FILE = path.join(__dirname, '../playwright/.auth/user.json');
const ADMIN_AUTH_FILE = path.join(__dirname, '../playwright/.auth/admin.json');

type CustomFixtures = {
  authedPage: import('@playwright/test').Page;
  adminPage: import('@playwright/test').Page;
};

export const test = base.extend<CustomFixtures>({
  page: async ({ page }, use) => {
    await installTurnstileStub(page);
    await use(page);
  },
  authedPage: async ({ browser }, use) => {
    const context = await browser.newContext({
      storageState: USER_AUTH_FILE,
    });
    const page = await context.newPage();
    await installTurnstileStub(page);
    await use(page);
    await context.close();
  },
  adminPage: async ({ browser }, use) => {
    const context = await browser.newContext({
      storageState: ADMIN_AUTH_FILE,
    });
    const page = await context.newPage();
    await installTurnstileStub(page);
    await use(page);
    await context.close();
  },
});

export { expect };

// --- DB Helpers ---

/**
 * Clear all rate-limit rows from local D1.
 * Used by specs that exercise rate-limited endpoints to keep tests deterministic.
 * Always operates on --local (no params); remote support is YAGNI.
 */
export function clearRateLimits(): void {
  executeLocalD1('DELETE FROM rate_limits');
}

/** The seed account `authedPage` signs in as (`scripts/db-seed.ts`). */
const E2E_ACCOUNT_ID = 'user-test-01';

/**
 * Delete the e2e account's reviews written in the last 24 hours, and their audit rows.
 * Seed reviews carry fixed 2023 and 2024 timestamps, so this removes only what the suite
 * wrote. It clears the one-review-per-building rule, the pause and the daily count for the
 * account (src/lib/reviewLimits.ts), so a spec can submit, and open the form on a building,
 * whatever ran before it. Local D1 only; constants only in the SQL.
 */
export function resetE2eAccountReviews(): void {
  const recent =
    `SELECT id FROM reviews WHERE user_id = '${E2E_ACCOUNT_ID}' ` +
    `AND created_at > unixepoch() - ${REVIEW_DAILY_WINDOW_SECONDS}`;
  executeLocalD1(`DELETE FROM audit_logs WHERE entity_id IN (${recent}); DELETE FROM reviews WHERE id IN (${recent})`);
}
