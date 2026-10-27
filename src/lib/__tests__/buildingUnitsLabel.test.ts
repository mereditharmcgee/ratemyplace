import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import reactRenderer from '@astrojs/react/server.js';
import { describe, expect, it } from 'vitest';
import BuildingPage from '../../pages/building/[slug].astro';
import { FY2026_RESOURCE_ID } from '../records/sources/boston/assessor';
import { createRecordsTestDb, insertBuilding, insertPull } from './helpers/recordsDb';
import { sqliteAvailable, type TestD1Database } from './helpers/sqliteD1';

/**
 * The unit count in Building details. On a seeded Boston page it is usually the seed's estimate
 * from the parcel's land use (the assessor leaves the count blank), and it says so. A count a
 * person entered keeps the plain label. Stored data is read, never changed.
 */

const suite = sqliteAvailable ? describe : describe.skip;

const BUILDING_ID = 'bldg-example';
const SLUG = '12-example-rd-boston';

interface SeedOptions {
  unitCount: number | null;
  buildingType: string;
  /** The stored assessor record's land use and unit count; null stores no assessor record. */
  assessment: { landUse: string; residentialUnits: number | null } | null;
}

async function seed({ unitCount, buildingType, assessment }: SeedOptions): Promise<TestD1Database> {
  const db = createRecordsTestDb();
  db.exec(
    'ALTER TABLE users ADD COLUMN email_verified INTEGER DEFAULT 0; ' +
      'ALTER TABLE reviews ADD COLUMN unit_type TEXT; ' +
      'ALTER TABLE reviews ADD COLUMN review_title TEXT;',
  );
  await insertBuilding(db, {
    id: BUILDING_ID,
    slug: SLUG,
    address: '12 Example Rd',
    neighborhood: 'Allston',
    zip_code: '02134',
    parcel_id: '2100000000',
    source: 'seed',
  });
  await db
    .prepare('UPDATE buildings SET building_type = ?, year_built = ?, unit_count = ? WHERE id = ?')
    .bind(buildingType, 1910, unitCount, BUILDING_ID)
    .run();
  if (assessment) {
    await insertPull(db, BUILDING_ID, FY2026_RESOURCE_ID);
    const payload = {
      fiscalYear: 'FY2026',
      condominium: false,
      parcelId: '2100000000',
      owner: 'EXAMPLE HOLDINGS LLC',
      landUse: assessment.landUse,
      landUseDescription: null,
      residentialUnits: assessment.residentialUnits,
    };
    await db
      .prepare(
        'INSERT INTO building_records (id, building_id, pull_id, kind, source_key, payload, source_url) VALUES (?, ?, ?, ?, ?, ?, ?)',
      )
      .bind('rec-assessment', BUILDING_ID, `${BUILDING_ID}-${FY2026_RESOURCE_ID}-ok`, 'assessment', 'FY2026', JSON.stringify(payload), null)
      .run();
  }
  return db;
}

async function renderPage(db: TestD1Database): Promise<string> {
  const container = await AstroContainer.create();
  container.addServerRenderer({ renderer: reactRenderer });
  container.addClientRenderer({ name: '@astrojs/react', entrypoint: '@astrojs/react/client.js' });
  return container.renderToString(BuildingPage, {
    params: { slug: SLUG },
    request: new Request(`https://ratemyplace.org/building/${SLUG}`),
    locals: { user: null, session: null, runtime: { env: { DB: db } } } as unknown as App.Locals,
    partial: false,
  });
}

/** The Building details terms and descriptions, in order, as [term, description] pairs. */
function buildingDetails(html: string): Array<[string, string]> {
  const root = document.createElement('div');
  root.innerHTML = html;
  const heading = Array.from(root.querySelectorAll('h2')).find((el) => el.textContent?.trim() === 'Building details');
  const list = heading?.parentElement?.querySelector('dl');
  if (!list) throw new Error('no Building details list');
  const terms = Array.from(list.querySelectorAll('dt')).map((node) => node.textContent?.trim() ?? '');
  const values = Array.from(list.querySelectorAll('dd')).map((node) => node.textContent?.trim() ?? '');
  return terms.map((term, index) => [term, values[index]]);
}

suite('Building details unit count', () => {
  it("labels the seed's land-use estimate as an estimate", async () => {
    const html = await renderPage(
      await seed({ unitCount: 3, buildingType: 'three_family', assessment: { landUse: 'R3', residentialUnits: null } }),
    );
    expect(buildingDetails(html)).toContainEqual(['Units (estimated from land use)', '3']);
    // The facts strip no longer says the assessor left the count blank.
    expect(html).not.toContain('units not recorded');
  });

  it('keeps "Units" for a count a person entered', async () => {
    // The seed implies no count for an apartment parcel, so this number came from a person.
    const html = await renderPage(
      await seed({ unitCount: 18, buildingType: 'apartment', assessment: { landUse: 'A', residentialUnits: null } }),
    );
    expect(buildingDetails(html)).toContainEqual(['Units', '18']);
    expect(html).not.toContain('estimated from land use');
  });

  it('keeps "Units" when the assessor recorded the count', async () => {
    const html = await renderPage(
      await seed({ unitCount: 3, buildingType: 'three_family', assessment: { landUse: 'R3', residentialUnits: 3 } }),
    );
    expect(buildingDetails(html)).toContainEqual(['Units', '3']);
    expect(html).toContain('units 3');
  });

  it('keeps "Units" on a building with no assessor record', async () => {
    const html = await renderPage(await seed({ unitCount: 3, buildingType: 'three_family', assessment: null }));
    expect(buildingDetails(html)).toContainEqual(['Units', '3']);
  });
});
