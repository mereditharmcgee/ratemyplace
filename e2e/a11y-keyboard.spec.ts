import type { Locator, Page } from '@playwright/test';
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

test.describe('batch 2: both address searches are comboboxes with a listbox popup', () => {
  // Matches nothing in the seed, so the routed fictional suggestion (FAKE_PREDICTIONS in
  // review-helpers.ts) is what answers. Addresses come after our own rows in both lists.
  const FICTIONAL_QUERY = '100 Example St';
  const HOME_LABEL = 'Search by address, neighborhood, or landlord';
  const REVIEW_LABEL = 'Search for your building address';
  const PLACES_DETAILS = /\/api\/places\/details(\?|$)/;

  /** Islands must be hydrated before typing, or React never sees the text. */
  async function hydrated(page: Page) {
    await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {});
    await page.waitForFunction(
      () => document.querySelectorAll('astro-island[ssr]:not([client="visible"])').length === 0,
      undefined,
      { timeout: 10_000 },
    );
  }

  test('home search: arrows, Escape to close then clear, Tab out, and Enter goes to the option', async ({ page }) => {
    await prepare(page, DESKTOP);
    await page.goto('/');
    await hydrated(page);

    const input = page.getByRole('combobox', { name: HOME_LABEL });
    const form = page.locator('form').filter({ has: input });
    const listbox = page.getByRole('listbox', { name: HOME_LABEL });
    const status = form.getByRole('status');
    await expect(input).toHaveAttribute('aria-expanded', 'false');
    await expect(status).toHaveText('');

    await input.fill(FICTIONAL_QUERY);
    await expect(listbox).toBeVisible({ timeout: 10_000 });
    await expect(input).toHaveAttribute('aria-expanded', 'true');
    await expect(input).toHaveAttribute('aria-controls', (await listbox.getAttribute('id')) ?? 'missing');
    await expect(status).toHaveText(/result/, { timeout: 10_000 });

    // ArrowDown names a visible option through aria-activedescendant; focus stays in the input.
    await input.press('ArrowDown');
    const activeId = await input.getAttribute('aria-activedescendant');
    expect(activeId).toBeTruthy();
    const active = page.locator(`[id="${activeId}"]`);
    await expect(active).toBeVisible();
    await expect(active).toHaveAttribute('role', 'option');
    await expect(active).toHaveAttribute('aria-selected', 'true');
    await expect(input).toBeFocused();

    // Escape closes, and a second Escape clears.
    await input.press('Escape');
    await expect(input).toHaveAttribute('aria-expanded', 'false');
    await expect(listbox).toHaveCount(0);
    await expect(input).toHaveValue(FICTIONAL_QUERY);
    await input.press('Escape');
    await expect(input).toHaveValue('');
    await expect(status).toHaveText('');

    // Tab closes the popup and moves on to Search; no option is a Tab stop.
    await input.fill(FICTIONAL_QUERY);
    await expect(listbox).toBeVisible({ timeout: 10_000 });
    await input.press('Tab');
    await expect(listbox).toHaveCount(0);
    await expect(form.getByRole('button', { name: 'Search', exact: true })).toBeFocused();

    // ArrowUp opens on the last option, the routed address; Enter starts a review for it.
    await input.focus();
    await expect(listbox).toBeVisible({ timeout: 10_000 });
    await input.press('ArrowUp');
    const lastId = await input.getAttribute('aria-activedescendant');
    await expect(page.locator(`[id="${lastId}"]`)).toContainText(FICTIONAL_QUERY);
    await input.press('Enter');
    // Signed out, the review form sends the reader to sign in with the handoff kept.
    await page.waitForURL((url) => url.pathname !== '/', { timeout: 15_000 });
    expect(decodeURIComponent(page.url())).toContain('placeId=e2e-a11y-place-1');
  });

  test('review address search: arrows, Escape to close then clear, Tab out, and Enter picks the place', async ({
    authedPage: page,
  }) => {
    await prepare(page, DESKTOP);
    // Registered after prepare(), so it wins: the routed suggestion resolves to a fictional
    // place, and picking it shows the selected-place card. GET /api/buildings only looks up.
    await page.route(PLACES_DETAILS, (route) =>
      route.fulfill({
        json: {
          place: {
            placeId: 'e2e-a11y-place-1',
            formattedAddress: '100 Example St, Boston, MA 02101, USA',
            streetAddress: '100 Example St',
            neighborhood: 'Downtown',
            city: 'Boston',
            state: 'MA',
            zipCode: '02101',
            latitude: 42.355,
            longitude: -71.06,
          },
        },
      }),
    );
    await page.goto('/review/new');
    await hydrated(page);

    const input = page.getByRole('combobox', { name: REVIEW_LABEL });
    const listbox = page.getByRole('listbox', { name: REVIEW_LABEL });
    const status = page.locator('[role="status"]').filter({ hasText: /result/ });
    await expect(input).toHaveAttribute('aria-expanded', 'false');

    await input.fill(FICTIONAL_QUERY);
    await expect(listbox).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText('Powered by Google')).toBeVisible({ timeout: 10_000 });
    await expect(status).toHaveCount(1, { timeout: 10_000 });
    // The attribution is outside the listbox; the manual-entry option is the last option.
    await expect(listbox.getByText('Powered by Google')).toHaveCount(0);
    await expect(listbox.getByRole('option').last()).toContainText('Enter it manually');

    await input.press('ArrowDown');
    const activeId = await input.getAttribute('aria-activedescendant');
    expect(activeId).toBeTruthy();
    await expect(page.locator(`[id="${activeId}"]`)).toBeVisible();
    await expect(page.locator(`[id="${activeId}"]`)).toHaveAttribute('aria-selected', 'true');

    await input.press('Escape');
    await expect(input).toHaveAttribute('aria-expanded', 'false');
    await expect(input).toHaveValue(FICTIONAL_QUERY);
    await input.press('Escape');
    await expect(input).toHaveValue('');

    // Tab closes the popup and lands on the clear button, not in the list.
    await input.fill(FICTIONAL_QUERY);
    await expect(listbox).toBeVisible({ timeout: 10_000 });
    await input.press('Tab');
    await expect(listbox).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Clear address' })).toBeFocused();

    // From the bottom: ArrowUp is manual entry, again is the routed address. Enter picks it.
    await input.focus();
    await expect(listbox).toBeVisible({ timeout: 10_000 });
    await input.press('ArrowUp');
    await input.press('ArrowUp');
    const pickId = await input.getAttribute('aria-activedescendant');
    await expect(page.locator(`[id="${pickId}"]`)).toContainText(FICTIONAL_QUERY);
    await input.press('Enter');
    const picked = page.locator('[aria-live="polite"]').filter({ hasText: 'This will be a new building in our system' });
    await expect(picked).toBeVisible({ timeout: 10_000 });
    await expect(picked).toContainText(FICTIONAL_QUERY);
  });
});

test.describe('batch 3: rating questions are native radio groups', () => {
  test('Tab enters a question on its first answer, arrows choose, and Tab leaves the question', async ({
    authedPage: page,
  }) => {
    await prepare(page, DESKTOP);
    // building-30 is a seed building; nothing here is submitted.
    await page.goto('/review/new?building=building-30');
    await page.locator('#review-bedrooms').waitFor({ timeout: 15_000 });
    await page.waitForFunction(
      () => document.querySelectorAll('astro-island[ssr]:not([client="visible"])').length === 0,
      undefined,
      { timeout: 10_000 },
    );
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.getByRole('heading', { name: 'Rate Your Unit' }).waitFor();

    const first = page.getByRole('radiogroup').first();
    await expect(first.getByRole('radio', { checked: true })).toHaveCount(0);

    // Tab from wherever focus is until it reaches a radio.
    let reached = false;
    for (let i = 0; i < 60 && !reached; i++) {
      await page.keyboard.press('Tab');
      reached = await page.evaluate(() => (document.activeElement as HTMLInputElement | null)?.type === 'radio');
    }
    expect(reached).toBe(true);

    // Nothing is answered, so the group's Tab stop is its first answer, unchecked.
    const one = first.getByRole('radio', { name: '1', exact: true });
    await expect(one).toBeFocused();
    await expect(one).not.toBeChecked();

    // Arrow keys move and choose within the question.
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    const three = first.getByRole('radio', { name: '3', exact: true });
    await expect(three).toBeChecked();
    await expect(three).toBeFocused();
    await expect(first.getByRole('radio', { checked: true })).toHaveCount(1);

    // The focused pill shows the keyboard outline, taken from its hidden radio. The pill's
    // transition-all eases the outline in, so wait for it to settle.
    await expect
      .poll(() =>
        three.evaluate((radio) => {
          const style = getComputedStyle(radio.nextElementSibling as Element);
          return { width: style.outlineWidth, style: style.outlineStyle };
        }),
      )
      .toEqual({ width: '2px', style: 'solid' });

    // One Tab stop per question: Tab leaves the group, Shift+Tab comes back to the answer.
    await page.keyboard.press('Tab');
    expect(await first.evaluate((group) => group.contains(document.activeElement))).toBe(false);
    await page.keyboard.press('Shift+Tab');
    await expect(three).toBeFocused();
  });
});

test.describe('batch 4: review steps move focus to their heading, and the progress row fits', () => {
  // building-30 is a seed building; the form opens at unit details. Nothing here is submitted.
  async function openUnitDetails(page: Page) {
    await page.goto('/review/new?building=building-30');
    await page.locator('#review-bedrooms').waitFor({ timeout: 15_000 });
    await page.waitForFunction(
      () => document.querySelectorAll('astro-island[ssr]:not([client="visible"])').length === 0,
      undefined,
      { timeout: 10_000 },
    );
  }

  const stepHeading = (page: Page, name: string) => page.getByRole('heading', { level: 2, name, exact: true });

  test('Continue and Back by keyboard move focus to the new step heading', async ({ authedPage: page }) => {
    await prepare(page, DESKTOP);
    await openUnitDetails(page);

    // Continue sits at the foot of the long unit details step.
    await page.getByRole('button', { name: 'Continue', exact: true }).focus();
    await page.keyboard.press('Enter');
    await expect(stepHeading(page, 'Step 3 of 7: Your Unit')).toBeFocused();
    // The new step starts on screen, not down where Continue was.
    await expect(page.getByRole('list', { name: 'Review progress' })).toBeInViewport();
    await expect(page.getByRole('heading', { name: 'Rate Your Unit' })).toBeInViewport();

    await page.getByRole('button', { name: 'Back', exact: true }).focus();
    await page.keyboard.press('Space');
    await expect(stepHeading(page, 'Step 2 of 7: Unit Details')).toBeFocused();
  });

  // Before this batch the desktop row ran 215, 87 and 7px past the 704px form column.
  for (const viewport of [
    { width: 1024, height: 768 },
    { width: 1280, height: 900 },
    { width: 1440, height: 900 },
  ]) {
    test(`every step from unit details to confirm fits ${viewport.width}px with no sideways scroll`, async ({
      authedPage: page,
    }) => {
      test.setTimeout(60_000);
      await prepare(page, viewport);
      await openUnitDetails(page);
      const progress = page.getByRole('list', { name: 'Review progress' });

      const steps = [
        { title: 'Unit Details', number: 2, next: 'Continue' },
        { title: 'Your Unit', number: 3, next: 'Continue' },
        { title: 'Building', number: 4, next: 'Continue' },
        { title: 'Landlord', number: 5, next: 'Continue' },
        { title: 'Additional', number: 6, next: 'Review & Submit' },
        { title: 'Submit', number: 7, next: null },
      ];
      for (const step of steps) {
        const label = `step ${step.number} at ${viewport.width}px`;
        await expect(stepHeading(page, `Step ${step.number} of 7: ${step.title}`)).toBeAttached();
        await expect(progress).toBeVisible();
        await expect(progress.locator('li[aria-current="step"]')).toContainText(step.title);

        const widths = await page.evaluate(() => {
          const doc = document.documentElement;
          const list = document.querySelector('ol[aria-label="Review progress"]') as HTMLElement;
          return {
            page: { scroll: doc.scrollWidth, client: doc.clientWidth },
            list: { scroll: list.scrollWidth, client: list.clientWidth },
          };
        });
        expect(widths.page.scroll, label).toBeLessThanOrEqual(widths.page.client);
        expect(widths.list.scroll, label).toBeLessThanOrEqual(widths.list.client);

        if (step.next) await page.getByRole('button', { name: step.next, exact: true }).click();
      }
    });
  }
});

test.describe('batch 5: the verification dialog traps focus, closes on Escape and returns focus', () => {
  // Nothing is uploaded: the dialog is opened and closed by keyboard only.
  const DIALOG_NAME = 'Verify Your Tenancy';
  const TAB_PRESSES = 15;

  const focusInDialog = (page: Page) => page.evaluate(() => !!document.activeElement?.closest('dialog'));

  async function hydrated(page: Page) {
    await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {});
    await page.waitForFunction(
      () => document.querySelectorAll('astro-island[ssr]:not([client="visible"])').length === 0,
      undefined,
      { timeout: 10_000 },
    );
  }

  /** Open from `opener` by keyboard, Tab around inside, Escape, and check focus came back. */
  async function exercise(page: Page, opener: Locator) {
    await opener.focus();
    await page.keyboard.press('Enter');

    const dialog = page.getByRole('dialog', { name: DIALOG_NAME });
    await expect(dialog).toBeVisible();
    // Focus starts on the file input, so a file can be chosen at once.
    await expect
      .poll(() => page.evaluate(() => (document.activeElement as HTMLInputElement | null)?.type))
      .toBe('file');
    await expect(dialog.getByRole('button', { name: 'Close', exact: true })).toBeVisible();

    const visited = new Set<string>();
    for (let i = 0; i < TAB_PRESSES; i++) {
      await page.keyboard.press('Tab');
      expect(await focusInDialog(page), `Tab ${i + 1} stays in the dialog`).toBe(true);
      visited.add(await page.evaluate(() => document.activeElement?.outerHTML.slice(0, 80) ?? ''));
    }
    // Close, the file input and Cancel; Submit is disabled until a file is chosen.
    expect(visited.size).toBeGreaterThanOrEqual(3);
    for (let i = 0; i < 4; i++) {
      await page.keyboard.press('Shift+Tab');
      expect(await focusInDialog(page), `Shift+Tab ${i + 1} stays in the dialog`).toBe(true);
    }

    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(opener).toBeFocused();
  }

  test('from Verify Now on the building page after a submit', async ({ authedPage: page }) => {
    await prepare(page, DESKTOP);
    const slug = seedBuildingSlug(BUILDING_ID);
    await page.goto(`/building/${slug}?submitted=true&reviewId=${SEED_REVIEW_ID}`);
    await hydrated(page);
    await exercise(page, page.getByRole('button', { name: 'Verify Now', exact: true }));
  });

  test('from Verify in the profile review list', async ({ authedPage: page }) => {
    await prepare(page, DESKTOP);
    await page.goto('/profile');
    await hydrated(page);
    const verify = page.getByRole('button', { name: 'Verify', exact: true }).first();
    await verify.waitFor();
    await exercise(page, verify);
  });

  test('at 375px the dialog fits the screen and still returns focus', async ({ authedPage: page }) => {
    await prepare(page, MOBILE);
    const slug = seedBuildingSlug(BUILDING_ID);
    await page.goto(`/building/${slug}?submitted=true&reviewId=${SEED_REVIEW_ID}`);
    await hydrated(page);
    const opener = page.getByRole('button', { name: 'Verify Now', exact: true });
    await opener.focus();
    await page.keyboard.press('Enter');
    const dialog = page.getByRole('dialog', { name: DIALOG_NAME });
    await expect(dialog).toBeVisible();
    const box = await dialog.boundingBox();
    expect(box?.x ?? -1).toBeGreaterThanOrEqual(0);
    expect((box?.x ?? 0) + (box?.width ?? 1000)).toBeLessThanOrEqual(MOBILE.width);
    expect((box?.y ?? 0) + (box?.height ?? 1000)).toBeLessThanOrEqual(MOBILE.height);
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(opener).toBeFocused();
  });
});
