import type { APIContext } from 'astro';
import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import reactRenderer from '@astrojs/react/server.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeD1 } from './helpers/fakeD1';
import { schemaDb } from './helpers/migratedDb';
import { sqliteAvailable, type TestD1Database } from './helpers/sqliteD1';

// An account without a verified email sees the email verification step on both review
// pages, in place of the form: no island, no Turnstile, no Places call, no limiter row, no
// building write, and on the edit page no review read. Verified accounts see the pages as
// before (reviewNewPage.test.ts and authRedirectPages.test.ts cover them).

vi.mock('../places', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../places')>()),
  fetchPlaceDetails: vi.fn(async () => null),
}));

vi.mock('../tokens', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../tokens')>()),
  createVerificationToken: vi.fn(async () => 'tok'),
}));

vi.mock('../email', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../email')>()),
  sendVerificationEmail: vi.fn(async () => ({ success: true })),
}));

import { fetchPlaceDetails } from '../places';
import { createVerificationToken } from '../tokens';
import { EMAIL_ALREADY_VERIFIED, EMAIL_GATE_COPY } from '../contributionCopy';
import { REVIEW_SIGNIN_COPY } from '../reviewSignin';
import ReviewNewPage from '../../pages/review/new.astro';
import ReviewEditPage from '../../pages/review/edit/[id].astro';
import { POST as resendPOST } from '../../pages/api/auth/resend-verification';

const suite = sqliteAvailable ? describe : describe.skip;

const UNVERIFIED = { id: 'u-1', email: 'tenant@example.com', emailVerified: false, isAdmin: false };

function locals(db: unknown, user: unknown = UNVERIFIED): App.Locals {
  return { user, session: { id: 's-1' }, runtime: { env: { DB: db } } } as unknown as App.Locals;
}

async function createContainer(): Promise<AstroContainer> {
  const container = await AstroContainer.create();
  container.addServerRenderer({ renderer: reactRenderer });
  container.addClientRenderer({ name: '@astrojs/react', entrypoint: '@astrojs/react/client.js' });
  return container;
}

async function renderNew(db: unknown, search: string): Promise<Response> {
  const container = await createContainer();
  return container.renderToResponse(ReviewNewPage, {
    request: new Request(`https://ratemyplace.org/review/new${search}`),
    locals: locals(db),
    partial: false,
  });
}

async function seeded(): Promise<TestD1Database> {
  const db = schemaDb();
  await db
    .prepare("INSERT INTO buildings (id, address, slug, city, state) VALUES ('b-1', '12 Example Rd', '12-example-rd-boston', 'Boston', 'MA')")
    .run();
  return db;
}

async function count(db: TestD1Database, table: string): Promise<number> {
  const row = await db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first<{ n: number }>();
  return row?.n ?? -1;
}

/** The gate's section, parsed, so text compares after HTML unescaping. */
function gate(html: string): HTMLElement {
  const root = document.createElement('div');
  root.innerHTML = html.match(/<main[^>]*>([\s\S]*?)<\/main>/)?.[1] ?? '';
  const section = root.querySelector<HTMLElement>('[data-email-verification-gate]');
  if (!section) throw new Error('no email verification step on the page');
  return section;
}

function texts(section: HTMLElement): string[] {
  return [...section.querySelectorAll('h2, p, button')].map((el) => (el.textContent ?? '').trim());
}

function expectNoForm(html: string): void {
  expect(html).not.toContain('astro-island');
  expect(html).not.toContain('ReviewForm');
  expect(html).not.toContain('ReviewEditForm');
  expect(html).not.toContain('challenges.cloudflare.com');
  expect(html).not.toContain('data-rmp-turnstile-guard');
}

beforeEach(() => {
  vi.mocked(fetchPlaceDetails).mockClear();
  vi.mocked(createVerificationToken).mockClear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

suite('/review/new for an unverified account', () => {
  it('?building= names the building and shows the step instead of the form', async () => {
    const db = await seeded();
    const response = await renderNew(db, '?building=b-1');
    expect(response.status).toBe(200);
    const html = await response.text();
    expectNoForm(html);

    const section = gate(html);
    expect(section.getAttribute('aria-labelledby')).toBeTruthy();
    expect(section.querySelector('h2')?.id).toBe(section.getAttribute('aria-labelledby'));
    expect(texts(section)).toEqual([
      EMAIL_GATE_COPY.heading,
      REVIEW_SIGNIN_COPY.reviewing('12 Example Rd, Boston'),
      EMAIL_GATE_COPY.why,
      EMAIL_GATE_COPY.residencyNote,
      EMAIL_GATE_COPY.resend,
      '',
    ]);
    const status = section.querySelector('[role="status"]');
    expect(status).not.toBeNull();
    expect(status?.hasAttribute('data-email-gate-status')).toBe(true);
    const button = section.querySelector('button');
    expect(button?.getAttribute('type')).toBe('button');
    expect(button?.hasAttribute('data-email-gate-resend')).toBe(true);
  });

  it("never shows the account's email address", async () => {
    const html = await (await renderNew(await seeded(), '?building=b-1')).text();
    expect(gate(html).innerHTML).not.toContain('tenant@example.com');
  });

  it('?placeId= shows the step with no building line, calls no Places API and writes nothing', async () => {
    const db = await seeded();
    const before = await count(db, 'buildings');
    const html = await (await renderNew(db, '?placeId=gp-test')).text();
    expectNoForm(html);
    const section = gate(html);
    expect(texts(section)).not.toContain(REVIEW_SIGNIN_COPY.reviewing('12 Example Rd, Boston'));
    expect(section.textContent).not.toContain("You're reviewing");
    expect(fetchPlaceDetails).not.toHaveBeenCalled();
    expect(await count(db, 'rate_limits')).toBe(0);
    expect(await count(db, 'buildings')).toBe(before);
  });

  it('a bare /review/new shows the step with no building line', async () => {
    const html = await (await renderNew(await seeded(), '')).text();
    expectNoForm(html);
    expect(gate(html).textContent).not.toContain("You're reviewing");
  });

  it('?building= for an unknown id shows the step with no building line and no not-found banner', async () => {
    const html = await (await renderNew(await seeded(), '?building=missing')).text();
    expectNoForm(html);
    expect(gate(html).textContent).not.toContain("You're reviewing");
  });

  it('the step reads nothing but the building label', async () => {
    const { db, calls } = fakeD1((call) =>
      call.sql.includes('FROM buildings') ? { address: '12 Example Rd', city: 'Boston' } : undefined,
    );
    await renderNew(db, '?building=b-1&partOf=1');
    // The header's unread-notification count is the layout's, not the page's.
    const pageCalls = calls.filter((call) => !call.sql.includes('FROM notifications'));
    expect(pageCalls.map((call) => call.sql)).toEqual(['SELECT address, city FROM buildings WHERE id = ?']);
    expect(calls.every((call) => call.method !== 'run')).toBe(true);
  });

  it('no inline handlers, and the button uses the teal-700 focus ring', async () => {
    const html = await (await renderNew(await seeded(), '?building=b-1')).text();
    const section = gate(html);
    expect(section.outerHTML).not.toMatch(/\son[a-z]+\s*=/i);
    const classes = section.querySelector('button')?.className ?? '';
    expect(classes).toContain('focus:ring-teal-700');
    expect(classes).not.toMatch(/ring-teal-(400|500)/);
  });

  it('a signed-out visitor is still sent to sign in first', async () => {
    const container = await createContainer();
    const response = await container.renderToResponse(ReviewNewPage, {
      request: new Request('https://ratemyplace.org/review/new?building=b-1'),
      locals: locals(await seeded(), null),
      partial: false,
    });
    expect(response.status).toBe(302);
    expect(response.headers.get('Location')).toBe('/auth/signin?redirect=%2Freview%2Fnew%3Fbuilding%3Db-1');
  });
});

describe('/review/edit/[id] for an unverified account', () => {
  it('shows the step and reads no review', async () => {
    const { db, calls } = fakeD1(() => undefined);
    const container = await createContainer();
    const response = await container.renderToResponse(ReviewEditPage, {
      locals: locals(db),
      params: { id: 'r-1' },
      request: new Request('https://ratemyplace.org/review/edit/r-1'),
    });
    expect(response.status).toBe(200);
    const html = await response.text();
    expectNoForm(html);
    expect(html).not.toContain('review-edit-bedrooms');
    const section = gate(html);
    expect(texts(section)).toEqual([
      EMAIL_GATE_COPY.heading,
      EMAIL_GATE_COPY.why,
      EMAIL_GATE_COPY.residencyNote,
      EMAIL_GATE_COPY.resend,
      '',
    ]);
    // The header's unread-notification count is the layout's; the page itself runs nothing.
    expect(calls.filter((call) => !call.sql.includes('FROM notifications'))).toEqual([]);
  });
});

describe('the resend route tells the step an account is already verified', () => {
  function context(user: unknown): APIContext {
    const url = new URL('https://ratemyplace.org/api/auth/resend-verification');
    const { db } = fakeD1(() => undefined);
    return {
      request: new Request(url, { method: 'POST', headers: { 'CF-Connecting-IP': '203.0.113.40' } }),
      url,
      params: {},
      locals: { user, runtime: { env: { DB: db, SITE_URL: 'https://ratemyplace.org' } } },
    } as unknown as APIContext;
  }

  it('a verified account gets the existing 400 with a reason', async () => {
    const res = await resendPOST(context({ ...UNVERIFIED, emailVerified: true }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'Email already verified', details: { reason: EMAIL_ALREADY_VERIFIED } });
    expect(createVerificationToken).not.toHaveBeenCalled();
  });

  it('an unverified account still gets 200 and one new link', async () => {
    const res = await resendPOST(context(UNVERIFIED));
    expect(res.status).toBe(200);
    expect(createVerificationToken).toHaveBeenCalledTimes(1);
  });
});

describe('the residency line', () => {
  it('renders once, right below the why line', async () => {
    const { db } = fakeD1(() => undefined);
    const container = await createContainer();
    const html = await (
      await container.renderToResponse(ReviewEditPage, {
        locals: locals(db),
        params: { id: 'r-1' },
        request: new Request('https://ratemyplace.org/review/edit/r-1'),
      })
    ).text();
    const paragraphs = [...gate(html).querySelectorAll('p')].map((p) => (p.textContent ?? '').trim());
    expect(paragraphs.filter((text) => text === EMAIL_GATE_COPY.residencyNote)).toHaveLength(1);
    expect(paragraphs.indexOf(EMAIL_GATE_COPY.residencyNote)).toBe(paragraphs.indexOf(EMAIL_GATE_COPY.why) + 1);
  });

  it('if it were ever empty, the step would render no empty paragraph for it', async () => {
    vi.resetModules();
    vi.doMock('../contributionCopy', async (importOriginal) => {
      const actual = await importOriginal<typeof import('../contributionCopy')>();
      return { ...actual, EMAIL_GATE_COPY: { ...actual.EMAIL_GATE_COPY, residencyNote: '' } };
    });
    try {
      const { default: Page } = await import('../../pages/review/edit/[id].astro');
      const { db } = fakeD1(() => undefined);
      const container = await createContainer();
      const html = await (
        await container.renderToResponse(Page, {
          locals: locals(db),
          params: { id: 'r-1' },
          request: new Request('https://ratemyplace.org/review/edit/r-1'),
        })
      ).text();
      const paragraphs = [...gate(html).querySelectorAll('p')].map((p) => (p.textContent ?? '').trim());
      expect(paragraphs).toEqual([EMAIL_GATE_COPY.why, '']);
    } finally {
      vi.doUnmock('../contributionCopy');
      vi.resetModules();
    }
  });
});
