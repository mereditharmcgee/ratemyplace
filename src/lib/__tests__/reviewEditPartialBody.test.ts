import type { APIContext } from 'astro';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect, vi } from 'vitest';
import { createMemoryDatabase, sqliteAvailable, TestD1Database } from './helpers/sqliteD1';

/**
 * The reviewer's edit form sends every field, but PATCH /api/reviews/[id] also takes a
 * partial body, and a field the body left out used to be written as blank: the tenure, the
 * unit details, the issue flags and the rest were erased by an edit that never mentioned
 * them. These run the real routes against every migration in migrations/.
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

/** A review with every field the edit form can change filled in. */
const FULL_REVIEW: Record<string, string> = {
  tenure_months: '36',
  move_out_year: '2024',
  unit_number: '3B',
  bedrooms: '2',
  bathrooms: '1.5',
  square_footage: '850',
  rent_amount: '2400',
  amenities: '["dishwasher"]',
  utilities_included: '["water"]',
  laundry_type: 'coin_op',
  laundry_cost_per_load: '2.5',
  estimated_monthly_utilities: '120',
  parking_type: 'street',
  pet_types: '["cat"]',
  pest_types_experienced: '["mice"]',
  review_title: 'Fine place',
  landlord_name: 'Example Realty',
  property_manager_name: 'Example Management',
  would_recommend: 'maybe',
  comments: 'Heat was slow to come on.',
  had_pest_issues: '1',
  had_heat_issues: '1',
  had_water_issues: '1',
  had_security_deposit_issues: '1',
  had_eviction_threats: '1',
  accepts_housing_vouchers: 'yes',
  safely_lit_at_night: 'no',
};

async function submit(db: TestD1Database, fields: Record<string, string> = FULL_REVIEW): Promise<string> {
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
    body: JSON.stringify(body),
  });
  const response = await PATCH(context(db, request, { id }));
  expect(response.status).toBe(200);
}

/** The columns a partial edit must leave as stored when its body does not name them. */
const KEPT_COLUMNS = [
  'tenure_months',
  'move_out_year_new',
  'is_current_tenant',
  'unit_number',
  'bedrooms',
  'bathrooms',
  'square_footage',
  'rent_amount',
  'amenities',
  'utilities_included',
  'estimated_monthly_utilities',
  'parking_type',
  'pet_types',
  'pest_types_experienced',
  'review_title',
  'landlord_name',
  'property_manager_name',
  'would_recommend_new',
  'had_pest_issues',
  'had_heat_issues',
  'had_water_issues',
  'had_security_deposit_issues',
  'had_eviction_threat',
  'accepts_housing_vouchers',
  'safely_lit_at_night',
] as const;

async function row(db: TestD1Database, id: string, columns: readonly string[] = KEPT_COLUMNS): Promise<Record<string, unknown>> {
  const found = await db.prepare(`SELECT ${columns.join(', ')} FROM reviews WHERE id = ?`).bind(id).first<Record<string, unknown>>();
  if (!found) throw new Error(`no review ${id}`);
  return { ...found };
}

async function tenure(db: TestD1Database, id: string): Promise<unknown> {
  return (await row(db, id, ['tenure_months'])).tenure_months;
}

const suite = sqliteAvailable ? describe : describe.skip;

suite('partial review edit', () => {
  it('keeps every field the body does not send', async () => {
    const db = schemaDb();
    await seed(db);
    const id = await submit(db);
    const before = await row(db, id);
    // Every field set (a past tenant, so is_current_tenant is 0), so a column that comes back
    // blank was erased, not left blank.
    expect(
      Object.entries(before).filter(
        ([key, value]) => key !== 'is_current_tenant' && (value === null || value === '' || value === 0),
      ),
    ).toEqual([]);

    await edit(db, id, { unit_structural: 2 });

    expect(await row(db, id)).toEqual(before);
    expect((await row(db, id, ['unit_structural'])).unit_structural).toBe(2);
  });

  it('still writes what the body sends, blanks included', async () => {
    const db = schemaDb();
    await seed(db);
    const id = await submit(db);
    const before = await row(db, id);

    await edit(db, id, { unit_structural: 4, bedrooms: '3', unit_number: null, had_pest_issues: false, review_title: '' });

    expect(await row(db, id)).toEqual({
      ...before,
      bedrooms: '3',
      unit_number: null,
      had_pest_issues: 0,
      review_title: '',
    });
  });
});

suite('tenure on edit', () => {
  it('stores a blank tenure as NULL', async () => {
    const db = schemaDb();
    await seed(db);
    const blank = await submit(db);
    const nulled = await submit(db);
    await edit(db, blank, { unit_structural: 4, tenure_months: '' });
    await edit(db, nulled, { unit_structural: 4, tenure_months: null });
    expect(await tenure(db, blank)).toBeNull();
    expect(await tenure(db, nulled)).toBeNull();
  });

  it('stores the tenure the body sends, from the select value or a number', async () => {
    const db = schemaDb();
    await seed(db);
    const fromSelect = await submit(db);
    const fromNumber = await submit(db);
    await edit(db, fromSelect, { unit_structural: 4, tenure_months: '72' });
    await edit(db, fromNumber, { unit_structural: 4, tenure_months: 9 });
    expect(await tenure(db, fromSelect)).toBe(72);
    expect(await tenure(db, fromNumber)).toBe(9);
  });

  it('keeps no tenure as no tenure through an untouched edit', async () => {
    const db = schemaDb();
    await seed(db);
    const id = await submit(db, { move_out_year: 'current' });
    expect(await tenure(db, id)).toBeNull();
    // What the edit form sends for an untouched blank select.
    await edit(db, id, { unit_structural: 4, tenure_months: '' });
    expect(await tenure(db, id)).toBeNull();
  });

  it('stores a tenure that is not a whole number of months as NULL', async () => {
    const db = schemaDb();
    await seed(db);
    const id = await submit(db);
    await edit(db, id, { unit_structural: 4, tenure_months: 'about a year' });
    expect(await tenure(db, id)).toBeNull();
  });
});
