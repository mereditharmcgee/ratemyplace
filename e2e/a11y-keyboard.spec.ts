import type { Page } from '@playwright/test';
import { test, expect } from './fixtures';
import { executeLocalD1 } from './test-harness';
import { prepare } from './review-helpers';

// Phase 28 keyboard checks that axe cannot make: where focus goes and what state a control
// reports when it is used from the keyboard. Each Phase 28 batch appends its own describe block.
//
// Local only, like every spec here (e2e is not in CI). prepare() refuses Google and routes the
// Places proxies to one fictional suggestion; Turnstile is the e2e stub. Nothing here writes to
// the database.

const DESKTOP = { width: 1280, height: 900 };
const MOBILE = { width: 375, height: 812 };

// Seed data (scripts/db-seed.ts): building-01 has reviews, review-001 belongs to the seed user.
const BUILDING_ID = 'building-01';
const SEED_REVIEW_ID = 'review-001';

function seedBuildingSlug(id: string): string {
  const rows = JSON.parse(executeLocalD1(`SELECT slug FROM buildings WHERE id = '${id}'`));
  const slug = rows?.[0]?.results?.[0]?.slug;
  if (typeof slug !== 'string') throw new Error(`seed building ${id} not found; run npm run db:setup`);
  return slug;
}

async function activeElement(page: Page) {
  return page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null;
    return {
      tag: el?.tagName ?? null,
      id: el?.id ?? '',
      text: el?.textContent?.trim() ?? '',
      href: el?.getAttribute('href') ?? null,
    };
  });
}

test.describe('batch 1: skip link, focus indicator, mobile menu, banner dismiss', () => {
  test('the first Tab reaches a visible skip link, and Enter moves focus to main', async ({ page }) => {
    await prepare(page, DESKTOP);
    await page.goto('/');
    await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {});

    await page.keyboard.press('Tab');
    const skip = page.getByRole('link', { name: 'Skip to main content' });
    await expect(skip).toBeFocused();
    const box = await skip.boundingBox();
    expect(box?.width ?? 0).toBeGreaterThan(1);
    expect(box?.height ?? 0).toBeGreaterThan(1);
    // It overlays the page rather than pushing the header down.
    expect(await skip.evaluate((el) => getComputedStyle(el).position)).toBe('absolute');

    await page.keyboard.press('Enter');
    await expect.poll(async () => (await activeElement(page)).id).toBe('main-content');

    // The next Tab continues from main, past the header.
    await page.keyboard.press('Tab');
    const next = await activeElement(page);
    expect(next.id).not.toBe('main-content');
    expect(await page.evaluate(() => !!document.activeElement?.closest('main'))).toBe(true);
  });

  test('keyboard focus shows a teal outline on the page and a white one on the footer', async ({ page }) => {
    await prepare(page, DESKTOP);
    await page.goto('/search');

    const outline = (selector: string) =>
      page.locator(selector).first().evaluate((el) => {
        const style = getComputedStyle(el);
        return { width: style.outlineWidth, style: style.outlineStyle, color: style.outlineColor };
      });

    // Reach each link by keyboard so :focus-visible applies: focus the control before it, then Tab.
    await page.locator('form[action="/search"] button[type="submit"]').focus();
    await page.keyboard.press('Shift+Tab');
    await page.keyboard.press('Tab');
    const onPage = await outline('form[action="/search"] button[type="submit"]');
    expect(onPage.style).toBe('solid');
    expect(onPage.width).toBe('2px');
    expect(onPage.color).not.toBe('rgb(255, 255, 255)');

    const footerLinks = page.locator('footer a');
    await footerLinks.nth(1).focus();
    await page.keyboard.press('Shift+Tab');
    const inFooter = await footerLinks.first().evaluate((el) => {
      const style = getComputedStyle(el);
      return { width: style.outlineWidth, style: style.outlineStyle, color: style.outlineColor, focused: el === document.activeElement };
    });
    expect(inFooter.focused).toBe(true);
    expect(inFooter.style).toBe('solid');
    expect(inFooter.width).toBe('2px');
    expect(inFooter.color).toBe('rgb(255, 255, 255)');
  });

  test('the mobile menu button reports its state, and Escape closes the menu and returns focus', async ({ page }) => {
    await prepare(page, MOBILE);
    await page.goto('/');
    await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {});

    const button = page.locator('#mobile-menu-button');
    const menu = page.locator('#mobile-menu');
    await expect(button).toHaveAttribute('aria-expanded', 'false');
    await expect(button).toHaveAttribute('aria-controls', 'mobile-menu');
    await expect(menu).toBeHidden();

    // Open and close by keyboard.
    await button.focus();
    await page.keyboard.press('Enter');
    await expect(button).toHaveAttribute('aria-expanded', 'true');
    await expect(menu).toBeVisible();
    await page.keyboard.press('Enter');
    await expect(button).toHaveAttribute('aria-expanded', 'false');
    await expect(menu).toBeHidden();

    // Open, move into the menu, and Escape: closed, and focus is back on the button.
    await page.keyboard.press('Space');
    await expect(button).toHaveAttribute('aria-expanded', 'true');
    await page.keyboard.press('Tab');
    expect(await page.evaluate(() => !!document.activeElement?.closest('#mobile-menu'))).toBe(true);
    await page.keyboard.press('Escape');
    await expect(menu).toBeHidden();
    await expect(button).toHaveAttribute('aria-expanded', 'false');
    await expect(button).toBeFocused();
  });

  test('closing the submitted banner by keyboard moves focus to the page heading', async ({ authedPage: page }) => {
    await prepare(page, DESKTOP);
    const slug = seedBuildingSlug(BUILDING_ID);
    await page.goto(`/building/${slug}?submitted=true&reviewId=${SEED_REVIEW_ID}`);
    await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {});

    const banner = page.locator('#submitted-banner');
    await expect(banner).toBeVisible();
    const close = banner.getByRole('button', { name: 'Close', exact: true });
    await close.focus();
    await page.keyboard.press('Enter');

    await expect(banner).toHaveCount(0);
    const heading = page.locator('main h1');
    await expect(heading).toBeFocused();
    await expect(heading).toHaveAttribute('tabindex', '-1');
  });

  test('closing the profile updated banner by keyboard moves focus to main', async ({ authedPage: page }) => {
    await prepare(page, DESKTOP);
    await page.goto('/profile?updated=true');
    await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {});

    const banner = page.locator('#updated-banner');
    await expect(banner).toBeVisible();
    await banner.getByRole('button', { name: 'Close', exact: true }).focus();
    await page.keyboard.press('Space');

    await expect(banner).toHaveCount(0);
    // The profile page has no h1, so focus goes to main.
    await expect.poll(async () => (await activeElement(page)).id).toBe('main-content');
  });
});
