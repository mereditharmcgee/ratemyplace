import type { APIContext } from 'astro';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fakeD1 } from './helpers/fakeD1';
import type { FakeCall } from './helpers/fakeD1';

vi.mock('../turnstile', () => ({
  verifyTurnstile: vi.fn(async () => ({ success: true })),
}));

vi.mock('../ownerNotify', () => ({ queueOwnerNotice: vi.fn() }));

import { POST } from '../../pages/api/reviews';

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

function context(db: unknown, request: Request): APIContext {
  return {
    request,
    params: {},
    locals: { user: { id: 'u1' }, runtime: { env: { DB: db, TURNSTILE_SECRET_KEY: 'secret' } } },
  } as unknown as APIContext;
}

async function insertedUnit(bedrooms: string): Promise<{ unitType: unknown; bedrooms: unknown }> {
  const { db, calls } = fakeD1((call: FakeCall) => {
    if (call.sql.includes('SELECT id, slug FROM buildings')) return { id: 'b1', slug: 'b1-slug' };
    return undefined;
  });
  const form = new FormData();
  for (const [key, value] of Object.entries({
    building_id: 'b1',
    unit_structural: '4',
    bedrooms,
    'cf-turnstile-response': 'good',
  })) form.set(key, value);
  const response = await POST(context(db, new Request('https://ratemyplace.org/api/reviews', { method: 'POST', body: form })));
  expect(response.status).toBe(200);
  const insert = calls.find((call) => call.sql.includes('INSERT INTO reviews'));
  if (!insert) throw new Error('no review insert');
  // Bind order: id, user_id, building_id, tenure_months, move_out_year_new, is_current_tenant,
  // unit_type, unit_number, bedrooms, ...
  return { unitType: insert.binds[6], bedrooms: insert.binds[8] };
}

describe('POST /api/reviews unit type', () => {
  it.each([
    ['studio', 'studio'],
    ['1', '1br'],
    ['2', '2br'],
    ['3', '3br'],
    ['4', '4br+'],
    ['5+', '4br+'],
  ])('stores bedrooms %s with unit type %s', async (bedrooms, unitType) => {
    expect(await insertedUnit(bedrooms)).toEqual({ unitType, bedrooms });
  });
});
