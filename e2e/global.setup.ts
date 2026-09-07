import { test as setup } from './fixtures';
import { mkdir } from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const AUTH_DIR = path.join(__dirname, '../playwright/.auth');
const USER_AUTH_FILE = path.join(AUTH_DIR, 'user.json');
const ADMIN_AUTH_FILE = path.join(AUTH_DIR, 'admin.json');

setup('create auth directory', async () => {
  await mkdir(AUTH_DIR, { recursive: true });
});

setup('sign in as regular user', async ({ page }) => {
  await page.goto('/auth/signin');
  await page.fill('input[name="email"]', 'user@test.ratemyplace.local');
  await page.fill('input[name="password"]', 'TestPassword123!');
  await page.click('button[type="submit"]');
  await page.waitForURL('/');
  await page.context().storageState({ path: USER_AUTH_FILE });
});

setup('sign in as admin', async ({ page }) => {
  await page.goto('/auth/signin');
  await page.fill('input[name="email"]', 'admin@test.ratemyplace.local');
  await page.fill('input[name="password"]', 'TestPassword123!');
  await page.click('button[type="submit"]');
  await page.waitForURL('/');
  await page.context().storageState({ path: ADMIN_AUTH_FILE });
});
