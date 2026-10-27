import type { APIContext } from 'astro';
import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMemoryDatabase, sqliteAvailable, TestD1Database } from './helpers/sqliteD1';
import ReviewCard from '../../components/reviews/ReviewCard.astro';
import { getCurrentYear } from '../privacy';

/**
 * A skipped move-in is stored as blank and shown as blank. These run the real submit and edit
 * routes against every migration in migrations/, 0034 included, so the INSERT and UPDATE are
 * checked against the schema production has, NOT NULL move-in columns and all, and then
 * render the stored rows on a review card. Reviews written before 0034 stay as stored.
 */

vi.mock('../turnstile', () => ({
  verifyTurnstile: vi.fn(async () => ({ success: true })),
}));

vi.mock('../ownerNotify', () => ({ queueOwnerNotice: vi.fn() }));

import { POST } from '../../pages/api/reviews';
import { PATCH } from '../../pages/api/reviews/[id]';

const MIGRATIONS = join(process.cwd(), 'migrations');
const MOVE_IN_MIGRATION = '0034_review_move_in_given.sql';
const year = getCurrentYear();

function migrationFiles(): string[] {
  return readdirSync(MIGRATIONS).filter((file) => file.endsWith('.sql')).sort();
}

function schemaDb(options: { through?: string } = {}): TestD1Database {
  const db = new TestD1Database(createMemoryDatabase());
  for (const file of migrationFiles()) {
    if (options.through && file > options.through) break;
    db.exec(readFileSync(join(MIGRATIONS, file), 'utf8'));
  }
  return db;
}

async function seed(db: TestD1Database): Promise<void> {
  await db.prepare("INSERT INTO users (id, email) VALUES ('u1', 'tenant@example.com')").run();
  await db
    .prepare("INSERT INTO buildings (id, address, slug, city, state) VALUES ('b1', '12 Example Rd', '12-example-rd-boston', 'Boston', 'MA')")
    .run();
}

function context(db: TestD1Database, request: Request, params: Record<string, string> = {}): APIContext {
  return {
    request,
    params,
    locals: { user: { id: 'u1' }, runtime: { env: { DB: db, TURNSTILE_SECRET_KEY: 'secret' } } },
  } as unknown as APIContext;
}

async function submit(db: TestD1Database, fields: Record<string, string>): Promise<string> {
  const form = new FormData();
  const all = {
    building_id: 'b1',
    unit_structural: '4',
    bedrooms: '2',
    move_out_year: 'current',
    'cf-turnstile-response': 'good',
    ...fields,
  };
  for (const [key, value] of Object.entries(all)) form.set(key, value);
  const response = await POST(context(db, new Request('https://ratemyplace.org/api/reviews', { method: 'POST', body: form })));
  expect(response.status).toBe(200);
  const body = (await response.json()) as { reviewId: string };
  return body.reviewId;
}

async function edit(db: TestD1Database, id: string, body: Record<string, unknown>): Promise<void> {
  const request = new Request(`https://ratemyplace.org/api/reviews/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ unit_structural: 4, move_out_year_new: 'current', ...body }),
  });
  const response = await PATCH(context(db, request, { id }));
  expect(response.status).toBe(200);
}

interface StoredRow {
  move_in_season: string;
  move_in_year: number;
  move_in_given: string | null;
}

async function stored(db: TestD1Database, id: string): Promise<StoredRow> {
  const row = await db
    .prepare('SELECT move_in_season, move_in_year, move_in_given FROM reviews WHERE id = ?')
    .bind(id)
    .first<StoredRow>();
  if (!row) throw new Error(`no review ${id}`);
  return row;
}

/** The text of a review card rendered from the stored row, as the building page reads it. */
async function card(db: TestD1Database, id: string): Promise<string> {
  const review = await db.prepare('SELECT r.* FROM reviews r WHERE r.id = ?').bind(id).first<Record<string, unknown>>();
  const container = await AstroContainer.create();
  const html = await container.renderToString(ReviewCard, { props: { review } });
  const el = document.createElement('div');
  el.innerHTML = html;
  return (el.textContent ?? '').replace(/\s+/g, ' ');
}

const suite = sqliteAvailable ? describe : describe.skip;

suite('migration 0034', () => {
  it('adds a nullable move_in_given column and leaves existing reviews NULL', async () => {
    const before = migrationFiles().filter((file) => file < MOVE_IN_MIGRATION).pop() as string;
    const db = schemaDb({ through: before });
    await seed(db);
    await db
      .prepare("INSERT INTO reviews (id, user_id, building_id, move_in_year, move_in_season, unit_type) VALUES ('old', 'u1', 'b1', 2026, 'winter', '2br')")
      .run();

    db.exec(readFileSync(join(MIGRATIONS, MOVE_IN_MIGRATION), 'utf8'));

    const column = await db
      .prepare(`SELECT type, "notnull" AS not_null, dflt_value FROM pragma_table_info('reviews') WHERE name = 'move_in_given'`)
      .first<{ type: string; not_null: number; dflt_value: unknown }>();
    expect({ ...column }).toEqual({ type: 'TEXT', not_null: 0, dflt_value: null });
    expect(await stored(db, 'old')).toEqual({ move_in_season: 'winter', move_in_year: 2026, move_in_given: null });

    const notNull = await db
      .prepare(`SELECT name FROM pragma_table_info('reviews') WHERE name IN ('move_in_year', 'move_in_season') AND "notnull" = 1 ORDER BY name`)
      .all<{ name: string }>();
    expect(notNull.results.map((r) => r.name)).toEqual(['move_in_season', 'move_in_year']);
  });

  it('accepts only the three recorded values or NULL', async () => {
    const db = schemaDb();
    await seed(db);
    const insert = (id: string, given: string | null) => db
      .prepare("INSERT INTO reviews (id, user_id, building_id, move_in_year, move_in_season, unit_type, move_in_given) VALUES (?, 'u1', 'b1', 2026, 'winter', '2br', ?)")
      .bind(id, given)
      .run();
    for (const [i, given] of ['season_and_year', 'year_only', 'none', null].entries()) {
      await insert(`ok-${i}`, given);
    }
    await expect(insert('bad', 'skipped')).rejects.toThrow(/CHECK/);
  });

  it('fails on a second run without changing anything', async () => {
    const db = schemaDb();
    await seed(db);
    await db
      .prepare("INSERT INTO reviews (id, user_id, building_id, move_in_year, move_in_season, unit_type, move_in_given) VALUES ('r', 'u1', 'b1', 2024, 'fall', '2br', 'season_and_year')")
      .run();
    expect(() => db.exec(readFileSync(join(MIGRATIONS, MOVE_IN_MIGRATION), 'utf8'))).toThrow(/duplicate column name/);
    expect(await stored(db, 'r')).toEqual({ move_in_season: 'fall', move_in_year: 2024, move_in_given: 'season_and_year' });
  });
});

suite('POST /api/reviews move-in', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('stores a skipped move-in as not given and the card shows no move-in', async () => {
    const db = schemaDb();
    await seed(db);
    const id = await submit(db, {});
    expect(await stored(db, id)).toEqual({ move_in_season: 'winter', move_in_year: year, move_in_given: 'none' });

    const text = await card(db, id);
    expect(text).not.toContain(`Winter ${year}`);
    expect(text).toContain('Current');
  });

  it('stores month and year as season and year and the card shows both', async () => {
    const db = schemaDb();
    await seed(db);
    const id = await submit(db, { move_in_month: '10', move_in_year: String(year - 3) });
    expect(await stored(db, id)).toEqual({ move_in_season: 'fall', move_in_year: year - 3, move_in_given: 'season_and_year' });
    expect(await card(db, id)).toContain(`Fall ${year - 3} · Current`);
  });

  it('stores a year without a month as year only and the card shows the year alone', async () => {
    const db = schemaDb();
    await seed(db);
    const id = await submit(db, { move_in_year: String(year - 2) });
    expect(await stored(db, id)).toEqual({ move_in_season: 'winter', move_in_year: year - 2, move_in_given: 'year_only' });

    const text = await card(db, id);
    expect(text).toContain(`${year - 2} · Current`);
    expect(text).not.toContain(`Winter ${year - 2}`);
  });

  it('stores a month without a year as not given', async () => {
    const db = schemaDb();
    await seed(db);
    const id = await submit(db, { move_in_month: '7' });
    expect((await stored(db, id)).move_in_given).toBe('none');
    const text = await card(db, id);
    expect(text).not.toContain(`Summer ${year}`);
    expect(text).not.toContain(`Winter ${year}`);
  });

  it('treats a malformed move-in as not given instead of failing the submission', async () => {
    const db = schemaDb();
    await seed(db);
    const id = await submit(db, { move_in_month: 'thirteen', move_in_year: 'soon' });
    expect(await stored(db, id)).toEqual({ move_in_season: 'winter', move_in_year: year, move_in_given: 'none' });
  });
});

suite('PATCH /api/reviews/[id] move-in', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  async function oldReview(db: TestD1Database, season: string, moveInYear: number, moveOut = 'current'): Promise<string> {
    await db
      .prepare(
        'INSERT INTO reviews (id, user_id, building_id, move_in_year, move_in_season, unit_type, move_out_year_new, is_current_tenant, unit_structural, overall_score, status) ' +
          "VALUES ('old', 'u1', 'b1', ?, ?, '2br', ?, ?, 4, 4, 'approved')",
      )
      .bind(moveInYear, season, moveOut, moveOut === 'current' ? 1 : 0)
      .run();
    return 'old';
  }

  it('leaves a review written before 0034 exactly as stored when the move-in is not changed', async () => {
    const db = schemaDb();
    await seed(db);
    const id = await oldReview(db, 'winter', year);
    expect(await card(db, id)).toContain(`Winter ${year} · Current`);

    await edit(db, id, { move_in_month: null, move_in_year: year });
    expect(await stored(db, id)).toEqual({ move_in_season: 'winter', move_in_year: year, move_in_given: null });
    expect(await card(db, id)).toContain(`Winter ${year} · Current`);
  });

  it('keeps the stored season of an old review when the reviewer saves without picking a month', async () => {
    const db = schemaDb();
    await seed(db);
    const id = await oldReview(db, 'fall', year - 2);
    await edit(db, id, { move_in_month: null, move_in_year: year - 2 });
    expect(await stored(db, id)).toEqual({ move_in_season: 'fall', move_in_year: year - 2, move_in_given: null });
  });

  it('keeps the season the reviewer gave when the edit changes only the year', async () => {
    const db = schemaDb();
    await seed(db);
    const id = await submit(db, { move_in_month: '10', move_in_year: String(year - 3) });
    expect(await stored(db, id)).toEqual({ move_in_season: 'fall', move_in_year: year - 3, move_in_given: 'season_and_year' });

    await edit(db, id, { move_in_month: null, move_in_year: year - 4 });
    expect(await stored(db, id)).toEqual({ move_in_season: 'fall', move_in_year: year - 4, move_in_given: 'season_and_year' });
    expect(await card(db, id)).toContain(`Fall ${year - 4} · Current`);
  });

  it('stores only the new year on a review written before 0034 when the edit changes only the year', async () => {
    const db = schemaDb();
    await seed(db);
    const id = await oldReview(db, 'winter', year);
    await edit(db, id, { move_in_month: null, move_in_year: year - 1 });
    expect(await stored(db, id)).toEqual({ move_in_season: 'winter', move_in_year: year - 1, move_in_given: 'year_only' });
    expect(await card(db, id)).not.toContain(`Winter ${year - 1}`);
    expect(await card(db, id)).toContain(`${year - 1} · Current`);
  });

  it('stores a cleared move-in as not given', async () => {
    const db = schemaDb();
    await seed(db);
    const id = await oldReview(db, 'fall', year - 2);
    await edit(db, id, { move_in_month: null, move_in_year: null });
    expect((await stored(db, id)).move_in_given).toBe('none');
    expect(await card(db, id)).not.toContain(`Fall ${year - 2}`);
  });

  it('keeps a skipped move-in blank across an edit and stores one the reviewer adds', async () => {
    const db = schemaDb();
    await seed(db);
    const id = await submit(db, {});
    await edit(db, id, { move_in_month: null, move_in_year: null });
    expect(await stored(db, id)).toEqual({ move_in_season: 'winter', move_in_year: year, move_in_given: 'none' });

    await edit(db, id, { move_in_month: 4, move_in_year: year - 1 });
    expect(await stored(db, id)).toEqual({ move_in_season: 'spring', move_in_year: year - 1, move_in_given: 'season_and_year' });
    expect(await card(db, id)).toContain(`Spring ${year - 1} · Current`);
  });

  it('leaves the move-in alone when the body does not carry it', async () => {
    const db = schemaDb();
    await seed(db);
    const id = await submit(db, { move_in_year: String(year - 2) });
    await edit(db, id, {});
    expect(await stored(db, id)).toEqual({ move_in_season: 'winter', move_in_year: year - 2, move_in_given: 'year_only' });
  });
});
