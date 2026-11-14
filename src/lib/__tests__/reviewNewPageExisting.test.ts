import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import reactRenderer from '@astrojs/react/server.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ReviewNewPage from '../../pages/review/new.astro';
import { HANDOFF_COPY } from '../reviewHandoff';
import { REVIEW_LIMIT_COPY } from '../reviewLimits';
import { schemaDb } from './helpers/migratedDb';
import { sqliteAvailable, type TestD1Database } from './helpers/sqliteD1';

/**
 * /review/new?building=<id> asks, read only, whether the signed-in account already has a
 * review of the building. When it does, the page shows that review's edit link instead of the
 * form, and loads neither the form island nor Turnstile. A failed check falls back to the form:
 * the guard in POST /api/reviews stays the authority.
 */

const suite = sqliteAvailable ? describe : describe.skip;

let consoleError: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

function loggedEvents(): string[] {
  return consoleError.mock.calls.flatMap((args: unknown[]) => {
    if (typeof args[0] !== 'string') return [];
    try {
      const parsed = JSON.parse(args[0]) as { event?: unknown };
      return typeof parsed.event === 'string' ? [parsed.event] : [];
    } catch {
      return [];
    }
  });
}

async function fresh(): Promise<TestD1Database> {
  const db = schemaDb();
  await db.prepare("INSERT INTO users (id, email, email_verified) VALUES ('u1', 'tenant1@example.com', 1), ('u2', 'tenant2@example.com', 1)").run();
  await db
    .prepare(
      `INSERT INTO buildings (id, address, slug, city, state) VALUES
         ('b1', '12 Example Rd', '12-example-rd-boston', 'Boston', 'MA'),
         ('b2', '14 Example Rd', '14-example-rd-boston', 'Boston', 'MA')`,
    )
    .run();
  return db;
}

async function insertReview(db: TestD1Database, id: string, userId: string, buildingId: string, secondsAgo = 3_600): Promise<void> {
  await db
    .prepare(
      `INSERT INTO reviews (id, user_id, building_id, move_in_year, move_in_season, unit_type, overall_score, status, created_at)
       VALUES (?, ?, ?, 2022, 'fall', '1br', 4, 'pending', unixepoch() - ?)`,
    )
    .bind(id, userId, buildingId, secondsAgo)
    .run();
}

async function render(db: unknown, search: string): Promise<string> {
  const container = await AstroContainer.create();
  container.addServerRenderer({ renderer: reactRenderer });
  container.addClientRenderer({ name: '@astrojs/react', entrypoint: '@astrojs/react/client.js' });
  return container.renderToString(ReviewNewPage, {
    request: new Request(`https://ratemyplace.org/review/new${search}`),
    locals: {
      user: { id: 'u1', email: 'tenant1@example.com', emailVerified: true, isAdmin: false },
      session: { id: 's-1' },
      runtime: { env: { DB: db } },
    } as unknown as App.Locals,
    partial: false,
  });
}

function hasFormIsland(html: string): boolean {
  return /<astro-island[^>]*component-url="[^"]*ReviewForm/.test(html);
}

function hasTurnstile(html: string): boolean {
  return html.includes('challenges.cloudflare.com/turnstile') || html.includes('data-rmp-turnstile-guard');
}

/** The href of each <a> whose whole text is `text`. */
function linksNamed(html: string, text: string): string[] {
  const hrefs: string[] = [];
  for (const match of html.matchAll(/<a\b[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/g)) {
    if (match[2].replace(/<[^>]*>/g, '').trim() === text) hrefs.push(match[1]);
  }
  return hrefs;
}

suite('/review/new with an existing review of the building', () => {
  it('shows the existing review and its edit link instead of the form', async () => {
    const db = await fresh();
    await insertReview(db, 'r1', 'u1', 'b1');
    const html = await render(db, '?building=b1');
    expect(html).toContain(REVIEW_LIMIT_COPY.alreadyReviewed);
    expect(linksNamed(html, REVIEW_LIMIT_COPY.editLink)).toEqual(['/review/edit/r1']);
    expect(hasFormIsland(html)).toBe(false);
    expect(hasTurnstile(html)).toBe(false);
  });

  it('links to the newer review of a legacy pair', async () => {
    const db = await fresh();
    await insertReview(db, 'old-a', 'u1', 'b1', 400 * 86_400);
    await insertReview(db, 'old-b', 'u1', 'b1', 300 * 86_400);
    const html = await render(db, '?building=b1');
    expect(linksNamed(html, REVIEW_LIMIT_COPY.editLink)).toEqual(['/review/edit/old-b']);
  });

  it('renders the form when the review is of another building, or by another account', async () => {
    const db = await fresh();
    await insertReview(db, 'mine', 'u1', 'b2');
    await insertReview(db, 'theirs', 'u2', 'b1');
    const html = await render(db, '?building=b1');
    expect(hasFormIsland(html)).toBe(true);
    expect(hasTurnstile(html)).toBe(true);
    expect(html).not.toContain(REVIEW_LIMIT_COPY.alreadyReviewed);
  });

  it('renders the form and logs when the check fails', async () => {
    const db = await fresh();
    await insertReview(db, 'r1', 'u1', 'b1');
    const failing = {
      prepare(sql: string) {
        if (sql.includes('FROM reviews WHERE user_id')) throw new Error('D1_ERROR: no such table');
        return db.prepare(sql);
      },
      batch: (statements: Parameters<TestD1Database['batch']>[0]) => db.batch(statements),
    };
    const html = await render(failing, '?building=b1');
    expect(hasFormIsland(html)).toBe(true);
    expect(html).not.toContain(REVIEW_LIMIT_COPY.alreadyReviewed);
    expect(loggedEvents()).toContain('review_preflight_failed');
  });

  it('keeps the not-found note for an unknown building and runs no check', async () => {
    const db = await fresh();
    const seen: string[] = [];
    const watching = {
      prepare(sql: string) {
        seen.push(sql);
        return db.prepare(sql);
      },
      batch: (statements: Parameters<TestD1Database['batch']>[0]) => db.batch(statements),
    };
    const html = await render(watching, '?building=missing');
    expect(html).toContain(HANDOFF_COPY.notFound);
    expect(seen.some((sql) => sql.includes('FROM reviews WHERE user_id'))).toBe(false);
  });
});
