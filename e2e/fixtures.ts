import { test as base, expect } from '@playwright/test';
import path from 'path';
import { fileURLToPath } from 'url';
import { executeLocalD1, installTurnstileStub } from './test-harness';

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
