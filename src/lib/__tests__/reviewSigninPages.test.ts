import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { describe, expect, it } from 'vitest';
import SigninPage from '../../pages/auth/signin.astro';
import SignupPage from '../../pages/auth/signup.astro';
import { REVIEW_SIGNIN_COPY } from '../reviewSignin';
import { createMemoryDatabase, sqliteAvailable, TestD1Database } from './helpers/sqliteD1';

// Someone sent to sign in by "Write a review" sees which building they are reviewing and who
// sees their name, and a "Create an account" button as plain as the sign-in form. The
// address comes only from a validated review-form return path; an unsafe one never names a
// building, and no other page gets the note.

const suite = sqliteAvailable ? describe : describe.skip;

const ADDRESS = '12 Example Rd';
const PLACE_LINE = REVIEW_SIGNIN_COPY.reviewing(`${ADDRESS}, Boston`);
const SENTINELS = ['SENTINEL-ADMIN-NOTE', 'SENTINEL-OWNER'];

function makeDb(): TestD1Database {
  const database = createMemoryDatabase();
  database.exec(`
    CREATE TABLE notifications (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, read_at INTEGER);
    CREATE TABLE buildings (id TEXT PRIMARY KEY, address TEXT NOT NULL, city TEXT, admin_notes TEXT, owner_name TEXT);
    INSERT INTO buildings (id, address, city, admin_notes, owner_name)
      VALUES ('b-1', '${ADDRESS}', 'Boston', 'SENTINEL-ADMIN-NOTE', 'SENTINEL-OWNER');
  `);
  return new TestD1Database(database);
}

function locals(withDb: boolean): App.Locals {
  return {
    user: null,
    session: null,
    ...(withDb ? { runtime: { env: { DB: makeDb() } } } : {}),
  } as unknown as App.Locals;
}

function mainFragment(html: string): HTMLDivElement {
  const match = html.match(/<main[^>]*>([\s\S]*?)<\/main>/);
  if (!match) throw new Error('Rendered page is missing <main>');
  const fragment = document.createElement('div');
  fragment.innerHTML = match[1];
  return fragment;
}

const PAGES = [
  { name: 'sign-in', Page: SigninPage, path: '/auth/signin' },
  { name: 'sign-up', Page: SignupPage, path: '/auth/signup' },
];

async function renderHtml(Page: typeof SigninPage, path: string, search: string, withDb = true): Promise<string> {
  const container = await AstroContainer.create();
  return container.renderToString(Page, {
    locals: locals(withDb),
    request: new Request(`https://ratemyplace.org${path}${search}`),
  });
}

const BUILDING_REDIRECT = '?redirect=' + encodeURIComponent('/review/new?building=b-1');

suite.each(PAGES)('$name page, arriving from Write a review', ({ Page, path }) => {
  it('names the building and says who sees the reviewer name', async () => {
    const html = await renderHtml(Page, path, BUILDING_REDIRECT);
    const main = mainFragment(html);
    const note = main.querySelector('[data-review-signin-note]');
    expect(note).not.toBeNull();
    expect(note?.querySelector('[data-review-place]')?.textContent?.trim()).toBe(PLACE_LINE);
    expect(note?.textContent).toContain(REVIEW_SIGNIN_COPY.privacy);
    for (const sentinel of SENTINELS) expect(html).not.toContain(sentinel);
  });

  it('shows only the privacy line when the review form names no building', async () => {
    for (const target of ['/review/new', '/review/new?placeId=abc', '/review/new?building=unknown-id']) {
      const main = mainFragment(await renderHtml(Page, path, '?redirect=' + encodeURIComponent(target)));
      const note = main.querySelector('[data-review-signin-note]');
      expect(note, target).not.toBeNull();
      expect(note?.querySelector('[data-review-place]'), target).toBeNull();
      expect(note?.textContent, target).toContain(REVIEW_SIGNIN_COPY.privacy);
      expect(main.textContent, target).not.toContain(ADDRESS);
    }
  });

  it('shows only the privacy line when there is no database to ask', async () => {
    const main = mainFragment(await renderHtml(Page, path, BUILDING_REDIRECT, false));
    expect(main.querySelector('[data-review-signin-note]')).not.toBeNull();
    expect(main.querySelector('[data-review-place]')).toBeNull();
  });

  it.each([
    ['%2F%2Fevil.example%2Freview%2Fnew%3Fbuilding%3Db-1'],
    ['%2F.%2F%2Fevil.example%2Freview%2Fnew%3Fbuilding%3Db-1'],
    ['%2F%252e%2F%2Fevil.example%2Freview%2Fnew%3Fbuilding%3Db-1'],
    ['https%3A%2F%2Fevil.example%2Freview%2Fnew%3Fbuilding%3Db-1'],
    ['%2Freview%2F..%2Freview%2Fnew%3Fbuilding%3Db-1'],
  ])('an unsafe redirect %s never renders an address or the note', async (encoded) => {
    const html = await renderHtml(Page, path, `?redirect=${encoded}`);
    expect(html).not.toContain(ADDRESS);
    expect(mainFragment(html).querySelector('[data-review-signin-note]')).toBeNull();
  });

  it('other return paths and no return path get no note', async () => {
    for (const search of ['', '?redirect=%2Fprofile', '?redirect=%2Freview%2Fedit%2Fabc']) {
      const main = mainFragment(await renderHtml(Page, path, search));
      expect(main.querySelector('[data-review-signin-note]'), search).toBeNull();
    }
  });
});

suite('sign-in page, arriving from Write a review', () => {
  it('leads with sign in or create, and one Create an account button that keeps the return path', async () => {
    const main = mainFragment(await renderHtml(SigninPage, '/auth/signin', BUILDING_REDIRECT));
    expect(main.querySelector('h1')?.textContent?.trim()).toBe(REVIEW_SIGNIN_COPY.heading);
    // Exactly one, so the e2e funnel's `main a[href^="/auth/signup?redirect="]` click stays unambiguous.
    const signupLinks = main.querySelectorAll('a[href^="/auth/signup"]');
    expect(signupLinks.length).toBe(1);
    expect(signupLinks[0].getAttribute('href')).toBe('/auth/signup' + BUILDING_REDIRECT);
    expect(signupLinks[0].textContent?.trim()).toBe(REVIEW_SIGNIN_COPY.createAccount);
    // As tall as the Sign in button (h-11, 44px).
    expect(signupLinks[0].getAttribute('class')).toContain('h-11');
    expect(main.textContent).toContain(REVIEW_SIGNIN_COPY.emailDivider);
  });

  it('keeps the usual heading and small link everywhere else', async () => {
    const main = mainFragment(await renderHtml(SigninPage, '/auth/signin', ''));
    expect(main.querySelector('h1')?.textContent?.trim()).toBe('Sign in to your account');
    const signupLinks = main.querySelectorAll('a[href^="/auth/signup"]');
    expect(signupLinks.length).toBe(1);
    expect(signupLinks[0].getAttribute('href')).toBe('/auth/signup');
    expect(signupLinks[0].textContent?.trim()).toBe('create a new account');
    expect(main.textContent).toContain('Or continue with email');
  });
});

describe('auth page spacing and tap targets', () => {
  it('sign-in leaves room under the header, as sign-up does', async () => {
    for (const { Page, path } of PAGES) {
      const main = mainFragment(await renderHtml(Page, path, '', false));
      expect(main.firstElementChild?.getAttribute('class'), path).toContain('py-12');
    }
  });

  it('the sign-up Terms and Privacy links are at least 24px tall (inline-block, 4px padding on a 20px line)', async () => {
    const main = mainFragment(await renderHtml(SignupPage, '/auth/signup', '', false));
    for (const href of ['/terms', '/privacy']) {
      const cls = main.querySelector(`a[href="${href}"]`)?.getAttribute('class') ?? '';
      expect(cls, href).toContain('inline-block');
      expect(cls, href).toContain('py-1');
    }
  });
});
