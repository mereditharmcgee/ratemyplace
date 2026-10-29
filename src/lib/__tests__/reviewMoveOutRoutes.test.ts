import type { APIContext } from 'astro';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect, vi } from 'vitest';
import { createMemoryDatabase, sqliteAvailable, TestD1Database } from './helpers/sqliteD1';
import { moveOutEditValue } from '../privacy';

/**
 * A past tenant can be stored with no move-out: the submit route stores NULL when the form
 * sends none, and the edit route when it sends a blank one. An edit that leaves the move-out
 * out of its body keeps what is stored. The edit page starts its move-out select from
 * `moveOutEditValue`, so an untouched save sends back what is stored. These run the real
 * routes against every migration in migrations/.
 */

vi.mock('../turnstile', () => ({
  verifyTurnstile: vi.fn(async () => ({ success: true })),
}));

vi.mock('../ownerNotify', () => ({ queueOwnerNotice: vi.fn() }));

import { POST } from '../../pages/api/reviews';
import { PATCH } from '../../pages/api/reviews/[id]';

const MIGRATIONS = join(process.cwd(), 'migrations');

function schemaDb(): TestD1Database {
  const db = new TestD1Database(createMemoryDatabase());
  for (const file of readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).sort()) {
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
  const all = { building_id: 'b1', unit_structural: '4', 'cf-turnstile-response': 'good', ...fields };
  for (const [key, value] of Object.entries(all)) form.set(key, value);
  const response = await POST(context(db, new Request('https://ratemyplace.org/api/reviews', { method: 'POST', body: form })));
  expect(response.status).toBe(200);
  return ((await response.json()) as { reviewId: string }).reviewId;
}

async function edit(db: TestD1Database, id: string, body: Record<string, unknown>): Promise<void> {
  const request = new Request(`https://ratemyplace.org/api/reviews/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ unit_structural: 4, ...body }),
  });
  const response = await PATCH(context(db, request, { id }));
  expect(response.status).toBe(200);
}

interface StoredMoveOut {
  move_out_year_new: string | null;
  is_current_tenant: number;
}

async function stored(db: TestD1Database, id: string): Promise<StoredMoveOut> {
  const row = await db
    .prepare('SELECT move_out_year_new, is_current_tenant FROM reviews WHERE id = ?')
    .bind(id)
    .first<StoredMoveOut>();
  if (!row) throw new Error(`no review ${id}`);
  return { ...row };
}

/** What the edit page's move-out select starts at for the stored row. */
async function editStart(db: TestD1Database, id: string): Promise<string> {
  const row = await stored(db, id);
  return moveOutEditValue({ move_out_year_new: row.move_out_year_new, is_current_tenant: row.is_current_tenant === 1 });
}

const suite = sqliteAvailable ? describe : describe.skip;

suite('stored move-out round trip', () => {
  it('stores a past tenant with no move-out when the submit sends none', async () => {
    const db = schemaDb();
    await seed(db);
    const id = await submit(db, {});
    expect(await stored(db, id)).toEqual({ move_out_year_new: null, is_current_tenant: 0 });
  });

  // A partial edit changes only what it sends. Before this was fixed, an edit body without
  // move_out_year_new erased a stored move-out and stored a past tenant with none.
  it('keeps the stored move-out when an edit sends none', async () => {
    const db = schemaDb();
    await seed(db);
    const past = await submit(db, { move_out_year: '2024' });
    const current = await submit(db, { move_out_year: 'current' });
    await edit(db, past, {});
    await edit(db, current, {});
    expect(await stored(db, past)).toEqual({ move_out_year_new: '2024', is_current_tenant: 0 });
    expect(await stored(db, current)).toEqual({ move_out_year_new: 'current', is_current_tenant: 1 });
  });

  it('stores a past tenant with no move-out when an edit sends a blank one', async () => {
    const db = schemaDb();
    await seed(db);
    const id = await submit(db, { move_out_year: '2024' });
    await edit(db, id, { move_out_year_new: '' });
    expect(await stored(db, id)).toEqual({ move_out_year_new: null, is_current_tenant: 0 });
  });

  it('keeps a past tenant with no move-out as stored through an untouched edit', async () => {
    const db = schemaDb();
    await seed(db);
    const id = await submit(db, {});
    const start = await editStart(db, id);
    expect(start).toBe('');
    await edit(db, id, { move_out_year_new: start });
    expect(await stored(db, id)).toEqual({ move_out_year_new: null, is_current_tenant: 0 });
  });

  it('keeps a stored move-out and a current tenant through an untouched edit', async () => {
    const db = schemaDb();
    await seed(db);
    const past = await submit(db, { move_out_year: '2020_or_earlier' });
    const current = await submit(db, { move_out_year: 'current' });

    await edit(db, past, { move_out_year_new: await editStart(db, past) });
    await edit(db, current, { move_out_year_new: await editStart(db, current) });

    expect(await stored(db, past)).toEqual({ move_out_year_new: '2020_or_earlier', is_current_tenant: 0 });
    expect(await stored(db, current)).toEqual({ move_out_year_new: 'current', is_current_tenant: 1 });
  });
});

/**
 * Reviews written before January 2026 can carry a move-out season with the year. The edit
 * form has no season control, so a season belongs only to the year it was given with: when
 * an edit changes the year, the season is cleared rather than carried onto a year it was
 * never given for (stored fall 2019, edited to 2023, used to read "Move-out: Fall 2023").
 */
suite('stored move-out season on edit', () => {
  async function olderReview(db: TestD1Database): Promise<string> {
    const id = await submit(db, { move_out_year: '2019' });
    // The submit route stores no season any more; this sets the row up as an older one.
    await db.prepare("UPDATE reviews SET move_out_season = 'fall' WHERE id = ?").bind(id).run();
    return id;
  }

  async function season(db: TestD1Database, id: string): Promise<string | null> {
    const row = await db.prepare('SELECT move_out_season FROM reviews WHERE id = ?').bind(id).first<{ move_out_season: string | null }>();
    if (!row) throw new Error(`no review ${id}`);
    return row.move_out_season;
  }

  it('clears the season when an edit changes the move-out year', async () => {
    const db = schemaDb();
    await seed(db);
    const id = await olderReview(db);
    await edit(db, id, { move_out_year_new: '2023' });
    expect(await stored(db, id)).toEqual({ move_out_year_new: '2023', is_current_tenant: 0 });
    expect(await season(db, id)).toBeNull();
  });

  it('clears the season when an edit makes the reviewer a current tenant or blanks the move-out', async () => {
    const db = schemaDb();
    await seed(db);
    const toCurrent = await olderReview(db);
    const toBlank = await olderReview(db);
    await edit(db, toCurrent, { move_out_year_new: 'current' });
    await edit(db, toBlank, { move_out_year_new: '' });
    expect(await season(db, toCurrent)).toBeNull();
    expect(await season(db, toBlank)).toBeNull();
  });

  it('keeps the season when an edit keeps the year, or sends no move-out', async () => {
    const db = schemaDb();
    await seed(db);
    const sameYear = await olderReview(db);
    const noMoveOut = await olderReview(db);
    await edit(db, sameYear, { move_out_year_new: await editStart(db, sameYear) });
    await edit(db, noMoveOut, {});
    for (const id of [sameYear, noMoveOut]) {
      expect(await stored(db, id)).toEqual({ move_out_year_new: '2019', is_current_tenant: 0 });
      expect(await season(db, id)).toBe('fall');
    }
  });
});
